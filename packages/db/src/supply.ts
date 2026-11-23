import { localDate, toLocalIso } from '@tora/core';
import { and, gte, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import type { Db } from './client';
import { type Supply, notItemMarks, supply } from './schema';

/** One source's report for one item and condition on one day (S9 part 2). */
export interface SupplyRow {
  productId: string;
  source: string;
  bucket: string | null;
  day: string;
  lowestAskBase: number | null;
  lowestAskOriginal: number | null;
  currency: string | null;
  fxRate: number | null;
  listings: number | null;
  url?: string | null;
  raw?: unknown;
  fetchedAt: string;
  /** Game items only (S36 A2): the cheapest listings that passed the item's rules; null: not stored. */
  offers?: SupplyOffer[] | null;
  /** The source caps its count (S36 A4): `listings` is "at least" this many; null: not known. */
  listingsCapped?: boolean | null;
}

/**
 * One stored listing of a game item (`supply.offers`, S36 A2): a listing the for-sale search found
 * that passed the item's rules, the "not the item" marks and the 30 % line. Cheapest first in the
 * row. Unknown stays null (seller, category) or `unknown` (shipping), never guessed.
 */
export interface SupplyOffer {
  /** The listing's id at the source. */
  ref: string;
  title: string;
  url: string | null;
  /** Per unit, in the base currency's smallest unit. */
  priceBase: number;
  /** Per unit, in `currency` as the source shows it. */
  priceOriginal: number;
  /** ISO 4217 code of `priceOriginal`. */
  currency: string;
  /** The seller's id at the source; null when the search does not say. */
  seller: string | null;
  /** The source's category id, as text; null when the listing does not say. */
  category: string | null;
  /** `included`: the seller pays shipping; `buyer`: the buyer pays it; `unknown`: not said. */
  shipping: 'included' | 'buyer' | 'unknown';
  /**
   * The source's own id of who pays shipping, opaque (`shipping` is not derived from it until its
   * meaning is confirmed); null when the listing does not say.
   */
  shippingPayerId: string | null;
}

const SHIPPING = new Set(['included', 'buyer', 'unknown']);
const text = (v: unknown) => (typeof v === 'string' ? v : null);
const amount = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * A supply row's stored listings (`supply.offers`), cheapest first; null when the row stores none
 * (not a game item, the switch off, or written before S36). An entry missing its ref, title or a
 * price is left out, and a field of unknown shape reads as unknown (null, `unknown`), never a guess.
 * Rows of a noAi source are the caller's to leave out, as for every supply row.
 */
export function supplyOffers(row: { offers: unknown }): SupplyOffer[] | null {
  if (!Array.isArray(row.offers)) return null;
  return row.offers.flatMap((o: unknown) => {
    if (!o || typeof o !== 'object') return [];
    const e = o as Record<string, unknown>;
    const ref = text(e.ref);
    const title = text(e.title);
    const priceBase = amount(e.priceBase);
    const priceOriginal = amount(e.priceOriginal);
    const currency = text(e.currency);
    if (!ref || title === null || priceBase === null || priceOriginal === null || !currency)
      return [];
    const shipping = SHIPPING.has(e.shipping as string)
      ? (e.shipping as SupplyOffer['shipping'])
      : 'unknown';
    return [
      {
        ref,
        title,
        url: text(e.url),
        priceBase,
        priceOriginal,
        currency,
        seller: text(e.seller),
        category: text(e.category),
        shipping,
        shippingPayerId: text(e.shippingPayerId),
      },
    ];
  });
}

/** Saves a collect's report; a second collect the same day replaces that day's rows. */
export async function saveSupply(db: Db, rows: SupplyRow[]): Promise<void> {
  if (!rows.length) return;
  const now = toLocalIso();
  for (const r of rows) {
    // `offers` and `listings_capped` are always written (null when not given), so a second collect
    // the same day with the switch off leaves no listings of the first behind.
    const values = {
      ...r,
      bucket: r.bucket ?? '',
      url: r.url ?? null,
      raw: r.raw ?? null,
      offers: r.offers ?? null,
      listingsCapped: r.listingsCapped == null ? null : r.listingsCapped ? 1 : 0,
    };
    await db
      .insert(supply)
      .values({ ...values, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: [supply.productId, supply.source, supply.bucket, supply.day],
        set: { ...values, updatedAt: now },
      });
  }
}

/** Days after which a source's last report no longer counts as "for sale now". */
export const SUPPLY_FRESH_DAYS = 3;

/**
 * A row of what is for sale now. A game's row whose stored listings include some marked "not the
 * item" carries them apart (`markedOffers`), so the page can show them with an undo; the row itself
 * is read without them (`withoutNotItem`).
 */
export type CurrentSupplyRow = Supply & { markedOffers?: SupplyOffer[] };

/** The key of `notItemRefs`. */
export const notItemKey = (productId: string, source: string) => `${productId}|${source}`;

/**
 * The listing refs marked "not the item" (S36 Terms "Checked listing"), by `notItemKey(item,
 * source)`. Marks are shared per item: every person's and the labeled check's count.
 */
export async function notItemRefs(
  db: Pick<Db, 'select'>,
  productIds: readonly string[],
): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  const ids = [...new Set(productIds)];
  for (let i = 0; i < ids.length; i += 500) {
    const rows = await db
      .select({
        productId: notItemMarks.productId,
        source: notItemMarks.source,
        ref: notItemMarks.externalRef,
      })
      .from(notItemMarks)
      .where(inArray(notItemMarks.productId, ids.slice(i, i + 500)));
    for (const r of rows) {
      const key = notItemKey(r.productId, r.source);
      out.set(key, (out.get(key) ?? new Set()).add(r.ref));
    }
  }
  return out;
}

/**
 * A supply row read without its listings marked "not the item" (S36 Terms "Checked listing": a
 * marked listing no longer counts anywhere): only a row with stored listings (`offers`, game items)
 * can change. Its ask is the cheapest listing left (none left: no ask, unknown stays unknown), its
 * link that listing's, its count lowered by the marked ones it stored (more may have been counted
 * than stored: the count stays above zero then, with no ask); the marked ones go to `markedOffers`. A row with nothing marked is returned as it is (cards and sealed: always).
 */
export function withoutNotItem<T extends Supply>(
  row: T,
  marked: ReadonlySet<string> | undefined,
): T & { markedOffers?: SupplyOffer[] } {
  if (!marked?.size || !Array.isArray(row.offers)) return row;
  const offers = supplyOffers(row) ?? [];
  const gone = offers.filter((o) => marked.has(o.ref));
  if (!gone.length) return row;
  const left = offers.filter((o) => !marked.has(o.ref));
  const first = left[0];
  return {
    ...row,
    offers: (row.offers as unknown[]).filter(
      (o) => !(o && typeof o === 'object' && marked.has((o as { ref?: unknown }).ref as string)),
    ),
    lowestAskBase: first?.priceBase ?? null,
    lowestAskOriginal: first?.priceOriginal ?? null,
    currency: first?.currency ?? row.currency,
    // No listing left: no ask, so no rate it was converted at either.
    fxRate: first ? row.fxRate : null,
    url: first?.url ?? null,
    listings: row.listings === null ? null : Math.max(0, row.listings - gone.length),
    markedOffers: gone,
  };
}

/**
 * What is for sale now: per item, each source's latest report (its last collected day within
 * `SUPPLY_FRESH_DAYS`), every condition of that day. A condition missing from that day had nothing
 * for sale. A game's listings marked "not the item" are left out (`withoutNotItem`).
 */
export async function currentSupply(
  db: Db,
  productIds: string[],
  now: Date = new Date(),
): Promise<Map<string, CurrentSupplyRow[]>> {
  const out = new Map<string, CurrentSupplyRow[]>();
  if (!productIds.length) return out;
  const since = localDate(new Date(now.getTime() - SUPPLY_FRESH_DAYS * 86_400_000));
  const rows = await db
    .select()
    .from(supply)
    .where(and(inArray(supply.productId, productIds), gte(supply.day, since)));
  const lastDay = new Map<string, string>();
  for (const r of rows) {
    const key = `${r.productId}|${r.source}`;
    if ((lastDay.get(key) ?? '') < r.day) lastDay.set(key, r.day);
  }
  const latest = rows.filter((r) => lastDay.get(`${r.productId}|${r.source}`) === r.day);
  // Only a game's rows store listings (S36 A2): a page of cards and sealed items reads no mark.
  const withOffers = latest.filter((r) => Array.isArray(r.offers)).map((r) => r.productId);
  const marks = withOffers.length ? await notItemRefs(db, withOffers) : new Map();
  for (const r of latest) {
    const list = out.get(r.productId) ?? [];
    list.push(withoutNotItem(r, marks.get(notItemKey(r.productId, r.source))));
    out.set(r.productId, list);
  }
  for (const list of out.values()) {
    list.sort(
      (a, b) =>
        a.bucket.localeCompare(b.bucket) ||
        (a.lowestAskBase ?? Infinity) - (b.lowestAskBase ?? Infinity),
    );
  }
  return out;
}

/** The cheapest ask in a condition across sources (null when none has one). */
export function lowestAsk(rows: Supply[], bucket: string): Supply | null {
  let best: Supply | null = null;
  for (const r of rows) {
    if (r.bucket !== bucket || r.lowestAskBase === null) continue;
    if (!best || r.lowestAskBase < best.lowestAskBase!) best = r;
  }
  return best;
}

/** Listings in a condition across sources; null when no source said how many. */
export function listingsIn(rows: Supply[], bucket: string): number | null {
  const known = rows.filter((r) => r.bucket === bucket && r.listings !== null);
  return known.length ? known.reduce((n, r) => n + r.listings!, 0) : null;
}

/**
 * Per item, source and condition (`id|source|bucket`), the listing counts reported from `from` to
 * `to`, days included. Rows without a count are left out.
 */
export async function listingHistory(
  db: Pick<Db, 'select'>,
  productIds: string[],
  from: string,
  to: string,
): Promise<Map<string, { day: string; listings: number; filtered: boolean }[]>> {
  const out = new Map<string, { day: string; listings: number; filtered: boolean }[]>();
  if (!productIds.length) return out;
  const rows = await db
    .select({
      productId: supply.productId,
      source: supply.source,
      bucket: supply.bucket,
      day: supply.day,
      listings: supply.listings,
      // A game's count after its rules (S36 A4): never compared with a count from before them.
      filtered: sql<number>`${supply.offers} is not null`,
    })
    .from(supply)
    .where(
      and(
        inArray(supply.productId, productIds),
        gte(supply.day, from),
        lte(supply.day, to),
        isNotNull(supply.listings),
      ),
    );
  for (const r of rows) {
    const key = `${r.productId}|${r.source}|${r.bucket}`;
    out.set(key, [
      ...(out.get(key) ?? []),
      { day: r.day, listings: r.listings!, filtered: !!r.filtered },
    ]);
  }
  return out;
}

/** Moves a duplicate item's reports to the item it is merged into (the target's win). */
export async function moveSupply(db: Pick<Db, 'run'>, fromId: string, intoId: string) {
  await db.run(sql`
    DELETE FROM supply WHERE product_id = ${fromId} AND EXISTS (
      SELECT 1 FROM supply s WHERE s.product_id = ${intoId} AND s.source = supply.source
        AND s.bucket = supply.bucket AND s.day = supply.day)`);
  await db.run(sql`UPDATE supply SET product_id = ${intoId} WHERE product_id = ${fromId}`);
}
