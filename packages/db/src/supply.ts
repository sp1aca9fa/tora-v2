import { localDate, toLocalIso } from '@tora/core';
import { and, gte, inArray, sql } from 'drizzle-orm';
import type { Db } from './client';
import { type Supply, supply } from './schema';

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
}

/** Saves a collect's report; a second collect the same day replaces that day's rows. */
export async function saveSupply(db: Db, rows: SupplyRow[]): Promise<void> {
  if (!rows.length) return;
  const now = toLocalIso();
  for (const r of rows) {
    const values = { ...r, bucket: r.bucket ?? '', url: r.url ?? null, raw: r.raw ?? null };
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
 * What is for sale now: per item, each source's latest report (its last collected day within
 * `SUPPLY_FRESH_DAYS`), every condition of that day. A condition missing from that day had nothing
 * for sale.
 */
export async function currentSupply(
  db: Db,
  productIds: string[],
  now: Date = new Date(),
): Promise<Map<string, Supply[]>> {
  const out = new Map<string, Supply[]>();
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
  for (const r of rows) {
    if (lastDay.get(`${r.productId}|${r.source}`) !== r.day) continue;
    const list = out.get(r.productId) ?? [];
    list.push(r);
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

/** Moves a duplicate item's reports to the item it is merged into (the target's win). */
export async function moveSupply(db: Pick<Db, 'run'>, fromId: string, intoId: string) {
  await db.run(sql`
    DELETE FROM supply WHERE product_id = ${fromId} AND EXISTS (
      SELECT 1 FROM supply s WHERE s.product_id = ${intoId} AND s.source = supply.source
        AND s.bucket = supply.bucket AND s.day = supply.day)`);
  await db.run(sql`UPDATE supply SET product_id = ${intoId} WHERE product_id = ${fromId}`);
}
