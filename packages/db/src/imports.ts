// Imports hub (requirements S5d): import runs and what needs the user after an import.
import { toLocalIso } from '@tora/core';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { recordImport } from './activity';
import { DomainError, deleteHolding, deleteUnusedProduct, editHolding } from './mutations';
import type { Db } from './client';
import {
  type ImportRun,
  type NewImportRow,
  holdings,
  importRows,
  importRuns,
  products,
  purchaseLinks,
} from './schema';

export type ImportMethod = 'email' | 'links' | 'file' | 'claude';

export async function startImportRun(
  db: Db,
  input: { userId: string; method: ImportMethod; source?: string | null; note?: string | null },
): Promise<string> {
  const [run] = await db
    .insert(importRuns)
    .values({ ...input, startedAt: toLocalIso() })
    .returning({ id: importRuns.id });
  return run!.id;
}

export async function finishImportRun(
  db: Db,
  id: string,
  counts: Record<string, number>,
  extra: { note?: string | null; source?: string | null } = {},
): Promise<void> {
  const now = toLocalIso();
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
  // The activity log and the daily summary (S17); never fails the import.
  await recordImport(db, id).catch((error) =>
    console.error('activity: import not recorded', error),
  );
}

/** A row of the import log, before it is saved (its run and place are added). */
export type ImportRowLog = Omit<
  NewImportRow,
  'id' | 'importRunId' | 'position' | 'createdAt' | 'updatedAt'
>;

/** Saves an import's log (S6): every row it read and what happened to it, in order. */
export async function saveImportRows(db: Db, runId: string, rows: ImportRowLog[]): Promise<void> {
  const [last] = await db
    .select({ position: importRows.position })
    .from(importRows)
    .where(eq(importRows.importRunId, runId))
    .orderBy(desc(importRows.position))
    .limit(1);
  const start = (last?.position ?? 0) + 1;
  for (let i = 0; i < rows.length; i += 200) {
    await db.insert(importRows).values(
      rows.slice(i, i + 200).map((r, j) => ({
        ...r,
        title: r.title.slice(0, 300) || '-',
        detail: r.detail?.slice(0, 300) ?? null,
        reason: r.reason?.slice(0, 500) ?? null,
        importRunId: runId,
        position: start + i + j,
      })),
    );
  }
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

/** One run with the lots it created, the links it read and its log. */
export async function importRunDetail(db: Db, userId: string, id: string) {
  const [run] = await db
    .select()
    .from(importRuns)
    .where(and(eq(importRuns.id, id), eq(importRuns.userId, userId)));
  if (!run) return null;
  const [lots, links, rows] = await Promise.all([
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
    db
      .select({ row: importRows, product: products })
      .from(importRows)
      .leftJoin(holdings, eq(holdings.id, importRows.holdingId))
      .leftJoin(products, eq(products.id, holdings.productId))
      .where(eq(importRows.importRunId, id))
      .orderBy(asc(importRows.position)),
  ]);
  return { run, lots, links, rows };
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
  const edit: { orderId?: string; acquiredAt?: string; costTotalBase?: number } = {};
  if (!keep.orderId && drop.orderId) edit.orderId = drop.orderId;
  if (!keep.costTotalBase && drop.costTotalBase) edit.costTotalBase = drop.costTotalBase;
  if (dateTaken) edit.acquiredAt = drop.acquiredAt;
  const left = reasons(keep).filter(
    (r) => r !== 'maybe_same' && !(dateTaken && r === 'date_approx'),
  );
  // One transaction: a failed edit keeps the other lot. It goes first, as its order ID may be one
  // a shop allows on one lot only.
  await db.transaction(async (tx) => {
    await tx
      .update(purchaseLinks)
      .set({ holdingId: keepId, updatedAt: toLocalIso() })
      .where(eq(purchaseLinks.holdingId, dropId));
    await deleteHolding(tx, userId, dropId);
    if (Object.keys(edit).length) await editHolding(tx, userId, keepId, edit);
    await tx
      .update(holdings)
      .set({ reviewReason: left.join(',') || null, updatedAt: toLocalIso() })
      .where(eq(holdings.id, keepId));
  });
  // An item the import made for the other lot (e.g. from a cut-off title) goes too; left over
  // (unused) when this fails.
  if (drop.productId !== keep.productId && reasons(drop).includes('new_product')) {
    await deleteUnusedProduct(db, drop.productId);
  }
  return { dateTaken };
}
