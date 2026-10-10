'use server';

import { parseSourceUrl } from '@tora/core';
import {
  type SourceQuery,
  confirmCandidate,
  getObservation,
  reactivateSource,
  setObservationExcluded,
  updateSourceQuery,
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

export async function confirmCandidateAction(candidateId: string) {
  const { db } = await authed();
  const c = await getCandidate(db, candidateId);
  if (c && (await allowed(c.productId))) await confirmCandidate(db, candidateId);
  revalidatePath('/', 'layout');
}

export async function rejectCandidateAction(candidateId: string) {
  const { db } = await authed();
  const c = await getCandidate(db, candidateId);
  if (c && (await allowed(c.productId))) await rejectCandidate(db, candidateId);
  revalidatePath('/', 'layout');
}

export async function unlinkSourceAction(sourceId: string) {
  const { db } = await authed();
  const s = await getProductSource(db, sourceId);
  if (s && (await allowed(s.productId))) await unlinkSource(db, sourceId);
  revalidatePath(`/products/${s?.productId}`);
}

export async function linkUrlAction(
  productId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const db = await allowed(productId);
  if (!db) return { error: 'not_found' };
  const parsed = parseSourceUrl(String(formData.get('url') ?? ''));
  if (!parsed) return { error: 'badSourceUrl' };
  await linkSource(db, productId, parsed);
  revalidatePath(`/products/${productId}`);
  return {};
}

const words = (v: FormDataEntryValue | null) =>
  String(v ?? '')
    .normalize('NFKC')
    .split(/[\s,、]+/)
    .map((w) => w.trim())
    .filter(Boolean)
    .slice(0, 30);
const yenOrUndefined = (v: FormDataEntryValue | null) => {
  const n = Number(String(v ?? '').replace(/[^\d]/g, ''));
  return String(v ?? '').trim() && Number.isSafeInteger(n) && n > 0 ? n : undefined;
};

export type QueryFormState = FormState & { saved?: boolean };

/** Saves an edited search (keywords, excluded words, price range); the next collect refetches. */
export async function updateQueryAction(
  sourceId: string,
  _prev: QueryFormState,
  formData: FormData,
): Promise<QueryFormState> {
  const { db } = await authed();
  const link = await getProductSource(db, sourceId);
  if (!link || !(await allowed(link.productId))) return { error: 'not_found' };
  const keywords = String(formData.get('keywords') ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
  if (!keywords) return { error: 'check', fields: ['keywords'] };
  const query: SourceQuery = {
    ...link.query,
    keywords: [keywords],
    excludeKeywords: words(formData.get('excludeKeywords')),
    priceMin: yenOrUndefined(formData.get('priceMin')),
    priceMax: yenOrUndefined(formData.get('priceMax')),
  };
  await updateSourceQuery(db, sourceId, query);
  revalidatePath(`/products/${link.productId}`);
  return { saved: true };
}

export async function reactivateSourceAction(sourceId: string) {
  const { db } = await authed();
  const link = await getProductSource(db, sourceId);
  if (link && (await allowed(link.productId))) await reactivateSource(db, sourceId);
  revalidatePath(`/products/${link?.productId}`);
}

/** Excludes one collected sale by hand (or includes it again). */
export async function excludeObservationAction(observationId: string, excluded: boolean) {
  const { db } = await authed();
  const obs = await getObservation(db, observationId);
  if (obs && (await allowed(obs.productId)))
    await setObservationExcluded(db, observationId, excluded);
  revalidatePath(`/products/${obs?.productId}`);
}
