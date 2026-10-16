'use server';

import { productClass } from '@tora/core';
import {
  addWatch,
  getProduct,
  linkSets,
  removeWatch,
  suggestFromKnownProducts,
  updateWatch,
} from '@tora/db';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { authed } from '@/lib/auth/guard';
import { type FormState, optAmount, optText, parseForm, runDomain } from '@/lib/form';
import { productRefFrom, productRefSchema } from '@/lib/product-ref';
import { conditionInputFrom, conditionSchema } from '@/lib/schemas';

const watchSchema = z.object({
  targetPriceBase: optAmount,
  note: optText,
});

/** Watches an item picked, typed or chosen from the catalog in the watch steps (S9). */
export async function createWatchAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { db, user } = await authed();
  const base = await parseForm(productRefSchema.merge(watchSchema), formData);
  if ('state' in base) return base.state;
  const resolved = await productRefFrom(db, base.data, formData);
  if ('state' in resolved) return resolved.state;
  const condition = await parseForm(conditionSchema, formData);
  if ('state' in condition) return condition.state;
  const { input, missing } = conditionInputFrom(resolved.cls, condition.data);
  if (missing.length) return { error: 'check', fields: missing };
  const result = await runDomain(() =>
    addWatch(db, user.id, resolved.ref, {
      ...input,
      targetPriceBase: base.data.targetPriceBase || null,
      note: base.data.note ?? null,
    }),
  );
  if (!result.ok) return result.state;
  // Offer a linked look-alike's listing right away, as for a new lot.
  await suggestFromKnownProducts(db, result.value.product.id);
  await linkSets(db, [result.value.product.id]);
  revalidatePath('/', 'layout');
  redirect(`/products/${result.value.product.id}`);
}

/** Adds a watch from an item's page, or changes one (`watchId`). */
export async function saveWatchAction(
  _prev: FormState & { ok?: boolean },
  formData: FormData,
): Promise<FormState & { ok?: boolean }> {
  const { db, user } = await authed();
  const parsed = await parseForm(
    watchSchema.extend({ productId: z.string().min(1).max(40), watchId: optText }),
    formData,
  );
  if ('state' in parsed) return parsed.state;
  const d = parsed.data;
  const product = await getProduct(db, d.productId);
  if (!product) return { error: 'not_found' };
  const condition = await parseForm(conditionSchema, formData);
  if ('state' in condition) return condition.state;
  const { input, missing } = conditionInputFrom(productClass(product), condition.data);
  if (missing.length) return { error: 'check', fields: missing };
  const watch = { ...input, targetPriceBase: d.targetPriceBase || null, note: d.note ?? null };
  const result = await runDomain(async () => {
    if (d.watchId) await updateWatch(db, user.id, d.watchId, watch);
    else await addWatch(db, user.id, { productId: product.id }, watch);
  });
  if (!result.ok) return result.state;
  revalidatePath('/', 'layout');
  return { ok: true };
}

export async function removeWatchAction(watchId: string): Promise<void> {
  const { db, user } = await authed();
  await removeWatch(db, user.id, String(watchId).slice(0, 40));
  revalidatePath('/', 'layout');
}
