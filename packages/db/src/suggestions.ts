// Suggestions from the automated data review (requirements S4d). `pnpm review` on the home PC
// files them; the user accepts or dismisses each in the app, and accepting runs the same action
// as doing it by hand (exclude a sale, add an excluded word to a search, fill product details).
import { toTokyoIso } from '@tora/core';
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import type { Db } from './client';
import { DomainError, canEditProduct } from './mutations';
import {
  type Suggestion,
  priceObservations,
  productSources,
  products,
  suggestions,
} from './schema';
import { setObservationExcluded, updateSourceQuery, userHoldsProduct } from './sources';
import type { User } from './schema';
import { clearBucketValues } from './valuation';

export type SuggestionKind = 'exclude_sale' | 'exclude_word' | 'fix_product';
/** Verdicts kept only so the same thing is not judged again. */
export type VerdictKind = 'sale_ok' | 'search_ok';

/** Product details a suggestion may fill in or correct. */
export const FIXABLE_FIELDS = [
  'name',
  'franchise',
  'setName',
  'setCode',
  'cardNumber',
  'rarity',
  'variant',
] as const;
export type ProductFix = Partial<Record<(typeof FIXABLE_FIELDS)[number], string | null>>;

export interface SuggestionInput {
  userId: string;
  kind: SuggestionKind | VerdictKind;
  targetKey: string;
  productId: string | null;
  payload?: Record<string, unknown>;
  reason: string;
  evidence?: Record<string, unknown> | null;
  model?: string | null;
  confidence?: number | null;
}

/**
 * Files a suggestion, or a verdict ('closed'). One per kind and target: a suggestion the user
 * dismissed is not filed again; a verdict filed again is only marked as judged again.
 */
export async function fileSuggestion(db: Db, input: SuggestionInput): Promise<boolean> {
  const verdict = input.kind === 'sale_ok' || input.kind === 'search_ok';
  const rows = await db
    .insert(suggestions)
    .values({ ...input, payload: input.payload ?? {}, status: verdict ? 'closed' : 'open' })
    .onConflictDoUpdate({
      target: [suggestions.userId, suggestions.kind, suggestions.targetKey],
      set: { updatedAt: toTokyoIso(), reason: input.reason },
      setWhere: eq(suggestions.status, 'closed'),
    })
    .returning({ id: suggestions.id });
  return rows.length > 0 && !verdict;
}

/** When each target was last judged ("<kind>|<target key>" -> updatedAt), any status. */
export async function judgedTargets(
  db: Db,
  userId: string,
  kinds: (SuggestionKind | VerdictKind)[],
): Promise<Map<string, string>> {
  const rows = await db
    .select({ kind: suggestions.kind, key: suggestions.targetKey, at: suggestions.updatedAt })
    .from(suggestions)
    .where(and(eq(suggestions.userId, userId), inArray(suggestions.kind, kinds)));
  return new Map(rows.map((r) => [`${r.kind}|${r.key}`, r.at]));
}

export async function openSuggestions(db: Db, userId: string) {
  return db
    .select({ suggestion: suggestions, product: products })
    .from(suggestions)
    .leftJoin(products, eq(products.id, suggestions.productId))
    .where(and(eq(suggestions.userId, userId), eq(suggestions.status, 'open')))
    .orderBy(desc(suggestions.createdAt));
}

export async function openSuggestionCount(db: Db, userId: string): Promise<number> {
  return (
    await db
      .select({ id: suggestions.id })
      .from(suggestions)
      .where(and(eq(suggestions.userId, userId), eq(suggestions.status, 'open')))
  ).length;
}

async function applySuggestion(
  db: Db,
  user: Pick<User, 'id' | 'role'>,
  s: Suggestion,
): Promise<void> {
  const payload = s.payload as Record<string, unknown>;
  if (!s.productId || !(await userHoldsProduct(db, user.id, s.productId))) {
    throw new DomainError('not_found');
  }
  if (s.kind === 'exclude_sale') {
    const id = String(payload.observationId ?? '');
    const [obs] = await db
      .select({ productId: priceObservations.productId })
      .from(priceObservations)
      .where(eq(priceObservations.id, id));
    // Already gone (the search was refetched since): nothing left to exclude.
    if (obs?.productId === s.productId) await setObservationExcluded(db, id, true);
    return;
  }
  if (s.kind === 'exclude_word') {
    const [link] = await db
      .select()
      .from(productSources)
      .where(eq(productSources.id, String(payload.sourceId ?? '')));
    const word = String(payload.word ?? '').trim();
    if (!link || link.productId !== s.productId || !word) throw new DomainError('not_found');
    const query = link.query ?? { keywords: [] };
    const words = query.excludeKeywords ?? [];
    if (!words.includes(word)) {
      await updateSourceQuery(db, link.id, {
        ...query,
        excludeKeywords: [...words, word],
        // Edited: never replaced by newer default queries.
        extra: { ...query.extra, auto: false, edited: true },
      });
    }
    return;
  }
  if (s.kind === 'fix_product') {
    const [product] = await db.select().from(products).where(eq(products.id, s.productId));
    if (!product) throw new DomainError('not_found');
    if (!canEditProduct(user, product)) throw new DomainError('forbidden');
    const changes = (payload.changes ?? {}) as ProductFix;
    const { name, ...rest } = Object.fromEntries(
      FIXABLE_FIELDS.filter((f) => f in changes).map((f) => [f, changes[f]?.trim() || null]),
    ) as ProductFix;
    const set = { ...rest, ...(name ? { name } : {}) };
    if (Object.keys(set).length === 0) return;
    await db
      .update(products)
      .set({ ...set, updatedAt: toTokyoIso() })
      .where(eq(products.id, product.id));
    await clearBucketValues(db, [product.id]);
    // Searches judge their sales by these details: fetch them again on the next collect.
    const searches = await db
      .select()
      .from(productSources)
      .where(eq(productSources.productId, product.id));
    for (const link of searches) {
      if (link.query) await updateSourceQuery(db, link.id, link.query);
    }
    return;
  }
  throw new DomainError('not_found');
}

/** Accepts (runs the fix) or dismisses an open suggestion. Returns its product. */
export async function decideSuggestion(
  db: Db,
  user: Pick<User, 'id' | 'role'>,
  id: string,
  accept: boolean,
  /** The user's comment, for the model in later reviews. */
  note?: string | null,
): Promise<string | null> {
  const [s] = await db
    .select()
    .from(suggestions)
    .where(and(eq(suggestions.id, id), eq(suggestions.userId, user.id)));
  if (!s || s.status !== 'open') return null;
  if (accept) await applySuggestion(db, user, s);
  const now = toTokyoIso();
  await db
    .update(suggestions)
    .set({
      status: accept ? 'accepted' : 'dismissed',
      decidedAt: now,
      updatedAt: now,
      userNote: note?.trim().slice(0, 1000) || null,
    })
    .where(eq(suggestions.id, id));
  return s.productId;
}

export interface SuggestionListing {
  title: string;
  url: string | null;
  priceJpy: number;
  /** Counted in the value now (else already left out by the filter or by hand). */
  kept: boolean;
}

const fold = (s: string) => s.normalize('NFKC').toLowerCase();

/**
 * A product's collected listings with a word in the title, or with one of the given titles (the
 * evidence shown with a suggestion, each with its link): kept ones first, newest first.
 */
export async function suggestionListings(
  db: Db,
  productId: string,
  match: { source?: string; word?: string; titles?: string[] },
  limit = 10,
): Promise<SuggestionListing[]> {
  const rows = await db
    .select({
      url: priceObservations.url,
      raw: priceObservations.raw,
      priceJpy: priceObservations.priceJpy,
      excluded: priceObservations.excluded,
    })
    .from(priceObservations)
    .where(
      and(
        eq(priceObservations.productId, productId),
        match.source ? eq(priceObservations.source, match.source) : undefined,
      ),
    )
    .orderBy(desc(priceObservations.observedAt));
  const word = match.word ? fold(match.word) : null;
  const titles = match.titles ? new Set(match.titles) : null;
  const seen = new Set<string>();
  return rows
    .map((r) => ({
      title: ((r.raw ?? {}) as { name?: string }).name ?? '',
      url: r.url,
      priceJpy: r.priceJpy,
      kept: !r.excluded,
    }))
    .filter((l) => l.title && (!word || fold(l.title).includes(word)))
    .filter((l) => !titles || titles.has(l.title))
    .filter((l) => {
      const key = l.url ?? l.title;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => Number(b.kept) - Number(a.kept))
    .slice(0, limit);
}

/** The user's comments on decided suggestions, newest first (shown in the app, given to the model). */
export async function reviewNotes(db: Db, userId: string, limit = 50) {
  return db
    .select({
      id: suggestions.id,
      note: suggestions.userNote,
      kind: suggestions.kind,
      status: suggestions.status,
      reason: suggestions.reason,
      decidedAt: suggestions.decidedAt,
      productId: suggestions.productId,
      productName: products.name,
    })
    .from(suggestions)
    .leftJoin(products, eq(products.id, suggestions.productId))
    .where(and(eq(suggestions.userId, userId), isNotNull(suggestions.userNote)))
    .orderBy(desc(suggestions.decidedAt))
    .limit(limit);
}

export async function clearReviewNote(db: Db, userId: string, id: string): Promise<void> {
  await db
    .update(suggestions)
    .set({ userNote: null, updatedAt: toTokyoIso() })
    .where(and(eq(suggestions.id, id), eq(suggestions.userId, userId)));
}
