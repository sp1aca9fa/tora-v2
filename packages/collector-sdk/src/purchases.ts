// Imports marketplace purchases read from emails (requirements S5b). Existing entries are never
// removed or silently changed: a transaction ID already registered is skipped when the data
// agrees and asked about when it does not; an entry without ID that looks like the same purchase
// is asked about too.
import { orderSourceOf, tokyoDate } from '@tora/core';
import {
  type Db,
  type Holding,
  type Product,
  type ProductInput,
  createHolding,
  editHolding,
  cancelledOrderIds,
  findSameProduct,
  flagForReview,
  holdingsWithProducts,
  linkSource,
  listingsOf,
  suggestFromKnownProducts,
} from '@tora/db';
import { termCoverage } from './match';
import type { PurchaseImporter, PurchaseReceipt, ReceiptMail } from './types';

const titleKey = (title: string) => title.normalize('NFKC').replace(/\s+/g, ' ').trim();

/** Days apart that still count as the same purchase (manual entries may use the arrival day). */
const DATE_TOLERANCE_DAYS = 3;
/** Share of a product name's words the receipt title must contain for a likely match. */
const NAME_COVERAGE = 0.6;
/** Purchases this recent (before the export's newest mail) may simply not have arrived yet. */
const IN_TRANSIT_DAYS = 21;

/** Item with more (older) purchases than delivery mails: some may have been cancelled. */
export interface DeliveryGap {
  title: string;
  purchases: number;
  delivered: number;
  /** Purchases within IN_TRANSIT_DAYS of the export's end (not flagged). */
  recent: number;
}

/**
 * Review reasons per transaction ID: notices from the mails (e.g. `deadline_missed`), and
 * `no_delivery` for the older purchases of an item whose delivery mails fall short (the mails do
 * not say which order arrived, so every older purchase of that item is flagged).
 */
export function reviewFlags(
  gathered: GatheredReceipts,
  skip: Set<string> = new Set(),
  /** When the export was made (newest mail of any kind); defaults to the newest receipt. */
  asOf: string | null = gathered.latestAt,
): { flags: Map<string, string[]>; gaps: DeliveryGap[] } {
  const flags = new Map<string, string[]>();
  const add = (id: string, reason: string) =>
    flags.set(id, [...new Set([...(flags.get(id) ?? []), reason])]);
  for (const [id, reasons] of gathered.notices) for (const r of reasons) add(id, r);
  const gaps: DeliveryGap[] = [];
  if (gathered.deliveries.size > 0 && asOf) {
    const recentFrom = Date.parse(asOf) - IN_TRANSIT_DAYS * 86_400_000;
    const byTitle = new Map<string, PurchaseReceipt[]>();
    for (const r of gathered.receipts) {
      if (gathered.cancelled.has(r.orderId) || skip.has(r.orderId)) continue;
      byTitle.set(titleKey(r.title), [...(byTitle.get(titleKey(r.title)) ?? []), r]);
    }
    for (const [title, purchases] of byTitle) {
      const delivered = gathered.deliveries.get(title) ?? 0;
      const older = purchases.filter((r) => Date.parse(r.orderedAt) < recentFrom);
      if (older.length <= delivered) continue;
      gaps.push({
        title,
        purchases: purchases.length,
        delivered,
        recent: purchases.length - older.length,
      });
      for (const r of older) add(r.orderId, 'no_delivery');
    }
  }
  return { flags, gaps };
}

export interface GatheredReceipts {
  /** One receipt per transaction ID, cancelled ones included. */
  receipts: PurchaseReceipt[];
  cancelled: Set<string>;
  unreadable: { subject: string; reason: string }[];
  /** Delivery mails per item title (they may not name the order). */
  deliveries: Map<string, number>;
  /** Reasons to review an order, per transaction ID (e.g. `deadline_missed`). */
  notices: Map<string, Set<string>>;
  /** Newest mail date seen: the export's end, for "may still be on its way". */
  latestAt: string | null;
}

export function gatherReceipts(mails: Iterable<ReceiptMail>): GatheredReceipts {
  const byId = new Map<string, PurchaseReceipt>();
  const cancelled = new Set<string>();
  const unreadable: GatheredReceipts['unreadable'] = [];
  const deliveries = new Map<string, number>();
  const notices = new Map<string, Set<string>>();
  let latestAt: string | null = null;
  const seen = (iso: string) => {
    if (!latestAt || Date.parse(iso) > Date.parse(latestAt)) latestAt = iso;
  };
  for (const mail of mails) {
    if (mail.kind === 'purchase') {
      if (!byId.has(mail.receipt.orderId)) byId.set(mail.receipt.orderId, mail.receipt);
      seen(mail.receipt.orderedAt);
    } else if (mail.kind === 'cancel') cancelled.add(mail.orderId);
    else if (mail.kind === 'delivered') {
      deliveries.set(titleKey(mail.title), (deliveries.get(titleKey(mail.title)) ?? 0) + 1);
      seen(mail.at);
    } else if (mail.kind === 'notice') {
      notices.set(mail.orderId, (notices.get(mail.orderId) ?? new Set()).add(mail.reason));
    } else unreadable.push({ subject: mail.subject, reason: mail.reason });
  }
  const receipts = [...byId.values()].sort((a, b) => a.orderedAt.localeCompare(b.orderedAt));
  return { receipts, cancelled, unreadable, deliveries, notices, latestAt };
}

/** An existing product, or one to create from the receipt. */
export type ProductRef = { existing: Product } | { create: ProductInput };

export interface Diff {
  field: 'cost' | 'quantity' | 'date';
  existing: string | number;
  imported: string | number;
}

export type PlanEntry = (
  | { type: 'new'; receipt: PurchaseReceipt; ref: ProductRef; linked: boolean }
  /** No product is linked to the listing and the title could not be classified. */
  | { type: 'unclassified'; receipt: PurchaseReceipt }
  | { type: 'duplicate'; receipt: PurchaseReceipt; existing: Holding[] }
  | { type: 'conflict'; receipt: PurchaseReceipt; existing: Holding[]; diffs: Diff[] }
  | {
      type: 'likely';
      receipt: PurchaseReceipt;
      existing: Holding;
      product: Product;
      /** How to import it when the user says it is a different purchase. */
      ref: ProductRef | null;
      linked: boolean;
    }
  /** Purchased then cancelled (per the emails): not imported. */
  | { type: 'cancelled'; receipt: PurchaseReceipt }
  /** Cancelled per the emails but registered: reported, never removed. */
  | { type: 'cancelledRegistered'; receipt: PurchaseReceipt; existing: Holding[] }
  /** The user marked this order as cancelled in the app: skipped. */
  | { type: 'cancelledInApp'; receipt: PurchaseReceipt }
) & {
  /** Reasons to review it (see `reviewFlags`); applied to new and existing lots alike. */
  flags?: string[];
};

const dayNumber = (iso: string) => Date.parse(`${tokyoDate(new Date(iso))}T00:00:00Z`) / 86_400_000;
const daysApart = (a: string, b: string) => Math.abs(dayNumber(a) - dayNumber(b));
const paidAmounts = (r: PurchaseReceipt) =>
  [r.totalJpy, r.itemPriceJpy].filter((n): n is number => n != null);

function compare(receipt: PurchaseReceipt, existing: Holding[]): Diff[] {
  const diffs: Diff[] = [];
  const cost = existing.reduce((s, h) => s + h.costTotalJpy, 0);
  const quantity = existing.reduce((s, h) => s + h.quantity, 0);
  if (!paidAmounts(receipt).includes(cost)) {
    diffs.push({ field: 'cost', existing: cost, imported: receipt.totalJpy });
  }
  if (quantity !== receipt.quantity) {
    diffs.push({ field: 'quantity', existing: quantity, imported: receipt.quantity });
  }
  const first = existing[0]!;
  if (daysApart(first.acquiredAt, receipt.orderedAt) > DATE_TOLERANCE_DAYS) {
    diffs.push({
      field: 'date',
      existing: tokyoDate(new Date(first.acquiredAt)),
      imported: tokyoDate(new Date(receipt.orderedAt)),
    });
  }
  return diffs;
}

/** Decides what happens to each receipt; reads only. */
export async function planImport(
  db: Db,
  userId: string,
  importer: PurchaseImporter,
  gathered: GatheredReceipts,
  /** `exportedAt`: newest mail of any kind in the export (for "may still be on the way"). */
  options: { exportedAt?: string | null } = {},
): Promise<PlanEntry[]> {
  const owned = await holdingsWithProducts(db, userId);
  // Receipts may carry no listing link; a listing's title is what the receipt shows.
  const byListingId = new Map<string, Product>();
  const byListingTitle = new Map<string, Product>();
  for (const l of await listingsOf(db, importer.source)) {
    if (l.externalId && !byListingId.has(l.externalId)) byListingId.set(l.externalId, l.product);
    const key = l.title && titleKey(l.title);
    if (key && !byListingTitle.has(key)) byListingTitle.set(key, l.product);
  }
  const listed = (r: PurchaseReceipt) =>
    (r.listing && byListingId.get(r.listing.externalId)) ?? byListingTitle.get(titleKey(r.title));
  const byOrder = new Map<string, Holding[]>();
  for (const { holding } of owned) {
    if (holding.orderSource !== importer.source || !holding.orderId) continue;
    byOrder.set(holding.orderId, [...(byOrder.get(holding.orderId) ?? []), holding]);
  }
  const claimed = new Set<string>();

  const productRef = async (
    receipt: PurchaseReceipt,
  ): Promise<{ ref: ProductRef; linked: boolean } | null> => {
    const linked = listed(receipt);
    if (linked) return { ref: { existing: linked }, linked: true };
    const input = importer.productFor(receipt);
    if (!input) return null;
    const same = await findSameProduct(db, input);
    return { ref: same ? { existing: same } : { create: input }, linked: false };
  };

  const cancelledInApp = await cancelledOrderIds(db, userId, importer.source);
  const { flags } = reviewFlags(gathered, cancelledInApp, options.exportedAt ?? gathered.latestAt);

  const entries: PlanEntry[] = [];
  for (const receipt of gathered.receipts) {
    const existing = byOrder.get(receipt.orderId) ?? [];
    if (cancelledInApp.has(receipt.orderId) && !gathered.cancelled.has(receipt.orderId)) {
      entries.push({ type: 'cancelledInApp', receipt });
      continue;
    }
    if (gathered.cancelled.has(receipt.orderId)) {
      entries.push(
        existing.length
          ? { type: 'cancelledRegistered', receipt, existing }
          : { type: 'cancelled', receipt },
      );
      continue;
    }
    if (existing.length) {
      const diffs = compare(receipt, existing);
      entries.push(
        diffs.length
          ? { type: 'conflict', receipt, existing, diffs }
          : { type: 'duplicate', receipt, existing },
      );
      continue;
    }

    const listingProduct = listed(receipt)?.id;
    const likely = owned
      .filter(
        ({ holding, product }) =>
          !holding.orderId &&
          !claimed.has(holding.id) &&
          holding.acquisitionType === 'purchase' &&
          (!holding.acquiredFrom?.trim() ||
            orderSourceOf(holding.acquiredFrom) === importer.source) &&
          holding.quantity === receipt.quantity &&
          paidAmounts(receipt).includes(holding.costTotalJpy) &&
          daysApart(holding.acquiredAt, receipt.orderedAt) <= DATE_TOLERANCE_DAYS &&
          (product.id === listingProduct ||
            termCoverage([product.name, product.cardNumber ?? ''], receipt.title) >= NAME_COVERAGE),
      )
      .sort(
        (a, b) =>
          Number(b.product.id === listingProduct) - Number(a.product.id === listingProduct) ||
          daysApart(a.holding.acquiredAt, receipt.orderedAt) -
            daysApart(b.holding.acquiredAt, receipt.orderedAt),
      )[0];
    const resolved = await productRef(receipt);
    if (likely) {
      claimed.add(likely.holding.id);
      entries.push({
        type: 'likely',
        receipt,
        existing: likely.holding,
        product: likely.product,
        ref: resolved?.ref ?? null,
        linked: resolved?.linked ?? false,
      });
    } else if (resolved) {
      entries.push({ type: 'new', receipt, ...resolved });
    } else {
      entries.push({ type: 'unclassified', receipt });
    }
  }
  for (const e of entries) {
    const f = flags.get(e.receipt.orderId);
    if (f && e.type !== 'cancelled' && e.type !== 'cancelledInApp') e.flags = f;
  }
  return entries;
}

/**
 * What the user chose, per transaction ID. Conflicts: keep the registered data or take the
 * email's. Likely duplicates: the same purchase (attach the ID), a different one (import it),
 * or skip. Anything not decided is skipped.
 */
export type Decision = 'keep' | 'imported' | 'same' | 'different' | 'skip';

export interface ImportOutcome {
  created: number;
  updated: number;
  attached: number;
  /** Lots already in the app put up for review (e.g. no delivery mail). */
  flagged: number;
  failed: { orderId: string; error: string }[];
}

export async function applyImport(
  db: Db,
  userId: string,
  importer: PurchaseImporter,
  plan: PlanEntry[],
  decisions: Map<string, Decision>,
): Promise<ImportOutcome> {
  const outcome: ImportOutcome = { created: 0, updated: 0, attached: 0, flagged: 0, failed: [] };

  // A product bought several times is created once.
  const createdProducts = new Map<string, Product>();
  const productKey = (p: ProductInput) =>
    JSON.stringify([p.name, p.kind, p.setCode ?? null, p.cardNumber ?? null]);

  const create = async (
    receipt: PurchaseReceipt,
    ref: ProductRef,
    linked: boolean,
    flags: string[] = [],
  ) => {
    const existing = 'existing' in ref ? ref.existing : createdProducts.get(productKey(ref.create));
    const shape = existing ?? ('create' in ref ? ref.create : ref.existing);
    const { product } = await createHolding(
      db,
      userId,
      existing ? { productId: existing.id } : { product: (ref as { create: ProductInput }).create },
      {
        quantity: receipt.quantity,
        costTotalJpy: receipt.totalJpy,
        acquiredAt: receipt.orderedAt,
        acquiredFrom: importer.label,
        acquisitionType: 'purchase',
        orderId: receipt.orderId,
        ...importer.holdingFor?.(receipt, shape),
        // Grade, cert and packaging are checked in the app's import review.
        reviewPending: true,
        reviewReason: flags.length ? flags.join(',') : null,
      },
    );
    if ('create' in ref) {
      createdProducts.set(productKey(ref.create), product);
      if (!receipt.listing) await suggestFromKnownProducts(db, product.id);
    }
    if (receipt.listing && !linked) {
      await linkSource(db, product.id, {
        source: importer.source,
        externalId: receipt.listing.externalId,
        url: receipt.listing.url,
        title: receipt.title,
      });
    }
    outcome.created++;
  };

  for (const entry of plan) {
    const { receipt } = entry;
    const decision = decisions.get(receipt.orderId);
    try {
      if (entry.type === 'new') {
        await create(receipt, entry.ref, entry.linked, entry.flags);
      } else if (
        entry.type === 'conflict' &&
        decision === 'imported' &&
        entry.existing.length === 1
      ) {
        const edit: Parameters<typeof editHolding>[3] = {};
        for (const d of entry.diffs) {
          if (d.field === 'cost') edit.costTotalJpy = receipt.totalJpy;
          if (d.field === 'quantity') edit.quantity = receipt.quantity;
          if (d.field === 'date') edit.acquiredAt = receipt.orderedAt;
        }
        await editHolding(db, userId, entry.existing[0]!.id, edit);
        outcome.updated++;
      } else if (entry.type === 'likely' && decision === 'same') {
        const from = entry.existing.acquiredFrom;
        await editHolding(db, userId, entry.existing.id, {
          orderId: receipt.orderId,
          ...(orderSourceOf(from) === importer.source ? {} : { acquiredFrom: importer.label }),
        });
        outcome.attached++;
      } else if (entry.type === 'likely' && decision === 'different' && entry.ref) {
        await create(receipt, entry.ref, entry.linked, entry.flags);
      }
      // Lots already in the app (or just matched to one) get the same review flags.
      const existing =
        entry.type === 'duplicate' || entry.type === 'conflict'
          ? entry.existing
          : entry.type === 'likely' && decision === 'same'
            ? [entry.existing]
            : [];
      if (entry.flags?.length && existing.length) {
        outcome.flagged += await flagForReview(
          db,
          userId,
          existing.flatMap((h) => entry.flags!.map((reason) => ({ holdingId: h.id, reason }))),
        );
      }
    } catch (error) {
      outcome.failed.push({ orderId: receipt.orderId, error: String(error) });
    }
  }
  return outcome;
}
