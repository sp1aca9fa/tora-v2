'use server';

import { PRODUCT_TYPES, type ProductType, tokyoDateToIso } from '@tora/core';
import { type ProductRef, createHolding, getProduct, searchProducts } from '@tora/db';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { authedDb } from '@/lib/auth/guard';
import {
  type FormState,
  dateText,
  optText,
  parseForm,
  qty,
  reqEnum,
  runDomain,
  yen,
} from '@/lib/form';
import {
  conditionInputFrom,
  conditionSchema,
  productInputFrom,
  productSchema,
} from '@/lib/schemas';

export interface ProductSummary {
  id: string;
  type: ProductType;
  nameJa: string | null;
  nameEn: string | null;
  setName: string | null;
  cardNumber: string | null;
}

export async function searchProductsAction(
  q: string,
  types?: ProductType[],
): Promise<ProductSummary[]> {
  const db = await authedDb();
  const validTypes = types?.filter((t) => PRODUCT_TYPES.includes(t));
  const rows = await searchProducts(db, q.slice(0, 100), { types: validTypes, limit: 15 });
  return rows.map(({ id, type, nameJa, nameEn, setName, cardNumber }) => ({
    id,
    type,
    nameJa,
    nameEn,
    setName,
    cardNumber,
  }));
}

const holdingSchema = z.object({
  mode: reqEnum(['existing', 'new'] as const),
  productId: optText,
  acquiredAt: dateText,
  acquiredFrom: optText,
  acquisitionType: reqEnum(['purchase', 'gift', 'trade'] as const),
  quantity: qty,
  costTotalJpy: yen,
  notes: optText,
});

export async function createHoldingAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const db = await authedDb();
  const base = parseForm(holdingSchema, formData);
  if ('state' in base) return base.state;
  const { mode, productId, acquiredAt, ...holding } = base.data;

  let ref: ProductRef;
  let type: ProductType;
  if (mode === 'existing') {
    const product = productId ? await getProduct(db, productId) : null;
    if (!product) return { error: 'not_found' };
    ref = { productId: product.id };
    type = product.type;
  } else {
    const parsed = parseForm(productSchema, formData);
    if ('state' in parsed) return parsed.state;
    if (!parsed.data.nameJa && !parsed.data.nameEn) return { error: 'check', fields: ['nameEn'] };
    ref = { product: productInputFrom(parsed.data) };
    type = parsed.data.type;
  }

  const condition = parseForm(conditionSchema, formData);
  if ('state' in condition) return condition.state;
  const { input, missing } = conditionInputFrom(type, condition.data);
  if (missing.length) return { error: 'check', fields: missing };

  const result = await runDomain(() =>
    createHolding(db, ref, {
      ...holding,
      ...input,
      acquiredAt: tokyoDateToIso(acquiredAt),
      acquiredFrom: holding.acquiredFrom ?? null,
      notes: holding.notes ?? null,
    }),
  );
  if (!result.ok) return result.state;
  revalidatePath('/');
  redirect(`/holdings/${result.value.holding.id}`);
}
