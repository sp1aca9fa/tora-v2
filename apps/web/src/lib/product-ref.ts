import 'server-only';
import { type ProductClass, REGIONS, SEALED_KINDS, itemTypeOf, productClass } from '@tora/core';
import { type Db, type ProductRef, getProduct, getSet } from '@tora/db';
import { z } from 'zod';
import { type FormState, optEnum, optText, parseForm, reqEnum } from '@/lib/form';
import { productInputFrom, productSchema } from '@/lib/schemas';
import { getTaxonomy } from '@/lib/taxonomy';

/** How the Add flow names its item: picked, typed as new, or a catalog set's sealed product. */
export const productRefSchema = z.object({
  mode: reqEnum(['existing', 'new', 'catalog'] as const),
  productId: optText,
  catalogSetId: optText,
  catalogKind: optEnum(SEALED_KINDS),
  catalogVariant: optText,
  region: optEnum(REGIONS),
});

/** The item the Add flow names (a lot's or a watch's), with its class for the condition fields. */
export async function productRefFrom(
  db: Db,
  d: z.infer<typeof productRefSchema>,
  formData: FormData,
): Promise<
  { ref: ProductRef; cls: ProductClass; retailPriceBase: number | null } | { state: FormState }
> {
  if (d.mode === 'existing') {
    const product = d.productId ? await getProduct(db, d.productId) : null;
    if (!product) return { state: { error: 'not_found' } };
    return {
      ref: { productId: product.id },
      cls: productClass(product),
      retailPriceBase: product.retailPriceBase,
    };
  }
  if (d.mode === 'catalog') {
    const set = d.catalogSetId ? await getSet(db, d.catalogSetId) : null;
    if (!set || !d.catalogKind) return { state: { error: 'check', fields: ['setName'] } };
    return {
      ref: {
        catalog: {
          setId: set.id,
          kind: d.catalogKind,
          variant: d.catalogVariant,
          region: d.region,
        },
      },
      cls: 'sealed',
      retailPriceBase: null,
    };
  }
  const parsed = await parseForm(productSchema, formData);
  if ('state' in parsed) return parsed;
  const taxonomy = await getTaxonomy();
  const product = productInputFrom(parsed.data, taxonomy, formData);
  if (!product) return { state: { error: 'check', fields: ['name'] } };
  return {
    ref: { product },
    cls: itemTypeOf(taxonomy, product.category, product.kind) ?? productClass(product),
    retailPriceBase: product.retailPriceBase ?? null,
  };
}
