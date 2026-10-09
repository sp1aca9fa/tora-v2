'use server';

import { clearManualPrice, setManualPrice, userHoldsProduct } from '@tora/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { authed } from '@/lib/auth/guard';
import { type FormState, optText, parseForm, yen } from '@/lib/form';

/** Manual prices are per user and always win over computed values (requirements section 6). */
export async function setManualPriceAction(
  productId: string,
  holdingId: string,
  bucket: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { db, user } = await authed();
  if (!(await userHoldsProduct(db, user.id, productId))) return { error: 'not_found' };
  const parsed = parseForm(z.object({ priceJpy: yen, note: optText }), formData);
  if ('state' in parsed) return parsed.state;
  await setManualPrice(db, user.id, productId, bucket, parsed.data.priceJpy, parsed.data.note);
  revalidatePath(`/holdings/${holdingId}`);
  revalidatePath('/');
  return {};
}

export async function clearManualPriceAction(productId: string, holdingId: string, bucket: string) {
  const { db, user } = await authed();
  if (!(await userHoldsProduct(db, user.id, productId))) return;
  await clearManualPrice(db, user.id, productId, bucket);
  revalidatePath(`/holdings/${holdingId}`);
  revalidatePath('/');
}
