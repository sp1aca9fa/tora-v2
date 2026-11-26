'use server';

import { parseListingUrl } from '@tora/core';
import {
  SEARCH_WORDS_MAX,
  type SourceQuery,
  linkPageAs,
  managesLinkAt,
  managesLinks,
  confirmCandidate,
  getObservation,
  reactivateSource,
  setSourceReferences,
  setObservationExcluded,
  getCandidate,
  getProductSource,
  canEditProduct,
  getProduct,
  itemWithListing,
  rejectCandidate,
  saveEditedSearch,
  searchWordsOf,
  unlinkSource,
  userHoldsProduct,
} from '@tora/db';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { authed } from '@/lib/auth/guard';
import { getRegistry } from '@/lib/sources';
import type { FormState } from '@/lib/form';

/**
 * Price sources belong to shared products; any user holding the product may manage them: its
 * searches, its references and which sales count.
 */
async function allowed(productId: string) {
  const { db, user } = await authed();
  return (await userHoldsProduct(db, user.id, productId)) ? db : null;
}

/**
 * Which pages an item is linked to (`managesLinks`: a holder; anyone else only the item's page at a
 * game identity shop, when they watch the item or are an admin of a tracked game). Everything else
 * stays the holders' (`allowed`).
 */
async function allowedLink(
  productId: string,
  link: { source: string; externalId: string | null; query?: unknown },
) {
  const { db, user } = await authed();
  return (await managesLinks(db, user.id, productId, link)) ? db : null;
}

/** The same for a write onto a place (a candidate confirmed or rejected): the row there decides. */
async function allowedAt(productId: string, at: { source: string; externalId: string }) {
  const { db, user } = await authed();
  return (await managesLinkAt(db, user.id, productId, at)) ? db : null;
}

/**
 * A listing already linked to another item means the two are one item: the merge page instead
 * of a second link (sales are stored once per site, so the second item would get almost none).
 */
async function mergeInstead(productId: string, link: { source: string; externalId: string }) {
  const { db, user } = await authed();
  const other = await itemWithListing(db, link, productId);
  const product = other && (await getProduct(db, productId));
  if (other && product && canEditProduct(user, product))
    redirect(`/products/${productId}/merge?into=${other.id}&why=listing`);
}

export async function confirmCandidateAction(candidateId: string) {
  const { db } = await authed();
  const c = await getCandidate(db, candidateId);
  if (c && (await allowedAt(c.productId, c))) {
    await mergeInstead(c.productId, c);
    await confirmCandidate(db, candidateId);
  }
  revalidatePath('/', 'layout');
}

export async function rejectCandidateAction(candidateId: string) {
  const { db } = await authed();
  const c = await getCandidate(db, candidateId);
  if (c && (await allowedAt(c.productId, c))) await rejectCandidate(db, candidateId);
  revalidatePath('/', 'layout');
}

export async function unlinkSourceAction(sourceId: string) {
  const { db } = await authed();
  const s = await getProductSource(db, sourceId);
  if (s && (await allowedLink(s.productId, s))) await unlinkSource(db, sourceId);
  revalidatePath(`/products/${s?.productId}`, 'layout');
}

export async function linkUrlAction(
  productId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { db, user } = await authed();
  const registry = await getRegistry();
  const parsed = parseListingUrl(registry, String(formData.get('url') ?? ''));
  // An address of a place this person has no say on (for one who does not hold the item: anything but
  // its page at a game identity shop) is refused as an unknown item.
  if (parsed && !(await managesLinkAt(db, user.id, productId, parsed)))
    return { error: 'not_found' };
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
  await mergeInstead(productId, parsed);
  if (!(await linkPageAs(db, user.id, productId, parsed))) return { error: 'not_found' };
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
  const { db, user } = await authed();
  const link = await getProductSource(db, sourceId);
  if (!link || !(await allowed(link.productId))) return { error: 'not_found' };
  const keywords = searchWordsOf(formData.get('keywords')).slice(0, SEARCH_WORDS_MAX);
  if (!keywords) return { error: 'check', fields: ['keywords'] };
  const query: SourceQuery = {
    ...link.query,
    keywords: [keywords],
    excludeKeywords: words(formData.get('excludeKeywords')),
    priceMin: yenOrUndefined(formData.get('priceMin')),
    priceMax: yenOrUndefined(formData.get('priceMax')),
  };
  // Saved marked edited (never replaced by newer default queries); the rows go with the save, and
  // what was confirmed on them no longer counts (a game's check). A save that changes nothing
  // deletes nothing (`saveEditedSearch`).
  await saveEditedSearch(db, user, link, query);
  revalidatePath(`/products/${link.productId}`, 'layout');
  return { saved: true };
}

export async function reactivateSourceAction(sourceId: string) {
  const { db } = await authed();
  const link = await getProductSource(db, sourceId);
  if (link && (await allowedLink(link.productId, link))) await reactivateSource(db, sourceId);
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
