// Import through Claude (S4c), second half: the rows Claude read go through the same import plan
// as receipt emails, per shop. Nothing is asked: a likely match with an entry added by hand is
// the same purchase (its ID is attached when there is one), a conflict keeps what is registered,
// and every new lot waits in Review import with the reasons to check it.
import {
  type Db,
  type PurchaseLink,
  finishImportRun,
  holdingsWithProducts,
  purchaseLinksOf,
  resolvePurchaseLink,
  startImportRun,
} from '@tora/db';
import {
  type ExtractedRow,
  type ImportRow,
  type ReadResult,
  type RowFlag,
  aiImporter,
  reviewReasons,
  shopKey,
  toReceipts,
} from './ai-import';
import type { Product } from '@tora/db';
import {
  type Decision,
  type PlanEntry,
  applyImport,
  gatherReceipts,
  planImport,
} from './purchases';
import type { PurchaseImporter, ReceiptMail } from './types';

export interface ShopPlan {
  shop: string;
  importer: PurchaseImporter;
  rows: ImportRow[];
  plan: PlanEntry[];
  decisions: Map<string, Decision>;
}

export interface AiPlan {
  shops: ShopPlan[];
  /** Rows not imported on purpose: not a purchase, not a collectible, or cancelled. */
  skipped: { row: ExtractedRow; why: 'not_purchase' | 'not_collectible' | 'cancelled' }[];
}

export async function planAiImport(
  db: Db,
  userId: string,
  read: ReadResult,
  products: Map<string, Product>,
  fallbackDate: (file: string) => string,
): Promise<AiPlan> {
  const skipped: AiPlan['skipped'] = [];
  const kept: { row: ExtractedRow; flags: RowFlag[]; reviewedBy: string | null }[] = [];
  const cancels: ExtractedRow[] = [];
  for (const r of read.rows) {
    if (r.row.status === 'not_purchase') skipped.push({ row: r.row, why: 'not_purchase' });
    else if (!r.row.collectible) skipped.push({ row: r.row, why: 'not_collectible' });
    else if (r.row.status === 'cancelled') {
      skipped.push({ row: r.row, why: 'cancelled' });
      if (r.row.orderId) cancels.push(r.row);
    } else kept.push(r);
  }
  // A file named after the item's ID ("m12345678901.png") gives the ID the page does not show.
  for (const r of kept) {
    const id = r.row.file.match(/\bm\d{10,12}\b/)?.[0];
    const alone = kept.filter((k) => k.row.file === r.row.file).length === 1;
    if (!r.row.orderId && id && alone && shopKey(r.row.shop) === 'mercari') {
      r.row = { ...r.row, orderId: id };
    }
  }
  const rows = toReceipts(kept, fallbackDate);
  const shops: ShopPlan[] = [];
  for (const shop of new Set(rows.map((r) => shopKey(r.row.shop)))) {
    const mine = rows.filter((r) => shopKey(r.row.shop) === shop);
    const importer = aiImporter(shop, mine, products);
    const mails: ReceiptMail[] = [
      ...mine.map((r) => ({ kind: 'purchase' as const, receipt: r.receipt })),
      // A cancelled order already registered is reported (never removed).
      ...cancels
        .filter((c) => shopKey(c.shop) === shop)
        .map((c) => ({ kind: 'cancel' as const, orderId: c.orderId! })),
    ];
    const plan = await planImport(db, userId, importer, gatherReceipts(mails));
    const decisions = new Map<string, Decision>();
    for (const entry of plan) {
      const row = mine.find((r) => r.receipt.orderId === entry.receipt.orderId);
      if (entry.type === 'likely') decisions.set(entry.receipt.orderId, 'same');
      if (entry.type === 'conflict') decisions.set(entry.receipt.orderId, 'keep');
      if (entry.type === 'new' && row) {
        const reasons = new Set([...(entry.flags ?? []), ...reviewReasons(row.flags)]);
        if (entry.receipt.dateApprox) reasons.add('date_approx');
        if ('create' in entry.ref) reasons.add('new_product');
        entry.flags = [...reasons];
      }
    }
    shops.push({ shop, importer, rows: mine, plan, decisions });
  }
  return { shops, skipped };
}

export interface AiImportOutcome {
  runId: string;
  counts: Record<string, number>;
  failed: { orderId: string; error: string }[];
  /** Pasted Mercari links that had failed and are now this import's lots. */
  linksResolved: number;
}

const itemIdOf = (link: PurchaseLink) =>
  link.url.split('?')[0]!.replace(/\/$/, '').split('/').pop();

export async function applyAiImport(
  db: Db,
  userId: string,
  plan: AiPlan,
  note: string,
): Promise<AiImportOutcome> {
  const runId = await startImportRun(db, { userId, method: 'claude' });
  const counts: Record<string, number> = {};
  const add = (k: string, n = 1) => n && (counts[k] = (counts[k] ?? 0) + n);
  const failed: AiImportOutcome['failed'] = [];
  for (const s of plan.shops) {
    const outcome = await applyImport(db, userId, s.importer, s.plan, s.decisions, {
      importRunId: runId,
    });
    add('imported', outcome.created);
    add('matched', s.plan.filter((e) => e.type === 'likely').length);
    add('duplicate', s.plan.filter((e) => e.type === 'duplicate' || e.type === 'conflict').length);
    add('unclassified', s.plan.filter((e) => e.type === 'unclassified').length);
    add('failed', outcome.failed.length);
    failed.push(...outcome.failed);
  }
  add('cancelled', plan.skipped.filter((s) => s.why === 'cancelled').length);
  add('skipped', plan.skipped.filter((s) => s.why === 'not_collectible').length);

  // Failed Mercari links whose item this import brought in (the order ID is the item ID).
  let linksResolved = 0;
  const failedLinks = (await purchaseLinksOf(db, userId, 500)).filter((l) => l.status === 'failed');
  if (failedLinks.length) {
    const lots = new Map<string, string>();
    for (const { holding } of await holdingsWithProducts(db, userId)) {
      if (holding.importRunId === runId && holding.orderId) lots.set(holding.orderId, holding.id);
    }
    for (const link of failedLinks) {
      const holdingId = lots.get(itemIdOf(link) ?? '');
      if (holdingId) {
        await resolvePurchaseLink(db, userId, link.id, holdingId, 'Imported through Claude.');
        linksResolved++;
      }
    }
  }
  const sources = plan.shops.map((s) => s.shop);
  await finishImportRun(db, runId, counts, {
    note,
    source: sources.length === 1 ? sources[0]! : null,
  });
  return { runId, counts, failed, linksResolved };
}
