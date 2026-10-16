// Buy timing (requirements S9 part 4): the numbers saved daily per item and condition held or
// watched (after the collect), the fixed sample per item type the strategies are tried on, and
// what pages read.
import {
  type DayPrice,
  type SignalStats,
  localDate,
  marketCurrency,
  newSetPattern,
  productClass,
  seriesStats,
  toLocalIso,
} from '@tora/core';
import { and, desc, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm';
import type { Db } from './client';
import { loadSourceRegistry, saveSetting } from './registry';
import { releaseDates, similarKey } from './release';
import {
  type Product,
  appSettings,
  holdings,
  priceObservations,
  products,
  signals,
  watches,
} from './schema';
import { currentSupply, lowestAsk } from './supply';
import { holdingBucket, savedBucketValues } from './valuation';

const DAY = 86_400_000;
/** Daily prices loaded for a day's numbers: a year, plus the 90 days the replay looks ahead. */
const SERIES_DAYS = 365 + 90;

const seriesKey = (productId: string, source: string, bucket: string | null) =>
  `${productId}|${source}|${bucket ?? ''}`;

/**
 * Daily medians of kept sales in the primary market's currency, per product, source and bucket
 * (`seriesKey`), oldest first; from `since` (ISO) or all.
 */
export async function dailySeries(
  db: Db,
  productIds: string[],
  since?: string,
): Promise<Map<string, DayPrice[]>> {
  const out = new Map<string, DayPrice[]>();
  if (productIds.length === 0) return out;
  const currency = marketCurrency(await loadSourceRegistry(db));
  for (let i = 0; i < productIds.length; i += 100) {
    const rows = await db
      .select({
        productId: priceObservations.productId,
        source: priceObservations.source,
        bucket: priceObservations.bucket,
        day: sql<string>`substr(${priceObservations.observedAt}, 1, 10)`,
        prices: sql<string>`group_concat(${priceObservations.priceBase})`,
      })
      .from(priceObservations)
      .where(
        and(
          inArray(priceObservations.productId, productIds.slice(i, i + 100)),
          eq(priceObservations.observationType, 'sold'),
          eq(priceObservations.excluded, false),
          or(isNull(priceObservations.currency), eq(priceObservations.currency, currency)),
          since ? gte(priceObservations.observedAt, since) : undefined,
        ),
      )
      .groupBy(
        priceObservations.productId,
        priceObservations.source,
        priceObservations.bucket,
        sql`substr(${priceObservations.observedAt}, 1, 10)`,
      );
    for (const r of rows) {
      const prices = r.prices
        .split(',')
        .map(Number)
        .sort((a, b) => a - b);
      const mid = Math.floor(prices.length / 2);
      const price = prices.length % 2 ? prices[mid]! : (prices[mid - 1]! + prices[mid]!) / 2;
      const key = seriesKey(r.productId, r.source, r.bucket);
      const list = out.get(key) ?? [];
      list.push({ day: r.day, price, count: prices.length });
      out.set(key, list);
    }
  }
  for (const list of out.values()) list.sort((a, b) => a.day.localeCompare(b.day));
  return out;
}

/** The series of a product + bucket: the given source's, else the one with the most days. */
export function pickSeries(
  all: Map<string, DayPrice[]>,
  productId: string,
  bucket: string | null,
  source?: string | null,
): { source: string; series: DayPrice[] } | null {
  if (source) {
    const own = all.get(seriesKey(productId, source, bucket));
    if (own?.length) return { source, series: own };
  }
  let best: { source: string; series: DayPrice[] } | null = null;
  const prefix = `${productId}|`;
  const suffix = `|${bucket ?? ''}`;
  for (const [key, series] of all) {
    if (!key.startsWith(prefix) || !key.endsWith(suffix)) continue;
    const s = key.slice(prefix.length, key.length - suffix.length);
    if (s.includes('|')) continue;
    if (!best || series.length > best.series.length) best = { source: s, series };
  }
  return best;
}

/** Every item and condition held (owned) or watched by anyone. */
async function valuedPairs(db: Db): Promise<{ product: Product; bucket: string | null }[]> {
  const wanted = new Map<string, { product: Product; bucket: string | null }>();
  for (const { holding, product } of await db
    .select({ holding: holdings, product: products })
    .from(holdings)
    .innerJoin(products, eq(products.id, holdings.productId))
    .where(eq(holdings.status, 'owned'))) {
    const bucket = holdingBucket(holding, product);
    wanted.set(`${product.id}|${bucket ?? ''}`, { product, bucket });
  }
  for (const { watch, product } of await db
    .select({ watch: watches, product: products })
    .from(watches)
    .innerJoin(products, eq(products.id, watches.productId))) {
    wanted.set(`${product.id}|${watch.bucket}`, { product, bucket: watch.bucket || null });
  }
  return [...wanted.values()];
}

/**
 * Today's numbers for every item and condition held or watched, saved (one row per day; a second
 * collect the same day replaces it). Then the fixed samples are picked if missing.
 */
export async function refreshSignals(
  db: Db,
  now = new Date(),
  /** False: work everything out without saving (checks on real data). */
  save = true,
): Promise<{
  saved: number;
  withPattern: number;
  rows: { productId: string; bucket: string; source: string | null; stats: SignalStats }[];
}> {
  const pairs = await valuedPairs(db);
  if (pairs.length === 0) return { saved: 0, withPattern: 0, rows: [] };
  const today = localDate(now);
  const productIds = [...new Set(pairs.map((p) => p.product.id))];
  const since = toLocalIso(new Date(now.getTime() - SERIES_DAYS * DAY));
  const [values, series, supply, released] = await Promise.all([
    savedBucketValues(db, pairs, now),
    dailySeries(db, productIds, since),
    currentSupply(db, productIds, now),
    releaseDates(
      db,
      pairs.map((p) => p.product),
    ),
  ]);

  // The new-set pattern per group and bucket, for items in their first year: every similar
  // item's whole history (any person's), loaded once per group.
  const groups = new Map<string, { id: string; release: string; series: DayPrice[] }[]>();
  // A first collected sale is not a release date (collecting may start years later): the
  // pattern needs the set's date or the item's own, for the item and the items it is compared to.
  const known = (r: { from: string } | undefined) => !!r && r.from !== 'first_sale';
  const young = pairs.filter((p) => {
    const r = released.get(p.product.id);
    return known(r) && (now.getTime() - Date.parse(`${r!.date}T00:00:00Z`)) / DAY <= 365;
  });
  if (young.length) {
    const keys = new Set(young.map((p) => similarKey(p.product)).filter((k) => k !== null));
    const all = (await db.select().from(products)).filter((p) => keys.has(similarKey(p) ?? ''));
    const [history, dates] = await Promise.all([
      dailySeries(
        db,
        all.map((p) => p.id),
      ),
      releaseDates(db, all),
    ]);
    for (const p of young) {
      const key = similarKey(p.product);
      const groupKey = `${key}|${p.bucket ?? ''}`;
      if (!key || groups.has(groupKey)) continue;
      groups.set(
        groupKey,
        all.flatMap((o) => {
          const r = dates.get(o.id);
          const s = pickSeries(history, o.id, p.bucket);
          return r && known(r) && s ? [{ id: o.id, release: r.date, series: s.series }] : [];
        }),
      );
    }
  }

  const rows: { productId: string; bucket: string; source: string | null; stats: SignalStats }[] =
    [];
  let withPattern = 0;
  for (const { product, bucket } of pairs) {
    const value = values.get(`${product.id}|${bucket ?? ''}`);
    const valued = value?.valuation.source;
    const picked = pickSeries(
      series,
      product.id,
      bucket,
      valued && valued !== 'manual' ? valued : null,
    );
    const r = released.get(product.id);
    const ageDays = r
      ? Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${r.date}T00:00:00Z`)) / DAY)
      : null;
    const others = (groups.get(`${similarKey(product)}|${bucket ?? ''}`) ?? []).filter(
      (o) => o.id !== product.id,
    );
    const pattern = ageDays !== null && known(r) ? newSetPattern(ageDays, others, today) : null;
    if (pattern) withPattern++;
    const ask = lowestAsk(supply.get(product.id) ?? [], bucket ?? '');
    rows.push({
      productId: product.id,
      bucket: bucket ?? '',
      source: picked?.source ?? null,
      stats: {
        ...seriesStats(picked?.series ?? [], today, value?.valuation.unitBase ?? null),
        ask: ask?.lowestAskBase ?? null,
        ageDays,
        releaseFrom: r?.from ?? null,
        pattern,
      },
    });
  }
  if (!save) return { saved: 0, withPattern, rows };
  const at = toLocalIso(now);
  for (let i = 0; i < rows.length; i += 100) {
    await db
      .insert(signals)
      .values(
        rows.slice(i, i + 100).map((r) => ({ ...r, day: today, createdAt: at, updatedAt: at })),
      )
      .onConflictDoUpdate({
        target: [signals.productId, signals.bucket, signals.day],
        set: { source: sql`excluded.source`, stats: sql`excluded.stats`, updatedAt: at },
      });
  }
  await pickSamples(db, now);
  return { saved: rows.length, withPattern, rows };
}

/** Days after which an item's last numbers no longer count as today's. */
export const SIGNAL_FRESH_DAYS = 3;

/** The latest numbers (within 3 days) of item + condition pairs, by `product|bucket`. */
export async function latestSignals(
  db: Db,
  wanted: { productId: string; bucket: string | null }[],
  now = new Date(),
): Promise<Map<string, (typeof signals)['$inferSelect']>> {
  const out = new Map<string, (typeof signals)['$inferSelect']>();
  const ids = [...new Set(wanted.map((w) => w.productId))];
  if (ids.length === 0) return out;
  const from = localDate(new Date(now.getTime() - SIGNAL_FRESH_DAYS * DAY));
  const keys = new Set(wanted.map((w) => `${w.productId}|${w.bucket ?? ''}`));
  for (let i = 0; i < ids.length; i += 200) {
    const rows = await db
      .select()
      .from(signals)
      .where(and(inArray(signals.productId, ids.slice(i, i + 200)), gte(signals.day, from)))
      .orderBy(desc(signals.day));
    for (const r of rows) {
      const key = `${r.productId}|${r.bucket}`;
      if (keys.has(key) && !out.has(key)) out.set(key, r);
    }
  }
  return out;
}

/** The fixed sample per item type the strategies are tried on (app setting). */
export interface StrategySample {
  productId: string;
  bucket: string | null;
  source: string;
}

/**
 * Picks, once per item type, the item and condition with the most days with sales over the last
 * two years (the same for everyone; kept while the item exists).
 */
async function pickSamples(db: Db, now: Date): Promise<void> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, 'strategySamples'));
  const current = (row?.value ?? {}) as Record<string, StrategySample>;
  const all = await db.select().from(products);
  const byId = new Map(all.map((p) => [p.id, p]));
  const types = new Set(all.map((p) => productClass(p)));
  const kept = Object.fromEntries(Object.entries(current).filter(([, s]) => byId.has(s.productId)));
  const missing = [...types].filter((t) => !kept[t]);
  if (missing.length === 0 && Object.keys(kept).length === Object.keys(current).length) return;
  if (missing.length) {
    const since = toLocalIso(new Date(now.getTime() - 2 * 365 * DAY));
    const counts = await db
      .select({
        productId: priceObservations.productId,
        source: priceObservations.source,
        bucket: priceObservations.bucket,
        n: sql<number>`count(DISTINCT substr(${priceObservations.observedAt}, 1, 10))`,
      })
      .from(priceObservations)
      .where(
        and(
          eq(priceObservations.observationType, 'sold'),
          eq(priceObservations.excluded, false),
          gte(priceObservations.observedAt, since),
        ),
      )
      .groupBy(priceObservations.productId, priceObservations.source, priceObservations.bucket)
      .orderBy(desc(sql`count(DISTINCT substr(${priceObservations.observedAt}, 1, 10))`));
    for (const c of counts) {
      const p = byId.get(c.productId);
      const type = p && productClass(p);
      if (!type || kept[type] || !missing.includes(type) || c.n < 30) continue;
      kept[type] = { productId: c.productId, bucket: c.bucket, source: c.source };
    }
  }
  await saveSetting(db, 'strategySamples', kept);
}

/** The fixed samples, by item type. */
export async function strategySamples(db: Db): Promise<Record<string, StrategySample>> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, 'strategySamples'));
  return (row?.value ?? {}) as Record<string, StrategySample>;
}

/** A sample's product and its daily prices over the last two years (a year replayed, each day
 * judged on the year before it). */
export async function sampleSeries(
  db: Db,
  sample: StrategySample,
  now = new Date(),
): Promise<{ product: Product; series: DayPrice[] } | null> {
  const [product] = await db.select().from(products).where(eq(products.id, sample.productId));
  if (!product) return null;
  const since = toLocalIso(new Date(now.getTime() - 2 * 365 * DAY));
  const all = await dailySeries(db, [product.id], since);
  return { product, series: all.get(seriesKey(product.id, sample.source, sample.bucket)) ?? [] };
}

/** The item types a person owns (for their strategy choices). */
export async function heldItemTypes(db: Db, userId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({
      category: products.category,
      kind: products.kind,
      itemType: products.itemType,
    })
    .from(holdings)
    .innerJoin(products, eq(products.id, holdings.productId))
    .where(and(eq(holdings.userId, userId), eq(holdings.status, 'owned')));
  return [...new Set(rows.map((r) => productClass(r)))];
}
