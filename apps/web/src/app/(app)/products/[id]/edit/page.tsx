import { canEditProduct, getProduct } from '@tora/db';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { editProductAction } from '@/app/(app)/holdings/[id]/actions';
import { ActionForm } from '@/components/action-form';
import { authed } from '@/lib/auth/guard';
import { franchiseLabel } from '@/lib/product-display';
import { EditProductFields } from './edit-fields';

export default async function EditProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { id } = await params;
  const { from } = await searchParams;
  const { db, user } = await authed();
  const product = await getProduct(db, id);
  // Products are shared: only the creator (or an admin) may edit one.
  if (!product || !canEditProduct(user, product)) notFound();
  const t = await getTranslations();
  const back = from?.startsWith('/holdings/') || from?.startsWith('/products/') ? from : '/';
  const isTcg = product.category === 'tcg';

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <p className="text-sm text-muted-foreground">
          {[t(`kind.${product.kind}`), isTcg && franchiseLabel(product.franchise, t)]
            .filter(Boolean)
            .join(' · ')}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">{t('holding.editProduct')}</h1>
        <p className="text-sm text-muted-foreground">{t('actions.intro.editProduct')}</p>
      </header>
      <ActionForm
        action={editProductAction.bind(null, id, back)}
        submitLabel={t('common.save')}
        cancelHref={back}
      >
        <input type="hidden" name="category" value={product.category} />
        <input type="hidden" name="kind" value={product.kind} />
        {isTcg && <input type="hidden" name="franchise" value={product.franchise ?? ''} />}
        {product.setId && <input type="hidden" name="setId" value={product.setId} />}
        <EditProductFields
          productId={product.id}
          category={product.category}
          kind={product.kind}
          franchiseInput={!isTcg}
          defaults={product}
        />
      </ActionForm>
    </div>
  );
}
