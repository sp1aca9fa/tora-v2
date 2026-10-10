import { canEditProduct, getProduct, imageVersions, productLots } from '@tora/db';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ActionForm } from '@/components/action-form';
import { ProductImage } from '@/components/product-image';
import { authed } from '@/lib/auth/guard';
import { productMeta } from '@/lib/product-display';
import { mergeAction } from './actions';

/** Confirms merging a duplicate product into an existing one. */
export default async function MergePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ into?: string }>;
}) {
  const { id } = await params;
  const { into: intoId } = await searchParams;
  const { db, user } = await authed();
  const [from, into] = await Promise.all([
    getProduct(db, id),
    intoId ? getProduct(db, intoId) : null,
  ]);
  if (!from || !into || from.id === into.id || !canEditProduct(user, from)) notFound();
  const [t, lots, images] = await Promise.all([
    getTranslations(),
    productLots(db, user.id, from.id),
    imageVersions(db, [from.id, into.id]),
  ]);
  const card = (p: typeof from, label: string) => (
    <div className="flex items-center gap-3 rounded-md border px-3 py-2.5">
      <ProductImage product={p} version={images.get(p.id)} className="size-12" />
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="truncate font-medium">{p.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {productMeta(p, t)}
          {[p.rarity, p.setCode, p.cardNumber].filter(Boolean).length > 0 &&
            ` · ${[p.rarity, p.setCode, p.cardNumber].filter(Boolean).join(' ')}`}
        </p>
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('merge.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('merge.intro')}</p>
      </header>
      <div className="space-y-2">
        {card(from, t('merge.from'))}
        {card(into, t('merge.into'))}
      </div>
      <ActionForm
        action={mergeAction.bind(null, from.id, into.id)}
        submitLabel={t('merge.submit')}
        cancelHref={`/products/${from.id}/edit?from=/products/${from.id}`}
        destructive
      >
        <label className="flex items-start gap-3 rounded-md border border-destructive/40 p-3 text-sm">
          <input type="checkbox" name="confirm" required className="mt-0.5 size-4" />
          <span>{t('merge.confirm', { lots: lots.length, name: into.name })}</span>
        </label>
      </ActionForm>
    </div>
  );
}
