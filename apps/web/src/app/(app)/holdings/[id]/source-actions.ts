'use server';

import { parseSourceUrl } from '@tora/core';
import {
  confirmCandidate,
  getCandidate,
  getProductSource,
  linkSource,
  rejectCandidate,
  unlinkSource,
  userHoldsProduct,
} from '@tora/db';
import { revalidatePath } from 'next/cache';
import { authed } from '@/lib/auth/guard';
import type { FormState } from '@/lib/form';

/** Price sources belong to shared products; any user holding the product may manage them. */
async function allowed(productId: string) {
  const { db, user } = await authed();
  return (await userHoldsProduct(db, user.id, productId)) ? db : null;
}

export async function confirmCandidateAction(candidateId: string, holdingId: string) {
  const { db } = await authed();
  const c = await getCandidate(db, candidateId);
  if (c && (await allowed(c.productId))) await confirmCandidate(db, candidateId);
  revalidatePath(`/holdings/${holdingId}`);
  revalidatePath('/', 'layout');
}

export async function rejectCandidateAction(candidateId: string, holdingId: string) {
  const { db } = await authed();
  const c = await getCandidate(db, candidateId);
  if (c && (await allowed(c.productId))) await rejectCandidate(db, candidateId);
  revalidatePath(`/holdings/${holdingId}`);
  revalidatePath('/', 'layout');
}

export async function unlinkSourceAction(sourceId: string, holdingId: string) {
  const { db } = await authed();
  const s = await getProductSource(db, sourceId);
  if (s && (await allowed(s.productId))) await unlinkSource(db, sourceId);
  revalidatePath(`/holdings/${holdingId}`);
}

export async function linkUrlAction(
  productId: string,
  holdingId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const db = await allowed(productId);
  if (!db) return { error: 'not_found' };
  const parsed = parseSourceUrl(String(formData.get('url') ?? ''));
  if (!parsed) return { error: 'badSourceUrl' };
  await linkSource(db, productId, parsed);
  revalidatePath(`/holdings/${holdingId}`);
  return {};
}
