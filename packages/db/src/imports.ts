// Imports hub (requirements S5d): import runs and what needs the user after an import.
import { toTokyoIso } from '@tora/core';
import { and, desc, eq } from 'drizzle-orm';
import type { Db } from './client';
import { failedPurchaseLinkCount } from './purchase-links';
import { cardGradeCounts, importReviewCount } from './queries';
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
  const [toReview, failedLinks, grades] = await Promise.all([
    importReviewCount(db, userId),
    failedPurchaseLinkCount(db, userId),
    cardGradeCounts(db, userId),
  ]);
  return {
    toReview,
    failedLinks,
    ungradedCards: grades.ungraded,
    total: toReview + failedLinks + grades.ungraded,
  };
}

export async function getImportRun(db: Db, userId: string, id: string): Promise<ImportRun | null> {
  const [run] = await db
    .select()
    .from(importRuns)
    .where(and(eq(importRuns.id, id), eq(importRuns.userId, userId)));
  return run ?? null;
}
