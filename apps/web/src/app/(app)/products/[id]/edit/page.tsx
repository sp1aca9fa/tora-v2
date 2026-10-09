import { getProduct } from '@tora/db';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { editProductAction } from '@/app/(app)/holdings/[id]/actions';
import { ActionForm } from '@/components/action-form';
import { ProductFields } from '@/components/product-fields';
import { authedDb } from '@/lib/auth/guard';

export default async function EditProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { id } = await params;
  const { from } = await searchParams;
  const product = await getProduct(await authedDb(), id);
  if (!product) notFound();
  const t = await getTranslations();
  const back = from?.startsWith('/holdings/') ? from : '/';

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <p className="text-sm text-muted-foreground">{t(`productType.${product.type}`)}</p>
        <h1 className="text-2xl font-semibold tracking-tight">{t('holding.editProduct')}</h1>
        <p className="text-sm text-muted-foreground">{t('actions.intro.editProduct')}</p>
      </header>
      <ActionForm
        action={editProductAction.bind(null, id, back)}
        submitLabel={t('common.save')}
        cancelHref={back}
      >
        <input type="hidden" name="type" value={product.type} />
        <ProductFields type={product.type} defaults={product} />
      </ActionForm>
    </div>
  );
}
