'use server';

import { getProduct, mergeProducts, recordAdminChange } from '@tora/db';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { authed } from '@/lib/auth/guard';
import { type FormState, runDomain } from '@/lib/form';

/**
 * Merges the duplicate `fromId` into `intoId` (logged in Activity: it changes an item everyone
 * shares), then shows the merged product.
 */
export async function mergeAction(
  fromId: string,
  intoId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (formData.get('confirm') !== 'on') return { error: 'check', fields: ['confirm'] };
  const { db, user } = await authed();
  const from = await getProduct(db, fromId);
  const result = await runDomain(() => mergeProducts(db, user, fromId, intoId));
  if (!result.ok) return result.state;
  await recordAdminChange(
    db,
    user.id,
    'productMerged',
    { from: `${from?.name ?? ''} (${fromId})`, to: `${result.value.name} (${intoId})` },
    `/products/${intoId}`,
  );
  revalidatePath('/', 'layout');
  redirect(`/products/${intoId}`);
}
