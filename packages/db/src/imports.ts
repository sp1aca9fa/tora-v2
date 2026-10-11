// Imports hub (requirements S5d): import runs and what needs the user after an import.
import { toTokyoIso } from '@tora/core';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { DomainError, deleteHolding, editHolding } from './mutations';
import type { Db } from './client';
import { failedPurchaseLinkCount } from './purchase-links';
import { cardGradeCounts, importReviewCount } from './queries';
import { openSuggestionCount } from './suggestions';
import { type ImportRun, holdings, importRuns, products, purchaseLinks } from './schema';

export type ImportMethod = 'email' | 'links' | 'file' | 'claude';

export async function startImportRun(
  db: Db,
  input: { userId: string; method: ImportMethod; source?: string | null; note?: string | null },
): Promise<string> {
  const [run] = await db
    .insert(importRuns)
    .values({ ...input, startedAt: toTokyoIso() })
    .returning({ id: importRuns.id });
  return run!.id;
}

export async function finishImportRun(
  db: Db,
  id: string,
  counts: Record<string, number>,
  extra: { note?: string | null; source?: string | null } = {},
): Promise<void> {
  const now = toTokyoIso();
  await db
    .update(importRuns)
    .set({
      finishedAt: now,
      updatedAt: now,
      // Only what happened (zeros are noise in the history).
      counts: Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0)),
      ...extra,
    })
    .where(eq(importRuns.id, id));
}

/** The user's import runs, newest first. */
export async function importRunsOf(db: Db, userId: string, limit = 30): Promise<ImportRun[]> {
  return db
    .select()
    .from(importRuns)
    .where(eq(importRuns.userId, userId))
    .orderBy(desc(importRuns.startedAt))
    .limit(limit);
}

/** One run with the lots it created and the links it read. */
export async function importRunDetail(db: Db, userId: string, id: string) {
  const [run] = await db
    .select()
    .from(importRuns)
    .where(and(eq(importRuns.id, id), eq(importRuns.userId, userId)));
  if (!run) return null;
  const [lots, links] = await Promise.all([
    db
      .select({ holding: holdings, product: products })
      .from(holdings)
      .innerJoin(products, eq(products.id, holdings.productId))
      .where(and(eq(holdings.userId, userId), eq(holdings.importRunId, id)))
      .orderBy(desc(holdings.acquiredAt)),
    db
      .select()
      .from(purchaseLinks)
      .where(and(eq(purchaseLinks.userId, userId), eq(purchaseLinks.importRunId, id))),
  ]);
  return { run, lots, links };
}

/** What waits for the user after imports (the Imports badge counts all of it). */
export async function importAttention(db: Db, userId: string) {
  const [toReview, failedLinks, grades, suggestions] = await Promise.all([
    importReviewCount(db, userId),
    failedPurchaseLinkCount(db, userId),
    cardGradeCounts(db, userId),
    openSuggestionCount(db, userId),
  ]);
  return {
    toReview,
    failedLinks,
    ungradedCards: grades.ungraded,
    suggestions,
    total: toReview + failedLinks + grades.ungraded + suggestions,
  };
}

export async function getImportRun(db: Db, userId: string, id: string): Promise<ImportRun | null> {
  const [run] = await db
    .select()
    .from(importRuns)
    .where(and(eq(importRuns.id, id), eq(importRuns.userId, userId)));
  return run ?? null;
}

/**
 * Two imported lots waiting for review are one purchase (e.g. read from two screenshots): the
 * kept lot (and its item) stays and takes the other's order ID or price when it has none, and its
 * date when only the other's was read from the order; pasted links move over; the other lot is
 * removed.
 */
export async function mergeImportedLots(
  db: Db,
  userId: string,
  keepId: string,
  dropId: string,
): Promise<{ dateTaken: boolean }> {
  const lots = await db
    .select()
    .from(holdings)
    .where(and(eq(holdings.userId, userId), inArray(holdings.id, [keepId, dropId])));
  const keep = lots.find((h) => h.id === keepId);
  const drop = lots.find((h) => h.id === dropId);
  if (!keep || !drop || keepId === dropId) throw new DomainError('not_found');
  // The kept lot's item stays (the other may have been made from a cut-off title).
  if (!keep.reviewPending || !drop.reviewPending) throw new DomainError('invalid_input');
  const reasons = (h: typeof keep) => (h.reviewReason ?? '').split(',').filter(Boolean);
  const dateTaken = reasons(keep).includes('date_approx') && !reasons(drop).includes('date_approx');
  await db
    .update(purchaseLinks)
    .set({ holdingId: keepId, updatedAt: toTokyoIso() })
    .where(eq(purchaseLinks.holdingId, dropId));
  await deleteHolding(db, userId, dropId);
  const edit: { orderId?: string; acquiredAt?: string; costTotalJpy?: number } = {};
  if (!keep.orderId && drop.orderId) edit.orderId = drop.orderId;
  if (!keep.costTotalJpy && drop.costTotalJpy) edit.costTotalJpy = drop.costTotalJpy;
  if (dateTaken) edit.acquiredAt = drop.acquiredAt;
  if (Object.keys(edit).length) await editHolding(db, userId, keepId, edit);
  const left = reasons(keep).filter(
    (r) => r !== 'maybe_same' && !(dateTaken && r === 'date_approx'),
  );
  await db
    .update(holdings)
    .set({ reviewReason: left.join(',') || null, updatedAt: toTokyoIso() })
    .where(eq(holdings.id, keepId));
  return { dateTaken };
}
