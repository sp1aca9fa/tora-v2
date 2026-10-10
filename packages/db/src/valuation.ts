// Holding valuation, box view, manual prices and daily snapshots (requirements section 6, S5).
import {
  type LastSale,
  type RecentSaleInput,
  type SourceSummary,
  type Valuation,
  type ValuationObservation,
  buylistFloor,
  deriveBucket,
  median,
  productClass,
  tokyoDate,
  toTokyoIso,
  lastSale,
  sourceSummaries,
  trend,
  valueUnit,
} from '@tora/core';
import { and, asc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { Db } from './client';
import {
  type Holding,
  type HoldingEvent,
  type Product,
  holdingEvents,
  holdings,
  manualPrices,
  priceObservations,
  productSources,
  products,
  valuationSnapshots,
} from './schema';

const DAY = 86_400_000;
/** Valuation looks back 180 days; snapshot backfill adds 90 more. */
const LOOKBACK_DAYS = 180 + 90;

export interface HoldingValuation extends Valuation {
  bucket: string | null;
  /** Newest real sale in the bucket (any source), shown next to the median value. */
  last: LastSale | null;
  /** Last sale vs the value, in percent. */
  trendPct: number | null;
  /** Each source's last sale and median, for side-by-side comparison. */
  sources: SourceSummary[];
  /** Unit value x quantity. */
  valueJpy: number | null;
  buylist: { priceJpy: number; source: string; observedAt: string } | null;
}

export interface MarketData {
  observations: Map<string, ValuationObservation[]>;
  recent: Map<string, RecentSaleInput[]>;
  manual: Map<string, { bucket: string; priceJpy: number; setAt: string }[]>;
}

/** Observations (sold + buylist) and the user's manual prices for a set of products. */
export async function loadMarketData(
  db: Db,
  userId: string,
  productIds: string[],
  now = new Date(),
  /** Oldest observation to load (ISO); defaults to what valuing `now` needs. */
  since: string = toTokyoIso(new Date(now.getTime() - LOOKBACK_DAYS * DAY)),
): Promise<MarketData> {
  const observations = new Map<string, ValuationObservation[]>();
  const recent = new Map<string, RecentSaleInput[]>();
  const manual = new Map<string, { bucket: string; priceJpy: number; setAt: string }[]>();
  if (productIds.length === 0) return { observations, recent, manual };
  for (let i = 0; i < productIds.length; i += 200) {
    const ids = productIds.slice(i, i + 200);
    const rows = await db
      .select({
        productId: priceObservations.productId,
        source: priceObservations.source,
        bucket: priceObservations.bucket,
        priceJpy: priceObservations.priceJpy,
        observedAt: priceObservations.observedAt,
        observationType: priceObservations.observationType,
        excluded: priceObservations.excluded,
      })
      .from(priceObservations)
      .where(
        and(
          inArray(priceObservations.productId, ids),
          inArray(priceObservations.observationType, ['sold', 'buylist']),
          eq(priceObservations.excluded, false),
          gte(priceObservations.observedAt, since),
        ),
      );
    for (const { productId, ...o } of rows) {
      const list = observations.get(productId);
      if (list) list.push(o);
      else observations.set(productId, [o]);
    }
    const prices = await db
      .select()
      .from(manualPrices)
      .where(and(eq(manualPrices.userId, userId), inArray(manualPrices.productId, ids)));
    for (const p of prices) manual.set(p.productId, [...(manual.get(p.productId) ?? []), p]);
    const links = await db
      .select({
        productId: productSources.productId,
        source: productSources.source,
        recentSales: productSources.recentSales,
      })
      .from(productSources)
      .where(and(inArray(productSources.productId, ids), eq(productSources.active, true)));
    for (const l of links) {
      const sales = (l.recentSales ?? []).map((r) => ({ ...r, source: l.source }));
      recent.set(l.productId, [...(recent.get(l.productId) ?? []), ...sales]);
    }
  }
  return { observations, recent, manual };
}

export function holdingBucket(holding: Holding, product: Product): string | null {
  return deriveBucket({ productClass: productClass(product), ...holding });
}

export function valueHolding(
  holding: Holding,
  product: Product,
  market: MarketData,
  now = new Date(),
  bucket = holdingBucket(holding, product),
): HoldingValuation {
  const observations = market.observations.get(product.id) ?? [];
  const v = valueUnit({
    bucket,
    observations,
    manualPrices: market.manual.get(product.id),
    retailPriceJpy: product.retailPriceJpy,
    now,
  });
  const recent = market.recent.get(product.id) ?? [];
  const last = lastSale(observations, recent, bucket, undefined, now);
  return {
    ...v,
    bucket,
    valueJpy: v.unitJpy === null ? null : v.unitJpy * holding.quantity,
    buylist: buylistFloor(observations, bucket, now),
    last,
    trendPct: v.method === 'median' ? trend(last?.priceJpy, v.unitJpy) : null,
    sources: sourceSummaries(observations, recent, bucket, now),
  };
}

// ---------------------------------------------------------------------------------------------
// portfolio

export interface PortfolioRow {
  holding: Holding;
  product: Product;
  valuation: HoldingValuation;
}

/** The user's owned holdings, valued now, with totals and a breakdown by category / kind. */
export async function portfolioValuation(db: Db, userId: string, now = new Date()) {
  const rows = await db
    .select({ holding: holdings, product: products })
    .from(holdings)
    .innerJoin(products, eq(products.id, holdings.productId))
    .where(and(eq(holdings.userId, userId), eq(holdings.status, 'owned')));
  const market = await loadMarketData(db, userId, [...new Set(rows.map((r) => r.product.id))], now);
  const valued: PortfolioRow[] = rows.map((r) => ({
    ...r,
    valuation: valueHolding(r.holding, r.product, market, now),
  }));

  const totals = {
    spentJpy: 0,
    valueJpy: 0,
    valuedCostJpy: 0,
    valued: 0,
    total: valued.length,
    units: 0,
  };
  const breakdown = new Map<
    string,
    { category: string; kind: string; costJpy: number; valueJpy: number; count: number }
  >();
  for (const { holding, product, valuation } of valued) {
    totals.spentJpy += holding.costTotalJpy;
    totals.units += holding.quantity;
    if (valuation.valueJpy !== null) {
      totals.valueJpy += valuation.valueJpy;
      totals.valuedCostJpy += holding.costTotalJpy;
      totals.valued++;
    }
    const key = `${product.category}:${product.kind}`;
    const b = breakdown.get(key) ?? {
      category: product.category,
      kind: product.kind,
      costJpy: 0,
      valueJpy: 0,
      count: 0,
    };
    b.costJpy += holding.costTotalJpy;
    b.valueJpy += valuation.valueJpy ?? 0;
    b.count += holding.quantity;
    breakdown.set(key, b);
  }
  return {
    rows: valued,
    totals: { ...totals, unrealizedJpy: totals.valueJpy - totals.valuedCostJpy },
    breakdown: [...breakdown.values()].sort(
      (a, b) => b.valueJpy + b.costJpy - (a.valueJpy + a.costJpy),
    ),
  };
}

// ---------------------------------------------------------------------------------------------
// box view (sealed holding + its pulls)

export async function boxView(db: Db, userId: string, holdingId: string, now = new Date()) {
  const [box] = await db
    .select({ holding: holdings, product: products })
    .from(holdings)
    .innerJoin(products, eq(products.id, holdings.productId))
    .where(and(eq(holdings.id, holdingId), eq(holdings.userId, userId)));
  if (!box || productClass(box.product) !== 'sealed') return null;

  const pulls = await db
    .select({ holding: holdings, product: products })
    .from(holdings)
    .innerJoin(products, eq(products.id, holdings.productId))
    .where(and(eq(holdings.parentHoldingId, holdingId), eq(holdings.userId, userId)))
    .orderBy(asc(holdings.createdAt));
  const [acquired] = await db
    .select()
    .from(holdingEvents)
    .where(and(eq(holdingEvents.holdingId, holdingId), eq(holdingEvents.type, 'acquired')));
  // The state the box was received in (e.g. opened by the clerk, packs sealed).
  const receivedState =
    ((acquired?.payload ?? {}) as { packagingState?: Holding['packagingState'] }).packagingState ??
    box.holding.packagingState;
  const receivedBucket = deriveBucket({ productClass: 'sealed', packagingState: receivedState });

  const market = await loadMarketData(
    db,
    userId,
    [box.product.id, ...pulls.map((p) => p.product.id)],
    now,
  );
  const asReceived = valueHolding(box.holding, box.product, market, now, receivedBucket);
  const pullRows = pulls.map((p) => ({
    ...p,
    valuation: valueHolding(p.holding, p.product, market, now),
  }));
  // Pulls that were sold count at their sale price; others at current value.
  const pullsValueJpy = pullRows.reduce((sum, p) => sum + (p.valuation.valueJpy ?? 0), 0);
  return {
    box,
    receivedState,
    asReceivedBucket: receivedBucket,
    paidJpy: box.holding.costTotalJpy,
    asReceived,
    pulls: pullRows,
    pullsValueJpy,
    pullsValued: pullRows.filter((p) => p.valuation.valueJpy !== null).length,
    netJpy: pullsValueJpy - box.holding.costTotalJpy,
  };
}

// ---------------------------------------------------------------------------------------------
// manual prices

export async function setManualPrice(
  db: Db,
  userId: string,
  productId: string,
  bucket: string,
  priceJpy: number,
  note?: string | null,
): Promise<void> {
  if (!Number.isSafeInteger(priceJpy) || priceJpy < 0) throw new RangeError('invalid price');
  await db
    .insert(manualPrices)
    .values({ userId, productId, bucket, priceJpy, setAt: toTokyoIso(), note: note ?? null });
}

export async function clearManualPrice(db: Db, userId: string, productId: string, bucket: string) {
  await db
    .delete(manualPrices)
    .where(
      and(
        eq(manualPrices.userId, userId),
        eq(manualPrices.productId, productId),
        eq(manualPrices.bucket, bucket),
      ),
    );
}

// ---------------------------------------------------------------------------------------------
// snapshots

/** End of a Tokyo calendar day. */
const endOfDay = (day: string) => new Date(`${day}T23:59:59.999+09:00`);

/** Whether a holding was held on `day`: acquired by then, not yet sold or used up. */
export function heldOn(holding: Holding, events: HoldingEvent[], day: string): boolean {
  if (holding.acquiredAt.slice(0, 10) > day) return false;
  const ended = events.find(
    (e) =>
      e.type === 'sold' ||
      (e.type === 'opened' &&
        (e.payload as { after?: { status?: string } } | null)?.after?.status === 'consumed'),
  );
  if (ended) return ended.occurredAt.slice(0, 10) > day;
  return holding.status === 'owned' || holding.status === 'consumed' || holding.status === 'sold';
}

/** Longest valuation window: a day's value only looks at sales up to this far back. */
const WINDOW_DAYS = 180;
/** How far back the chart can go. */
const MAX_HISTORY_DAYS = 3 * 366;

/**
 * Daily job (after collectors): rebuilds the snapshot of every holding for every day it was held,
 * from its acquisition date, valued with the sales known by the end of that day. Recomputing all
 * days picks up sales history that arrived late and holdings added or edited afterwards; only rows
 * whose numbers changed are written, and rows of days a holding was not held are removed.
 */
export async function runSnapshots(db: Db, now = new Date()) {
  const today = tokyoDate(now);
  const rows = (
    await db
      .select({ holding: holdings, product: products })
      .from(holdings)
      .innerJoin(products, eq(products.id, holdings.productId))
  ).filter((r) => r.holding.status !== 'lost');
  const oldest = tokyoDate(new Date(now.getTime() - MAX_HISTORY_DAYS * DAY));
  const first = rows.reduce(
    (min, r) => (r.holding.acquiredAt.slice(0, 10) < min ? r.holding.acquiredAt.slice(0, 10) : min),
    today,
  );
  const start = first < oldest ? oldest : first;
  const days: string[] = [];
  for (let t = Date.parse(`${start}T12:00:00+09:00`); ; t += DAY) {
    const day = tokyoDate(new Date(t));
    if (day > today) break;
    days.push(day);
  }

  const eventsBy = new Map<string, HoldingEvent[]>();
  for (const e of await db.select().from(holdingEvents)) {
    const list = eventsBy.get(e.holdingId);
    if (list) list.push(e);
    else eventsBy.set(e.holdingId, [e]);
  }
  const since = toTokyoIso(new Date(Date.parse(`${start}T00:00:00+09:00`) - WINDOW_DAYS * DAY));
  const markets = new Map<string, MarketData>();
  for (const userId of new Set(rows.map((r) => r.holding.userId))) {
    const ids = [
      ...new Set(rows.filter((r) => r.holding.userId === userId).map((r) => r.product.id)),
    ];
    markets.set(userId, await loadMarketData(db, userId, ids, now, since));
  }

  // Sales per user + product + bucket, oldest first, so each day only scans its window.
  const series = new Map<string, { at: number[]; observations: ValuationObservation[] }>();
  const seriesFor = (userId: string, productId: string, bucket: string | null) => {
    const key = `${userId}|${productId}|${bucket}`;
    let s = series.get(key);
    if (!s) {
      const observations = (markets.get(userId)!.observations.get(productId) ?? [])
        .filter((o) => o.bucket === bucket)
        .toSorted((a, b) => a.observedAt.localeCompare(b.observedAt));
      s = { at: observations.map((o) => Date.parse(o.observedAt)), observations };
      series.set(key, s);
    }
    return s;
  };
  const lowerBound = (xs: number[], x: number) => {
    let lo = 0;
    let hi = xs.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (xs[mid]! < x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const unitCache = new Map<string, Valuation>();
  const unitOn = (userId: string, product: Product, bucket: string | null, day: string) => {
    const key = `${userId}|${product.id}|${bucket}|${day}`;
    let v = unitCache.get(key);
    if (!v) {
      const at = endOfDay(day);
      const s = seriesFor(userId, product.id, bucket);
      const from = lowerBound(s.at, at.getTime() - WINDOW_DAYS * DAY);
      const to = lowerBound(s.at, at.getTime() + 1);
      v = valueUnit({
        bucket,
        observations: s.observations.slice(from, to),
        manualPrices: markets.get(userId)!.manual.get(product.id),
        retailPriceJpy: product.retailPriceJpy,
        now: at,
      });
      unitCache.set(key, v);
    }
    return v;
  };

  type Row = typeof valuationSnapshots.$inferInsert;
  const wanted = new Map<string, Row>();
  for (const { holding, product } of rows) {
    const events = eventsBy.get(holding.id) ?? [];
    const bucket = holdingBucket(holding, product);
    for (const day of days) {
      if (!heldOn(holding, events, day)) continue;
      const v = unitOn(holding.userId, product, bucket, day);
      wanted.set(`${day}|${holding.id}`, {
        date: day,
        holdingId: holding.id,
        valueJpy: v.unitJpy === null ? null : v.unitJpy * holding.quantity,
        method: v.method,
        source: v.source,
        sampleSize: v.sampleSize,
        confidence: v.confidence,
      });
    }
  }

  const existing = await db.select().from(valuationSnapshots);
  const stale: string[] = [];
  const unchanged = new Set<string>();
  for (const e of existing) {
    const key = `${e.date}|${e.holdingId}`;
    const w = wanted.get(key);
    if (!w) stale.push(e.id);
    else if (
      w.valueJpy === e.valueJpy &&
      w.method === e.method &&
      w.source === e.source &&
      w.sampleSize === e.sampleSize &&
      w.confidence === e.confidence
    ) {
      unchanged.add(key);
    }
  }
  const changed = [...wanted.entries()].filter(([k]) => !unchanged.has(k)).map(([, r]) => r);
  for (let i = 0; i < changed.length; i += 100) {
    await db
      .insert(valuationSnapshots)
      .values(changed.slice(i, i + 100))
      .onConflictDoUpdate({
        target: [valuationSnapshots.date, valuationSnapshots.holdingId],
        set: {
          valueJpy: sql`excluded.value_jpy`,
          method: sql`excluded.method`,
          source: sql`excluded.source`,
          sampleSize: sql`excluded.sample_size`,
          confidence: sql`excluded.confidence`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }
  for (let i = 0; i < stale.length; i += 500) {
    await db
      .delete(valuationSnapshots)
      .where(inArray(valuationSnapshots.id, stale.slice(i, i + 500)));
  }
  return { days: days.length, rows: changed.length, removed: stale.length };
}

/**
 * Value and cost per day for the user's chart. Cost is everything held that day; value is the
 * market value, with holdings that have no market value yet counted at cost (`atCostJpy`).
 */
export async function portfolioSeries(
  db: Db,
  userId: string,
  days = MAX_HISTORY_DAYS,
  now = new Date(),
) {
  const since = tokyoDate(new Date(now.getTime() - days * DAY));
  return db
    .select({
      date: valuationSnapshots.date,
      valueJpy: sql<number>`coalesce(sum(coalesce(${valuationSnapshots.valueJpy}, ${holdings.costTotalJpy})), 0)`,
      costJpy: sql<number>`coalesce(sum(${holdings.costTotalJpy}), 0)`,
      atCostJpy: sql<number>`coalesce(sum(case when ${valuationSnapshots.valueJpy} is null then ${holdings.costTotalJpy} end), 0)`,
    })
    .from(valuationSnapshots)
    .innerJoin(holdings, eq(holdings.id, valuationSnapshots.holdingId))
    .where(and(eq(holdings.userId, userId), gte(valuationSnapshots.date, since)))
    .groupBy(valuationSnapshots.date)
    .orderBy(asc(valuationSnapshots.date));
}

export interface PricePoint {
  day: string;
  source: string;
  bucket: string | null;
  medianJpy: number;
  count: number;
}

/** Daily sold medians per source + bucket for a product's price chart. */
export async function priceHistory(
  db: Db,
  productId: string,
  days = 365,
  now = new Date(),
): Promise<PricePoint[]> {
  const since = toTokyoIso(new Date(now.getTime() - days * DAY));
  const rows = await db
    .select({
      observedAt: priceObservations.observedAt,
      source: priceObservations.source,
      bucket: priceObservations.bucket,
      priceJpy: priceObservations.priceJpy,
    })
    .from(priceObservations)
    .where(
      and(
        eq(priceObservations.productId, productId),
        eq(priceObservations.observationType, 'sold'),
        eq(priceObservations.excluded, false),
        gte(priceObservations.observedAt, since),
      ),
    );
  const groups = new Map<
    string,
    { day: string; source: string; bucket: string | null; prices: number[] }
  >();
  for (const r of rows) {
    const day = r.observedAt.slice(0, 10);
    const key = `${day}\u0000${r.source}\u0000${r.bucket ?? ''}`;
    const g = groups.get(key) ?? { day, source: r.source, bucket: r.bucket, prices: [] };
    g.prices.push(r.priceJpy);
    groups.set(key, g);
  }
  return [...groups.values()]
    .map((g) => ({
      day: g.day,
      source: g.source,
      bucket: g.bucket,
      medianJpy: Math.round(median(g.prices)!),
      count: g.prices.length,
    }))
    .sort((a, b) => a.day.localeCompare(b.day));
}
