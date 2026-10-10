'use server';

import { mergeProducts } from '@tora/db';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { authed } from '@/lib/auth/guard';
import { type FormState, runDomain } from '@/lib/form';

/** Merges the duplicate `fromId` into `intoId`, then shows the merged product. */
export async function mergeAction(
  fromId: string,
  intoId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (formData.get('confirm') !== 'on') return { error: 'check', fields: ['confirm'] };
  const { db, user } = await authed();
  const result = await runDomain(() => mergeProducts(db, user, fromId, intoId));
  if (!result.ok) return result.state;
  revalidatePath('/', 'layout');
  redirect(`/products/${intoId}`);
}
