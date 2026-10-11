// Purchase links pasted in the app (requirements S4: shops that send no receipt email, e.g.
// Mercari). Run by `pnpm collect` on the home PC: each pending link is read once and goes through
// the same import as receipt emails. Nothing is asked: a lot that looks like an entry added by
// hand gets the link's ID, and everything imported waits for the in-app review.
import {
  type Db,
  type PurchaseLink,
  type PurchaseLinkStatus,
  type Product,
  addSourceReference,
  holdingsWithProducts,
  pendingPurchaseLinks,
  setPurchaseLinkResult,
} from '@tora/db';
import { BlockedError, type PoliteHttp, RequestCapError } from './http';
import { type Decision, applyImport, gatherReceipts, planImport } from './purchases';
import type { Collector, LinkRead, PurchaseImporter, PurchaseReceipt } from './types';

export interface LinkImportSummary {
  read: number;
  counts: Record<Exclude<PurchaseLinkStatus, 'pending'>, number>;
  /** Links left pending (the site blocked us or the request budget ran out). */
  left: number;
}

const yen = (n: number) => `¥${n.toLocaleString('en-US')}`;

export async function importPurchaseLinks(
  db: Db,
  importers: PurchaseImporter[],
  collectors: Collector[],
  http: PoliteHttp,
  log: (message: string) => void = () => {},
): Promise<LinkImportSummary> {
  const pending = await pendingPurchaseLinks(db);
  const summary: LinkImportSummary = {
    read: 0,
    counts: { imported: 0, matched: 0, duplicate: 0, skipped: 0, failed: 0 },
    left: 0,
  };
  const finish = async (
    link: PurchaseLink,
    status: Exclude<PurchaseLinkStatus, 'pending'>,
    message: string | null,
    holdingId: string | null = null,
  ) => {
    await setPurchaseLinkResult(db, link.id, { status, message, holdingId });
    summary.counts[status]++;
    log(`${status}: ${link.url}${message ? ` (${message})` : ''}`);
  };

  // Read every link first, then import per user and shop (one plan, like one mail export).
  const groups = new Map<
    string,
    {
      userId: string;
      importer: PurchaseImporter;
      items: { link: PurchaseLink; receipt: PurchaseReceipt }[];
    }
  >();
  for (const [i, link] of pending.entries()) {
    const importer = importers.find((im) => im.readLink && im.matchesLink?.(link.url));
    if (!importer) {
      await finish(link, 'failed', 'No importer reads links from this site.');
      continue;
    }
    let read: LinkRead;
    try {
      read = await importer.readLink!(link.url, http);
      summary.read++;
    } catch (error) {
      if (error instanceof BlockedError || error instanceof RequestCapError) {
        summary.left = pending.length - i;
        log(`stopped reading links (${String(error)}); the rest stay pending`);
        break;
      }
      await finish(link, 'failed', `Could not read the listing (${String(error)}).`);
      continue;
    }
    if (read.kind !== 'purchase') {
      await finish(link, read.kind === 'skip' ? 'skipped' : 'failed', read.reason);
      continue;
    }
    const key = `${link.userId}|${importer.source}`;
    const group = groups.get(key) ?? { userId: link.userId, importer, items: [] };
    group.items.push({ link, receipt: read.receipt });
    groups.set(key, group);
  }

  for (const { userId, importer, items } of groups.values()) {
    const gathered = gatherReceipts(
      items.map(({ receipt }) => ({ kind: 'purchase' as const, receipt })),
    );
    const plan = await planImport(db, userId, importer, gathered);
    const decisions = new Map<string, Decision>();
    for (const entry of plan) {
      if (entry.type === 'likely') decisions.set(entry.receipt.orderId, 'same');
      if (entry.type === 'conflict') decisions.set(entry.receipt.orderId, 'keep');
      if (entry.type === 'new') {
        const reasons = [...(entry.flags ?? [])];
        if (entry.receipt.dateApprox) reasons.push('date_approx');
        if ('create' in entry.ref) reasons.push('new_product');
        entry.flags = reasons;
      }
    }
    const outcome = await applyImport(db, userId, importer, plan, decisions);
    const failed = new Map(outcome.failed.map((f) => [f.orderId, f.error]));

    // The lots each link ended up as (new ones, or the entries they matched).
    const lots = new Map<string, { holdingId: string; product: Product }>();
    for (const { holding, product } of await holdingsWithProducts(db, userId)) {
      if (holding.orderSource === importer.source && holding.orderId && !lots.has(holding.orderId))
        lots.set(holding.orderId, { holdingId: holding.id, product });
    }
    const collector = collectors.find((c) => c.source === importer.source);
    for (const entry of plan) {
      const { receipt } = entry;
      const lot = lots.get(receipt.orderId);
      const error = failed.get(receipt.orderId);
      let status: Exclude<PurchaseLinkStatus, 'pending'>;
      let message: string | null = null;
      if (error) {
        status = 'failed';
        message = error;
      } else if (entry.type === 'new') {
        status = 'imported';
      } else if (entry.type === 'likely') {
        status = 'matched';
        const h = entry.existing;
        message = `Matched the entry you added on ${h.acquiredAt.slice(0, 10)} (${yen(h.costTotalJpy)}); its order ID was added.`;
      } else if (entry.type === 'duplicate' || entry.type === 'conflict') {
        status = 'duplicate';
        message =
          entry.type === 'conflict'
            ? 'Already registered with different data; kept as registered.'
            : 'Already registered.';
      } else if (entry.type === 'cancelledInApp') {
        status = 'skipped';
        message = 'You marked this order as cancelled.';
      } else {
        status = 'failed';
        message = 'Could not tell what product this is; add it by hand with its order ID.';
      }
      // The listing of the item itself: a sale of exactly this product.
      const product = lot?.product;
      if ((status === 'imported' || status === 'matched') && product && receipt.reference) {
        if (collector?.supports(product)) {
          await addSourceReference(
            db,
            product.id,
            collector.source,
            receipt.reference,
            collector.defaultQuery?.(product) ?? null,
          );
        }
      }
      for (const item of items.filter((x) => x.receipt.orderId === receipt.orderId)) {
        await finish(
          item.link,
          status,
          message,
          status === 'failed' ? null : (lot?.holdingId ?? null),
        );
      }
    }
  }
  return summary;
}
