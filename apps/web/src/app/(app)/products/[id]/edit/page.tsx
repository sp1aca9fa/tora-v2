import { categoryDef } from '@tora/core';
import { canEditProduct, getProduct, productLines, setLineList } from '@tora/db';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { editProductAction } from '@/app/(app)/holdings/[id]/actions';
import { ActionForm } from '@/components/action-form';
import { authed } from '@/lib/auth/guard';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { franchiseLabel, lineLabel } from '@/lib/product-display';
import { getTaxonomy } from '@/lib/taxonomy';
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
  const [t, taxonomy] = await Promise.all([getTranslations(), getTaxonomy()]);
  const back = from?.startsWith('/holdings/') || from?.startsWith('/products/') ? from : '/';
  // TCG keeps the franchise picked with chips (the set catalog); others type it.
  const isTcg = !!categoryDef(taxonomy, product.category)?.setCatalog;
  // The set line (S9): automatic unless set here.
  const [list, auto] = isTcg
    ? await Promise.all([setLineList(db), productLines(db, [{ ...product, line: null }])])
    : [[], new Map<string, string | null>()];
  const autoLine = auto.get(product.id);
  const options = product.line && !list.includes(product.line) ? [...list, product.line] : list;

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <p className="text-sm text-muted-foreground">
          {[t(`kind.${product.kind}`), isTcg && franchiseLabel(product.franchise, t)]
            .filter(Boolean)
            .join(' · ')}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">{t('holding.editProduct')}</h1>
        <p className="text-sm text-muted-foreground">{t('lotActions.intro.editProduct')}</p>
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
        {isTcg && (
          <div className="space-y-1.5">
            <Label htmlFor="line">{t('lineField.label')}</Label>
            <NativeSelect id="line" name="line" defaultValue={product.line ?? ''}>
              <option value="">
                {autoLine
                  ? t('lineField.auto', { line: lineLabel(autoLine, t) })
                  : t('lineField.autoNone')}
              </option>
              {options.map((l) => (
                <option key={l} value={l}>
                  {lineLabel(l, t)}
                </option>
              ))}
            </NativeSelect>
            <p className="text-xs text-muted-foreground">{t('lineField.hint')}</p>
          </div>
        )}
      </ActionForm>
    </div>
  );
}
