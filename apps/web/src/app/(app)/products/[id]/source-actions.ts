'use server';

import { parseListingUrl } from '@tora/core';
import {
  type SourceQuery,
  confirmCandidate,
  getObservation,
  reactivateSource,
  setSourceReferences,
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
import { getRegistry } from '@/lib/sources';
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
  revalidatePath(`/products/${s?.productId}`, 'layout');
}

export async function linkUrlAction(
  productId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const db = await allowed(productId);
  if (!db) return { error: 'not_found' };
  const registry = await getRegistry();
  const parsed = parseListingUrl(registry, String(formData.get('url') ?? ''));
  if (!parsed) {
    return {
      error: 'badSourceUrl',
      values: {
        sources: registry.sources
          .filter((s) => s.links?.length)
          .map((s) => s.label)
          .join(', '),
      },
    };
  }
  await linkSource(db, productId, parsed);
  // Also the Actions page and the badges (a main source may be linked now).
  revalidatePath('/', 'layout');
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
    // Edited by the user: never replaced by newer default queries.
    extra: { ...link.query?.extra, auto: false, edited: true },
  };
  await updateSourceQuery(db, sourceId, query);
  revalidatePath(`/products/${link.productId}`, 'layout');
  return { saved: true };
}

export async function reactivateSourceAction(sourceId: string) {
  const { db } = await authed();
  const link = await getProductSource(db, sourceId);
  if (link && (await allowed(link.productId))) await reactivateSource(db, sourceId);
  revalidatePath(`/products/${link?.productId}`, 'layout');
}

/** Excludes one collected sale by hand (or includes it again). */
export async function excludeObservationAction(observationId: string, excluded: boolean) {
  const { db } = await authed();
  const obs = await getObservation(db, observationId);
  if (obs && (await allowed(obs.productId)))
    await setObservationExcluded(db, observationId, excluded);
  revalidatePath(`/products/${obs?.productId}`, 'layout');
}

/** Adds a listing link of this exact item to a search (read by the next collect). */
export async function addReferenceAction(
  sourceId: string,
  _prev: QueryFormState,
  formData: FormData,
): Promise<QueryFormState> {
  const { db } = await authed();
  const link = await getProductSource(db, sourceId);
  if (!link || !(await allowed(link.productId))) return { error: 'not_found' };
  const url = String(formData.get('url') ?? '').trim();
  if (!/^https:\/\/\S+$/.test(url) || url.length > 300) return { error: 'badSourceUrl' };
  const references = (link.query?.extra?.references as string[] | undefined) ?? [];
  if (!references.includes(url)) {
    await setSourceReferences(db, sourceId, [...references, url].slice(-20));
  }
  revalidatePath(`/products/${link.productId}`, 'layout');
  return { saved: true };
}

export async function removeReferenceAction(sourceId: string, url: string) {
  const { db } = await authed();
  const link = await getProductSource(db, sourceId);
  if (!link || !(await allowed(link.productId))) return;
  const references = (link.query?.extra?.references as string[] | undefined) ?? [];
  await setSourceReferences(
    db,
    sourceId,
    references.filter((r) => r !== url),
  );
  revalidatePath(`/products/${link.productId}`, 'layout');
}
