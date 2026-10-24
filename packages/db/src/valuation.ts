// Holding valuation, box view, manual prices and daily snapshots (requirements section 6, S5).
import {
  INSIGHT_PERIODS,
  type LastSale,
  type RecentSaleInput,
  type SourceSummary,
  type Valuation,
  type ValuationObservation,
  LONG_WINDOW,
  ageDays,
  bucketFamily,
  buylistFloor,
  deriveBucket,
  median,
  type ProductClass,
  productClass,
  localDate,
  toLocalIso,
  localTime,
  lastSale,
  sourceSummaries,
  trend,
  valuationOrder,
  marketCurrency,
  valueUnit,
  type Pools,
  conditionPools,
  itemTypes,
  resolveTaxonomy,
} from '@tora/core';
import { type SQL, and, asc, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import type { Db } from './client';
import { daysBack, loadItemSales, soldDays, unpackSales } from './item-sales';
import { loadSourceRegistry, readSetting, saveSetting } from './registry';
import {
  type Holding,
  type HoldingEvent,
  type DayValue,
  type PortfolioPoint,
  type RecentValues,
  type Product,
  appSettings,
  bucketValues,
  holdingEvents,
  holdingValues,
  holdings,
  manualPrices,
  portfolioCharts,
  priceObservations,
  productSources,
  products,
  watches,
} from './schema';

const DAY = 86_400_000;

/**
 * A batch write that can safely run twice (an upsert or a delete), tried again when the
 * connection drops: big rebuilds (e.g. a year of snapshots for new lots) send many batches.
 */
async function retried<T>(write: () => Promise<T>, tries = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await write();
    } catch (error) {
      if (
        attempt >= tries ||
        !/fetch failed|socket|ECONNRESET|other side closed/i.test(
          String(error) + String((error as { cause?: unknown }).cause),
        )
      )
        throw error;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}
/** Valuation looks back 180 days; snapshot backfill adds 90 more. */
/** Sales loaded for a valuation: the year-long fallback window, plus a margin for charts. */
const LOOKBACK_DAYS = LONG_WINDOW + 90;

export interface HoldingValuation extends Valuation {
  bucket: string | null;
  /** Newest real sale in the bucket (any source), shown next to the median value. */
  last: LastSale | null;
  /** Last sale vs the value, in percent. */
  trendPct: number | null;
  /** Each source's last sale and median, for side-by-side comparison. */
  sources: SourceSummary[];
  /** Unit value x quantity. */
  valueBase: number | null;
  buylist: { priceBase: number; source: string; observedAt: string } | null;
}

export interface MarketData {
  observations: Map<string, ValuationObservation[]>;
  recent: Map<string, RecentSaleInput[]>;
  manual: Map<string, { bucket: string; priceBase: number; setAt: string }[]>;
  /**
   * Sources valued per item class, best first (the source registry's roles); empty when no
   * source is described yet (then every source counts).
   */
  order: Partial<Record<ProductClass, string[]>>;
  /** Pool groups of the admin's condition lists (S16). */
  pools?: Pools;
}

/** The currency of the prices a valuation uses (the primary market's). */
const valuedCurrency = async (db: Db) => marketCurrency(await loadSourceRegistry(db));

/** The registry's valuation order per item type, and the condition lists' pool groups. */
async function valuationSettings(
  db: Db,
): Promise<{ order: Partial<Record<ProductClass, string[]>>; pools: Pools }> {
  const registry = await loadSourceRegistry(db);
  const pools = conditionPools(registry.taxonomy?.lists ?? []);
  if (registry.sources.length === 0) return { order: {}, pools };
  const types = itemTypes(registry.taxonomy ?? resolveTaxonomy(null)).map((t) => t.key);
  return {
    order: Object.fromEntries(types.map((cls) => [cls, valuationOrder(registry, cls)])),
    pools,
  };
}

/** Each product's manual prices (of the user; none for null) and its listings' recent sales. */
async function manualAndRecent(db: Db, userId: string | null, productIds: string[]) {
  const recent = new Map<string, RecentSaleInput[]>();
  const manual = new Map<string, { bucket: string; priceBase: number; setAt: string }[]>();
  for (let i = 0; i < productIds.length; i += 200) {
    const ids = productIds.slice(i, i + 200);
    if (userId) {
      const prices = await db
        .select()
        .from(manualPrices)
        .where(and(eq(manualPrices.userId, userId), inArray(manualPrices.productId, ids)));
      for (const p of prices) manual.set(p.productId, [...(manual.get(p.productId) ?? []), p]);
    }
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
  return { recent, manual };
}

/**
 * Observations (sales, shop asks and buy prices of the primary market's currency, kept ones, from
 * `since`) and the user's manual prices for a set of products, from the packed item sales: one
 * row per product.
 */
export async function loadMarketData(
  db: Db,
  userId: string | null,
  productIds: string[],
  now = new Date(),
  /** Oldest observation to load (ISO); defaults to what valuing `now` needs. */
  since: string = toLocalIso(new Date(now.getTime() - LOOKBACK_DAYS * DAY)),
): Promise<MarketData> {
  const observations = new Map<string, ValuationObservation[]>();
  const settings = await valuationSettings(db);
  if (productIds.length === 0) {
    return { observations, recent: new Map(), manual: new Map(), ...settings };
  }
  const currency = await valuedCurrency(db);
  const packed = await loadItemSales(db, productIds);
  for (const [productId, sales] of packed) {
    const list = unpackSales(sales, { since, currency, types: ['sold', 'buylist', 'listing'] }).map(
      ({ currency: _currency, ...o }) => o,
    );
    if (list.length) observations.set(productId, list);
  }
  return { observations, ...(await manualAndRecent(db, userId, productIds)), ...settings };
}

/** Market data for valuing these products' buckets today (see `loadMarketData`). */
export async function loadHoldingsMarketData(
  db: Db,
  /** Whose manual prices to load; null for none. */
  userId: string | null,
  wanted: { productId: string; bucket: string | null }[],
  now = new Date(),
): Promise<MarketData> {
  return loadMarketData(db, userId, [...new Set(wanted.map((w) => w.productId))], now);
}

/**
 * `loadMarketData` from the raw sales, each with its id (for tools that point at single sales:
 * the odd-sales review, the MCP tools). The same observations otherwise.
 */
export async function rawMarketData(
  db: Db,
  userId: string,
  productIds: string[],
  now = new Date(),
  /** Oldest observation to load (ISO); defaults to what valuing `now` needs. */
  since: string = toLocalIso(new Date(now.getTime() - LOOKBACK_DAYS * DAY)),
): Promise<MarketData> {
  const observations = new Map<string, ValuationObservation[]>();
  const recent = new Map<string, RecentSaleInput[]>();
  const manual = new Map<string, { bucket: string; priceBase: number; setAt: string }[]>();
  if (productIds.length === 0)
    return { observations, recent, manual, ...(await valuationSettings(db)) };
  const currency = await valuedCurrency(db);
  for (let i = 0; i < productIds.length; i += 200) {
    const ids = productIds.slice(i, i + 200);
    const rows = await db
      .select({
        id: priceObservations.id,
        productId: priceObservations.productId,
        source: priceObservations.source,
        bucket: priceObservations.bucket,
        priceBase: priceObservations.priceBase,
        observedAt: priceObservations.observedAt,
        observationType: priceObservations.observationType,
        excluded: priceObservations.excluded,
        quantityInferred: priceObservations.quantityInferred,
      })
      .from(priceObservations)
      .where(
        and(
          inArray(priceObservations.productId, ids),
          // Sales and buy prices, plus shops' asking prices (a fallback); prices of the primary
          // market only: other markets (e.g. TCGplayer in dollars) are shown beside the value.
          inArray(priceObservations.observationType, ['sold', 'buylist', 'listing']),
          or(isNull(priceObservations.currency), eq(priceObservations.currency, currency)),
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
  return { observations, recent, manual, ...(await valuationSettings(db)) };
}

// ---------------------------------------------------------------------------------------------
// saved bucket values (S8 speed)

/** What `bucket_values` keeps: a bucket's valuation from sales, before the user's manual price. */
export interface BucketValue {
  valuation: Valuation;
  last: LastSale | null;
  buylist: HoldingValuation['buylist'];
  sources: SourceSummary[];
}

/** Saved values older than this are valued again (windows slide even without new sales). */
const BUCKET_VALUE_MAX_AGE_DAYS = 3;

function bucketValueOf(
  product: Product,
  bucket: string | null,
  market: MarketData,
  now: Date,
): BucketValue {
  const observations = market.observations.get(product.id) ?? [];
  const recent = market.recent.get(product.id) ?? [];
  return {
    valuation: valueUnit({
      bucket,
      observations,
      retailPriceBase: product.retailPriceBase,
      now,
      sources: market.order[productClass(product)],
      pools: market.pools,
    }),
    last: lastSale(observations, recent, bucket, undefined, now),
    buylist: buylistFloor(observations, bucket, now),
    sources: sourceSummaries(
      observations,
      recent,
      bucket,
      now,
      market.order[productClass(product)],
      market.pools,
    ),
  };
}

async function saveBucketValues(
  db: Db,
  rows: { productId: string; bucket: string | null; value: BucketValue }[],
  now: Date,
) {
  const at = toLocalIso(now);
  for (let i = 0; i < rows.length; i += 100) {
    await retried(() =>
      db
        .insert(bucketValues)
        .values(
          rows.slice(i, i + 100).map((r) => ({
            productId: r.productId,
            bucket: r.bucket ?? '',
            computedAt: at,
            value: r.value,
          })),
        )
        .onConflictDoUpdate({
          target: [bucketValues.productId, bucketValues.bucket],
          set: {
            computedAt: sql`excluded.computed_at`,
            value: sql`excluded.value`,
            updatedAt: at,
          },
        }),
    );
  }
}

/** Forget the saved values of products whose sales or details changed. */
export async function clearBucketValues(db: Pick<Db, 'delete'>, productIds: string[]) {
  for (let i = 0; i < productIds.length; i += 500) {
    await db
      .delete(bucketValues)
      .where(inArray(bucketValues.productId, productIds.slice(i, i + 500)));
  }
}

/**
 * Values every product + bucket held or watched by anyone and saves them (end of a collect);
 * values no longer held or watched are removed.
 */
export async function refreshBucketValues(db: Db, now = new Date()) {
  const rows = await db
    .select({ holding: holdings, product: products })
    .from(holdings)
    .innerJoin(products, eq(products.id, holdings.productId))
    .where(eq(holdings.status, 'owned'));
  const wanted = new Map<string, { product: Product; bucket: string | null }>();
  for (const { holding, product } of rows) {
    const bucket = holdingBucket(holding, product);
    wanted.set(`${product.id}|${bucket ?? ''}`, { product, bucket });
  }
  // Watched items too (S9): the Watchlist reads their saved values.
  for (const { watch, product } of await db
    .select({ watch: watches, product: products })
    .from(watches)
    .innerJoin(products, eq(products.id, watches.productId))) {
    wanted.set(`${product.id}|${watch.bucket}`, { product, bucket: watch.bucket || null });
  }
  const market = await loadHoldingsMarketData(
    db,
    null,
    [...wanted.values()].map((w) => ({ productId: w.product.id, bucket: w.bucket })),
    now,
  );
  await saveBucketValues(
    db,
    [...wanted.values()].map(({ product, bucket }) => ({
      productId: product.id,
      bucket,
      value: bucketValueOf(product, bucket, market, now),
    })),
    now,
  );
  const stale = (
    await db
      .select({
        id: bucketValues.id,
        productId: bucketValues.productId,
        bucket: bucketValues.bucket,
      })
      .from(bucketValues)
  ).filter((r) => !wanted.has(`${r.productId}|${r.bucket}`));
  for (let i = 0; i < stale.length; i += 500) {
    await db.delete(bucketValues).where(
      inArray(
        bucketValues.id,
        stale.slice(i, i + 500).map((r) => r.id),
      ),
    );
  }
  return { values: wanted.size, removed: stale.length };
}

/** Key of a product + bucket in `savedBucketValues`. */
export const bucketValueKey = (productId: string, bucket: string | null) =>
  `${productId}|${bucket ?? ''}`;

/**
 * Today's values of product + bucket pairs (by `bucketValueKey`), from all sales and without
 * manual prices: read from the saved rows; pairs without a recent saved value are valued from
 * their sales and saved.
 */
export async function savedBucketValues(
  db: Db,
  wanted: { product: Product; bucket: string | null }[],
  now = new Date(),
): Promise<Map<string, BucketValue>> {
  const saved = new Map<string, BucketValue>();
  const productIds = [...new Set(wanted.map((w) => w.product.id))];
  // Values saved before the sources' roles last changed were valued with other roles.
  const changedAt = (await loadSourceRegistry(db)).changedAt ?? '';
  const ageLimit = toLocalIso(new Date(now.getTime() - BUCKET_VALUE_MAX_AGE_DAYS * DAY));
  const oldest = changedAt > ageLimit ? changedAt : ageLimit;
  const at = toLocalIso(now);
  for (let i = 0; i < productIds.length; i += 200) {
    const rows = await db
      .select()
      .from(bucketValues)
      .where(inArray(bucketValues.productId, productIds.slice(i, i + 200)));
    for (const v of rows) {
      if (v.computedAt >= oldest && v.computedAt <= at) {
        saved.set(bucketValueKey(v.productId, v.bucket || null), v.value as BucketValue);
      }
    }
  }
  const missing = new Map<string, { product: Product; bucket: string | null }>();
  for (const w of wanted) {
    const key = bucketValueKey(w.product.id, w.bucket);
    if (!saved.has(key)) missing.set(key, w);
  }
  if (missing.size > 0) {
    const market = await loadHoldingsMarketData(
      db,
      null,
      [...missing.values()].map((m) => ({ productId: m.product.id, bucket: m.bucket })),
      now,
    );
    const fresh = [...missing.values()].map(({ product, bucket }) => ({
      productId: product.id,
      bucket,
      value: bucketValueOf(product, bucket, market, now),
    }));
    for (const f of fresh) saved.set(bucketValueKey(f.productId, f.bucket), f.value);
    await saveBucketValues(db, fresh, now);
  }
  return saved;
}

/**
 * Today's valuation of each holding (by holding id): the same as `valueHolding` on all sales,
 * from the saved bucket values, with the user's manual prices on top.
 */
export async function valueHoldings(
  db: Db,
  userId: string,
  rows: { holding: Holding; product: Product }[],
  now = new Date(),
): Promise<Map<string, HoldingValuation>> {
  const out = new Map<string, HoldingValuation>();
  const productIds = [...new Set(rows.map((r) => r.product.id))];
  if (productIds.length === 0) return out;
  const wanted = rows.map((r) => ({ ...r, bucket: holdingBucket(r.holding, r.product) }));
  const manual = new Map<string, { bucket: string; priceBase: number; setAt: string }[]>();
  const [saved] = await Promise.all([
    savedBucketValues(db, wanted, now),
    (async () => {
      for (let i = 0; i < productIds.length; i += 200) {
        const prices = await db
          .select()
          .from(manualPrices)
          .where(
            and(
              eq(manualPrices.userId, userId),
              inArray(manualPrices.productId, productIds.slice(i, i + 200)),
            ),
          );
        for (const p of prices) manual.set(p.productId, [...(manual.get(p.productId) ?? []), p]);
      }
    })(),
  ]);
  for (const { holding, product, bucket } of wanted) {
    const value = saved.get(bucketValueKey(product.id, bucket))!;
    const own = valueUnit({ bucket, observations: [], manualPrices: manual.get(product.id), now });
    const v =
      own.method === 'manual'
        ? own
        : {
            ...value.valuation,
            ageDays: value.valuation.newestAt ? ageDays(value.valuation.newestAt, now) : null,
          };
    out.set(holding.id, {
      ...v,
      bucket,
      valueBase: v.unitBase === null ? null : v.unitBase * holding.quantity,
      buylist: value.buylist,
      last: value.last,
      trendPct: v.method === 'median' ? trend(value.last?.priceBase, v.unitBase) : null,
      sources: value.sources,
    });
  }
  return out;
}

/**
 * Valuation buckets of a product's owned holdings and watches (S9), across users (what collectors
 * should cover).
 */
export async function heldBuckets(db: Db, productId: string): Promise<string[]> {
  const rows = await db
    .select({ holding: holdings, product: products })
    .from(holdings)
    .innerJoin(products, eq(products.id, holdings.productId))
    .where(and(eq(holdings.productId, productId), eq(holdings.status, 'owned')));
  const watched = await db
    .selectDistinct({ bucket: watches.bucket })
    .from(watches)
    .where(eq(watches.productId, productId));
  const buckets = [
    ...rows.map((r) => holdingBucket(r.holding, r.product)),
    ...watched.map((w) => w.bucket || null),
  ];
  return [...new Set(buckets.filter((b): b is string => b !== null))];
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
    retailPriceBase: product.retailPriceBase,
    now,
    sources: market.order[productClass(product)],
    pools: market.pools,
  });
  const recent = market.recent.get(product.id) ?? [];
  const last = lastSale(observations, recent, bucket, undefined, now);
  return {
    ...v,
    bucket,
    valueBase: v.unitBase === null ? null : v.unitBase * holding.quantity,
    buylist: buylistFloor(observations, bucket, now),
    last,
    trendPct: v.method === 'median' ? trend(last?.priceBase, v.unitBase) : null,
    sources: sourceSummaries(
      observations,
      recent,
      bucket,
      now,
      market.order[productClass(product)],
      market.pools,
    ),
  };
}

export interface OddSale {
  observationId: string | undefined;
  holding: Holding;
  product: Product;
  source: string;
  bucket: string;
  priceBase: number;
  /** The lot's unit value the sale is far from. */
  valueBase: number;
  observedAt: string;
}

/**
 * Kept sales of the last 30 days at over 3x or under 1/3 of the median value they feed: the
 * median ignores them, but they may be listings of something else (data checks, S4d review).
 */
export function oddSales(
  valued: { holding: Holding; product: Product; v: HoldingValuation }[],
  market: MarketData,
  now = new Date(),
): OddSale[] {
  const odd: OddSale[] = [];
  const since = now.getTime() - 30 * DAY;
  const seen = new Set<string>();
  for (const { holding, product, v } of valued) {
    if (v.unitBase === null || v.method !== 'median' || !v.bucket) continue;
    for (const o of market.observations.get(product.id) ?? []) {
      if (o.bucket !== v.bucket || o.observationType !== 'sold' || Date.parse(o.observedAt) < since)
        continue;
      const ratio = o.priceBase / v.unitBase;
      const key = o.id ?? `${product.id}|${o.source}|${o.priceBase}|${o.observedAt}`;
      if ((ratio > 3 || ratio < 1 / 3) && !seen.has(key)) {
        seen.add(key);
        odd.push({
          observationId: o.id,
          holding,
          product,
          source: o.source,
          bucket: v.bucket,
          priceBase: o.priceBase,
          valueBase: v.unitBase,
          observedAt: o.observedAt,
        });
      }
    }
  }
  return odd;
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
  // Lots and their items read apart: joined, each item's columns came once per lot (S14).
  const mine = and(eq(holdings.userId, userId), inArray(holdings.status, ['owned', 'consumed']));
  const [lots, items] = await Promise.all([
    db.select().from(holdings).where(mine),
    db
      .select()
      .from(products)
      .where(
        inArray(
          products.id,
          db.selectDistinct({ id: holdings.productId }).from(holdings).where(mine),
        ),
      ),
  ]);
  const itemOf = new Map(items.map((p) => [p.id, p]));
  const rows = lots.map((holding) => ({ holding, product: itemOf.get(holding.productId)! }));
  // Opened (consumed) items keep their cost in the totals at no market value: their value now
  // lives in the pulls logged from them, which carry no cost of their own.
  const opened = rows.filter((r) => r.holding.status === 'consumed');
  const ownedRows = rows.filter((r) => r.holding.status === 'owned');
  const values = await valueHoldings(db, userId, ownedRows, now);
  const valued: PortfolioRow[] = ownedRows.map((r) => ({
    ...r,
    valuation: values.get(r.holding.id)!,
  }));

  // Each lot counts by its tracking switches (S8): cost in `spentBase`, value in `valueBase`, and
  // only lots counted in both in the P/L.
  const totals = {
    spentBase: 0,
    valueBase: 0,
    /** Cost of the lots in the P/L (counted in both, valued, or opened). */
    valuedCostBase: 0,
    /** Value of those lots. */
    plValueBase: 0,
    /** Lots counted in value, and how many of them have a value. */
    valued: 0,
    total: 0,
    /** Owned lots, whatever they count in. */
    lots: valued.length,
    units: 0,
    /** Cost of opened items, included in `spentBase` and the P/L base. */
    openedCostBase: 0,
    /** Lots not counted as investments (value only, cost only, not tracked). */
    notInvestment: 0,
  };
  const breakdown = new Map<
    string,
    { category: string; kind: string; costBase: number; valueBase: number; count: number }
  >();
  const addToBreakdown = (product: Product, costBase: number, valueBase: number, count: number) => {
    const key = `${product.category}:${product.kind}`;
    const b = breakdown.get(key) ?? {
      category: product.category,
      kind: product.kind,
      costBase: 0,
      valueBase: 0,
      count: 0,
    };
    b.costBase += costBase;
    b.valueBase += valueBase;
    b.count += count;
    breakdown.set(key, b);
  };
  for (const { holding, product, valuation } of valued) {
    const cost = holding.countInCost ? holding.costTotalBase : 0;
    const value = holding.countInValue ? (valuation.valueBase ?? 0) : 0;
    totals.units += holding.quantity;
    totals.spentBase += cost;
    if (!holding.countInCost || !holding.countInValue) totals.notInvestment++;
    if (holding.countInValue) {
      totals.total++;
      if (valuation.valueBase !== null) {
        totals.valueBase += valuation.valueBase;
        totals.valued++;
      }
    }
    if (holding.countInCost && holding.countInValue && valuation.valueBase !== null) {
      totals.plValueBase += valuation.valueBase;
      totals.valuedCostBase += holding.costTotalBase;
    }
    addToBreakdown(product, cost, value, holding.quantity);
  }
  for (const { holding, product } of opened) {
    if (!holding.countInCost) continue;
    totals.spentBase += holding.costTotalBase;
    totals.openedCostBase += holding.costTotalBase;
    if (holding.countInValue) totals.valuedCostBase += holding.costTotalBase;
    addToBreakdown(product, holding.costTotalBase, 0, 0);
  }
  return {
    rows: valued,
    /** Opened lots counted in cost: their cost stays in the totals (the value lives on in pulls). */
    opened: opened.filter((o) => o.holding.countInCost),
    totals: { ...totals, unrealizedBase: totals.plValueBase - totals.valuedCostBase },
    breakdown: [...breakdown.values()].sort(
      (a, b) => b.valueBase + b.costBase - (a.valueBase + a.costBase),
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
  const pullsValueBase = pullRows.reduce((sum, p) => sum + (p.valuation.valueBase ?? 0), 0);
  return {
    box,
    receivedState,
    asReceivedBucket: receivedBucket,
    paidBase: box.holding.costTotalBase,
    asReceived,
    pulls: pullRows,
    pullsValueBase,
    pullsValued: pullRows.filter((p) => p.valuation.valueBase !== null).length,
    netBase: pullsValueBase - box.holding.costTotalBase,
  };
}

// ---------------------------------------------------------------------------------------------
// manual prices

export async function setManualPrice(
  db: Db,
  userId: string,
  productId: string,
  bucket: string,
  priceBase: number,
  note?: string | null,
): Promise<void> {
  if (!Number.isSafeInteger(priceBase) || priceBase < 0) throw new RangeError('invalid price');
  await db
    .insert(manualPrices)
    .values({ userId, productId, bucket, priceBase, setAt: toLocalIso(), note: note ?? null });
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

/** End of a calendar day in the app's time zone. */
const endOfDay = (day: string) => localTime(day, '23:59:59.999');

/** Whether a holding was held on `day`: acquired by then, not yet sold or used up. */
/** Day the holding was opened and used up (its value moved to the pulls), if it was. */
function openedOn(events: HoldingEvent[]): string | null {
  const e = events.find(
    (x) =>
      x.type === 'opened' &&
      (x.payload as { after?: { status?: string } } | null)?.after?.status === 'consumed',
  );
  return e ? e.occurredAt.slice(0, 10) : null;
}

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
const WINDOW_DAYS = LONG_WINDOW;
/** How far back the chart can go. */
const MAX_HISTORY_DAYS = 3 * 366;

/**
 * Daily job (after collectors): rebuilds the snapshot of every holding for every day it was held,
 * from its acquisition date, valued with the sales known by the end of that day. Recomputing all
 * days picks up sales history that arrived late and holdings added or edited afterwards; only rows
 * whose numbers changed are written, and rows of days a holding was not held are removed.
 */
export async function runSnapshots(db: Db, now = new Date()) {
  const today = localDate(now);
  const all = await db
    .select({ holding: holdings, product: products })
    .from(holdings)
    .innerJoin(products, eq(products.id, holdings.productId));
  const rows = all.filter((r) => r.holding.status !== 'lost');
  const oldest = localDate(new Date(now.getTime() - MAX_HISTORY_DAYS * DAY));
  const first = rows.reduce(
    (min, r) => (r.holding.acquiredAt.slice(0, 10) < min ? r.holding.acquiredAt.slice(0, 10) : min),
    today,
  );
  const start = first < oldest ? oldest : first;
  const days: string[] = [];
  for (let t = localTime(start, '12:00:00.000').getTime(); ; t += DAY) {
    const day = localDate(new Date(t));
    if (day > today) break;
    days.push(day);
  }

  const eventsBy = new Map<string, HoldingEvent[]>();
  for (const e of await db.select().from(holdingEvents)) {
    const list = eventsBy.get(e.holdingId);
    if (list) list.push(e);
    else eventsBy.set(e.holdingId, [e]);
  }
  const since = toLocalIso(new Date(localTime(start).getTime() - WINDOW_DAYS * DAY));
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
      const { pools } = markets.get(userId)!;
      const observations = (markets.get(userId)!.observations.get(productId) ?? [])
        // Similar conditions too: a rare item's value may pool them (see valueUnit).
        .filter(
          (o) =>
            o.bucket === bucket ||
            (bucket !== null &&
              o.bucket !== null &&
              bucketFamily(bucket, pools) !== null &&
              bucketFamily(o.bucket, pools) === bucketFamily(bucket, pools)),
        )
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
      // Today's value as of now, like the saved values the Portfolio total shows (the end of
      // today would already drop the sales of 30 days ago that are still in its window).
      const at = day === today ? now : endOfDay(day);
      const s = seriesFor(userId, product.id, bucket);
      const from = lowerBound(s.at, at.getTime() - WINDOW_DAYS * DAY);
      const to = lowerBound(s.at, at.getTime() + 1);
      v = valueUnit({
        bucket,
        observations: s.observations.slice(from, to),
        manualPrices: markets.get(userId)!.manual.get(product.id),
        retailPriceBase: product.retailPriceBase,
        now: at,
        sources: markets.get(userId)!.order[productClass(product)],
        pools: markets.get(userId)!.pools,
      });
      unitCache.set(key, v);
    }
    return v;
  };

  // Each lot's value per day, packed (one row per lot).
  const wanted = new Map<string, Record<string, DayValue>>();
  const put = (holdingId: string, day: string, value: DayValue) => {
    let lot = wanted.get(holdingId);
    if (!lot) wanted.set(holdingId, (lot = {}));
    lot[day] = value;
  };
  // By person and item: an item's sales and day values are kept only while its lots are valued
  // (S14: kept for every item at once, a large install ran out of memory).
  let current = '';
  for (const { holding, product } of rows.toSorted(
    (a, b) =>
      a.holding.userId.localeCompare(b.holding.userId) || a.product.id.localeCompare(b.product.id),
  )) {
    if (`${holding.userId}|${product.id}` !== current) {
      current = `${holding.userId}|${product.id}`;
      series.clear();
      unitCache.clear();
    }
    const events = eventsBy.get(holding.id) ?? [];
    const bucket = holdingBucket(holding, product);
    const openedDay = openedOn(events);
    for (const day of days) {
      if (!heldOn(holding, events, day)) {
        // Opened (consumed): the cost stays in the chart, the value moved to the pulls.
        if (openedDay && openedDay <= day) put(holding.id, day, [0, 'opened', null, 0, null, 0]);
        continue;
      }
      const v = unitOn(holding.userId, product, bucket, day);
      put(holding.id, day, [
        v.unitBase === null ? null : v.unitBase * holding.quantity,
        v.method,
        v.source,
        v.sampleSize,
        v.confidence,
        v.estimatedSamples > 0 ? 1 : 0,
      ]);
    }
  }

  // Only lots whose days changed are written; lots no longer valued are removed.
  const byId = new Map(all.map((r) => [r.holding.id, r.holding]));
  const writes: (typeof holdingValues.$inferInsert)[] = [];
  const gone: string[] = [];
  let changedDays = 0;
  let removedDays = 0;
  const known = new Set<string>();
  // The saved histories compared a page at a time (all at once, they filled the memory).
  const saved = (await db.select({ id: holdingValues.holdingId }).from(holdingValues)).map(
    (r) => r.id,
  );
  for (let i = 0; i < saved.length; i += 500) {
    for (const e of await db
      .select()
      .from(holdingValues)
      .where(inArray(holdingValues.holdingId, saved.slice(i, i + 500)))) {
      known.add(e.holdingId);
      const lot = wanted.get(e.holdingId);
      if (!lot) {
        gone.push(e.holdingId);
        removedDays += Object.keys(e.days).length;
        continue;
      }
      let changed = 0;
      let removed = 0;
      for (const [day, v] of Object.entries(lot)) {
        if (JSON.stringify(e.days[day]) !== JSON.stringify(v)) changed++;
      }
      for (const day of Object.keys(e.days)) if (!(day in lot)) removed++;
      changedDays += changed;
      removedDays += removed;
      if (changed || removed) {
        writes.push({ holdingId: e.holdingId, userId: byId.get(e.holdingId)!.userId, days: lot });
      }
    }
  }
  for (const [holdingId, lot] of wanted) {
    if (known.has(holdingId)) continue;
    writes.push({ holdingId, userId: byId.get(holdingId)!.userId, days: lot });
    changedDays += Object.keys(lot).length;
  }
  for (let i = 0; i < writes.length; i += 20) {
    await retried(() =>
      db
        .insert(holdingValues)
        .values(writes.slice(i, i + 20))
        .onConflictDoUpdate({
          target: holdingValues.holdingId,
          set: { days: sql`excluded.days`, userId: sql`excluded.user_id`, updatedAt: toLocalIso() },
        }),
    );
  }
  for (let i = 0; i < gone.length; i += 500) {
    await retried(() =>
      db.delete(holdingValues).where(inArray(holdingValues.holdingId, gone.slice(i, i + 500))),
    );
  }

  // Each person's chart, summed from the values just worked out (no read of them).
  const lotsOf = new Map<string, Holding[]>();
  for (const { holding } of all) {
    const list = lotsOf.get(holding.userId);
    if (list) list.push(holding);
    else lotsOf.set(holding.userId, [holding]);
  }
  for (const [userId, lots] of lotsOf) {
    const series = sumSeries(
      lots.flatMap((holding) =>
        Object.entries(wanted.get(holding.id) ?? {}).map(([date, v]) => ({
          date,
          valueBase: v[0],
          quantityInferred: v[5] === 1,
          holding,
        })),
      ),
    );
    // The days the Portfolio's movers compare, saved apart so it does not read the histories.
    const compared = [today, ...INSIGHT_PERIODS.map((p) => daysBefore(today, p))];
    const recent: RecentValues = {
      day: today,
      periods: [...INSIGHT_PERIODS],
      lots: Object.fromEntries(
        lots.flatMap((h) => {
          const lot = wanted.get(h.id);
          return lot ? [[h.id, compared.map((d) => lot[d]?.[0] ?? null)]] : [];
        }),
      ),
    };
    await retried(() => savePortfolioChart(db, userId, holdingsFingerprint(lots), series, recent));
  }

  // The market movers of the Portfolio's insights (every item anyone holds), saved once a night.
  const owned = rows.filter((r) => r.holding.status === 'owned');
  await saveSetting(db, MARKET_MOVERS_KEY, {
    day: today,
    movers: Object.fromEntries(
      INSIGHT_PERIODS.map((p) => [
        p,
        marketMovers(
          owned.map((r) => ({ ...r, days: wanted.get(r.holding.id) ?? {} })),
          today,
          p,
        ),
      ]),
    ),
  } satisfies SavedMarketMovers);
  return { days: days.length, rows: changedDays, removed: removedDays };
}

type ChartLot = Pick<Holding, 'id' | 'costTotalBase' | 'countInValue' | 'countInCost'>;

/** What a person's chart sums of their lots: any change here needs a new sum. */
function holdingsFingerprint(lots: ChartLot[]): string {
  const text = lots
    .map((h) => `${h.id}:${h.costTotalBase}:${Number(h.countInValue)}${Number(h.countInCost)}`)
    .sort()
    .join(',');
  return createHash('sha256').update(text).digest('base64url');
}

/**
 * Value and cost per day from snapshots. Lots count by their tracking switches (S8): value sums
 * lots counted in value (at cost when they have no market value yet, `atCostBase`), cost lots
 * counted in cost.
 */
function sumSeries(
  snapshots: {
    date: string;
    valueBase: number | null;
    quantityInferred: boolean;
    holding: ChartLot;
  }[],
): PortfolioPoint[] {
  const days = new Map<string, PortfolioPoint>();
  for (const { date, valueBase, quantityInferred, holding } of snapshots) {
    let d = days.get(date);
    if (!d) {
      d = { date, valueBase: 0, costBase: 0, atCostBase: 0, estimatedBase: 0 };
      days.set(date, d);
    }
    if (holding.countInCost) d.costBase += holding.costTotalBase;
    if (!holding.countInValue) continue;
    d.valueBase += valueBase ?? holding.costTotalBase;
    if (valueBase === null) d.atCostBase += holding.costTotalBase;
    else if (quantityInferred) d.estimatedBase += valueBase;
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

async function savePortfolioChart(
  db: Db,
  userId: string,
  fingerprint: string,
  series: PortfolioPoint[],
  /** Given by the snapshot run; kept otherwise. */
  recent?: RecentValues,
) {
  await db
    .insert(portfolioCharts)
    .values({ userId, fingerprint, series, recent })
    .onConflictDoUpdate({
      target: portfolioCharts.userId,
      set: { fingerprint, series, ...(recent ? { recent } : {}), updatedAt: toLocalIso() },
    });
}

/**
 * Value and cost per day for the user's chart. Cost is everything held that day; value is the
 * market value, with holdings that have no market value yet counted at cost (`atCostBase`). The
 * saved chart while the person's lots are as it was summed over; else summed again and saved.
 */
export async function portfolioSeries(
  db: Db,
  userId: string,
  days = MAX_HISTORY_DAYS,
  now = new Date(),
): Promise<PortfolioPoint[]> {
  const since = localDate(new Date(now.getTime() - days * DAY));
  const lots = await db
    .select({
      id: holdings.id,
      costTotalBase: holdings.costTotalBase,
      countInValue: holdings.countInValue,
      countInCost: holdings.countInCost,
    })
    .from(holdings)
    .where(eq(holdings.userId, userId));
  const fingerprint = holdingsFingerprint(lots);
  const [saved] = await db.select().from(portfolioCharts).where(eq(portfolioCharts.userId, userId));
  let series = saved?.fingerprint === fingerprint ? saved.series : null;
  if (!series) {
    const byId = new Map(lots.map((l) => [l.id, l]));
    series = sumSeries(
      (
        await db
          .select({ holdingId: holdingValues.holdingId, days: holdingValues.days })
          .from(holdingValues)
          .where(eq(holdingValues.userId, userId))
      ).flatMap((r) => {
        const holding = byId.get(r.holdingId);
        return holding
          ? Object.entries(r.days).map(([date, v]) => ({
              date,
              valueBase: v[0],
              quantityInferred: v[5] === 1,
              holding,
            }))
          : [];
      }),
    );
    await savePortfolioChart(db, userId, fingerprint, series);
  }
  return series.filter((p) => p.date >= since);
}

/**
 * The chart ending on the header's numbers: the saved points are worked out at night, the
 * Portfolio header now, so today's point is summed again from `portfolioValuation`'s values
 * (a price that dropped out of its window since then would else make the two disagree).
 */
export function withLivePoint(
  series: PortfolioPoint[],
  portfolio: Pick<Awaited<ReturnType<typeof portfolioValuation>>, 'rows' | 'opened'>,
  now = new Date(),
): PortfolioPoint[] {
  const date = localDate(now);
  const [live] = sumSeries([
    ...portfolio.rows.map(({ holding, valuation }) => ({
      date,
      valueBase: valuation.valueBase,
      quantityInferred: valuation.estimatedSamples > 0,
      holding,
    })),
    // Opened: the cost stays, the value moved to the pulls (as in the snapshots).
    ...portfolio.opened.map(({ holding }) => ({
      date,
      valueBase: 0,
      quantityInferred: false,
      holding,
    })),
  ]);
  if (!live) return series;
  return [...series.filter((p) => p.date < date), live];
}

export interface PricePoint {
  day: string;
  source: string;
  bucket: string | null;
  medianBase: number;
  count: number;
  /** Trades of that day whose lot size was estimated. */
  estimated: number;
}

/** Daily sold medians per source + bucket for a product's price chart (from its packed sales). */
export async function priceHistory(
  db: Db,
  productId: string,
  days = 365,
  now = new Date(),
): Promise<PricePoint[]> {
  const groups = new Map<
    string,
    { day: string; source: string; bucket: string | null; prices: number[]; estimated: number }
  >();
  // A source's currencies (rarely more than one) are one point.
  for (const r of await soldDays(db, [productId], { since: daysBack(days, now) })) {
    const key = `${r.day}\u0000${r.source}\u0000${r.bucket ?? ''}`;
    const g = groups.get(key) ?? {
      day: r.day,
      source: r.source,
      bucket: r.bucket,
      prices: [],
      estimated: 0,
    };
    g.prices.push(...r.prices);
    g.estimated += r.estimated;
    groups.set(key, g);
  }
  return [...groups.values()]
    .map((g) => ({
      day: g.day,
      source: g.source,
      bucket: g.bucket,
      medianBase: Math.round(median(g.prices)!),
      count: g.prices.length,
      estimated: g.estimated,
    }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

export interface ProductSummary<R extends { holding: Holding; product: Product }> {
  product: Product;
  /** The product's lots in the list, newest first. */
  lots: R[];
  units: number;
  spentBase: number;
  /** Market value of the lots that have one. */
  valueBase: number;
  valuedLots: number;
  /** Cost of the valued lots (the base for P/L). */
  valuedCostBase: number;
  /** Value minus cost of the valued lots; null when none is valued. */
  unrealizedBase: number | null;
}

/** Portfolio rows combined per product (requirements S5c), highest value (else cost) first. */
export function summarizeByProduct<R extends { holding: Holding; product: Product }>(
  rows: R[],
  valuations: Map<string, Pick<HoldingValuation, 'valueBase'>>,
): ProductSummary<R>[] {
  const byProduct = new Map<string, ProductSummary<R>>();
  for (const row of rows) {
    const { holding, product } = row;
    let s = byProduct.get(product.id);
    if (!s) {
      s = {
        product,
        lots: [],
        units: 0,
        spentBase: 0,
        valueBase: 0,
        valuedLots: 0,
        valuedCostBase: 0,
        unrealizedBase: null,
      };
      byProduct.set(product.id, s);
    }
    s.lots.push(row);
    s.units += holding.quantity;
    s.spentBase += holding.costTotalBase;
    const value = valuations.get(holding.id)?.valueBase;
    if (value != null) {
      s.valueBase += value;
      s.valuedLots++;
      s.valuedCostBase += holding.costTotalBase;
    }
  }
  const list = [...byProduct.values()];
  for (const s of list) s.unrealizedBase = s.valuedLots ? s.valueBase - s.valuedCostBase : null;
  return list.sort(
    (a, b) =>
      (b.valuedLots ? b.valueBase : b.spentBase) - (a.valuedLots ? a.valueBase : a.spentBase) ||
      a.product.name.localeCompare(b.product.name),
  );
}

/**
 * Reference only, never counted in totals: the opened item's cost split across all pulls logged
 * from it, by market value (pulls without one count at the median known unit value, or equally
 * when none is known). Pulls themselves cost nothing; the opened item keeps its cost.
 */
export async function estimatedPullCosts(
  db: Db,
  userId: string,
  parentHoldingId: string,
  now = new Date(),
): Promise<Map<string, number>> {
  const [parent] = await db
    .select()
    .from(holdings)
    .where(and(eq(holdings.id, parentHoldingId), eq(holdings.userId, userId)));
  if (!parent) return new Map();
  const pulls = await db
    .select({ holding: holdings, product: products })
    .from(holdings)
    .innerJoin(products, eq(products.id, holdings.productId))
    .where(and(eq(holdings.userId, userId), eq(holdings.parentHoldingId, parentHoldingId)));
  if (pulls.length === 0) return new Map();
  const market = await loadMarketData(
    db,
    userId,
    [...new Set(pulls.map((p) => p.product.id))],
    now,
  );
  const units = pulls.map((p) => valueHolding(p.holding, p.product, market, now).unitBase);
  const fallback = median(units.filter((u): u is number => u !== null)) ?? 1;
  const weights = pulls.map((p, i) => (units[i] ?? fallback) * p.holding.quantity);
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  return new Map(
    pulls.map((p, i) => [p.holding.id, Math.round((parent.costTotalBase * weights[i]!) / total)]),
  );
}

export interface Mover {
  product: Product;
  /** Value of the lots held now, today and `days` ago (same lots, from the daily snapshots). */
  nowBase: number;
  thenBase: number;
  changeBase: number;
  pct: number;
}

/** The market movers saved by the snapshot run (app setting): per period, every item held. */
interface SavedMarketMovers {
  day: string;
  movers: Record<number, Mover[]>;
}
const MARKET_MOVERS_KEY = 'marketMovers';

/** A lot with its values by day (only the value, `[0]`, is read). */
type MoverLot = {
  holding: Holding;
  product: Product;
  days: Record<string, Pick<DayValue, 0>>;
};

/** Items worth under ¥1,000 then, and items that did not move, are left out (noise). */
function finishMovers(list: Mover[]): Mover[] {
  return list
    .filter((m) => m.thenBase >= 1_000 && m.nowBase !== m.thenBase)
    .map((m) => ({
      ...m,
      changeBase: m.nowBase - m.thenBase,
      pct: Math.round(((m.nowBase - m.thenBase) / m.thenBase) * 1000) / 10,
    }));
}

/** The day `days` before `day` (both the app's local dates). */
const daysBefore = (day: string, days: number) =>
  localDate(new Date(localTime(day, '12:00:00.000').getTime() - days * DAY));

/** Lots' values on `day` and `days` before, where both are known. */
function bothDays(lots: MoverLot[], day: string, days: number) {
  const then = daysBefore(day, days);
  return lots.flatMap((lot) => {
    const now = lot.days[day]?.[0];
    const before = lot.days[then]?.[0];
    return now == null || before == null ? [] : [{ ...lot, now, before }];
  });
}

/** Every held item by its unit value (the median over the lots holding it). */
function marketMovers(lots: MoverLot[], day: string, days: number): Mover[] {
  const units = new Map<string, { product: Product; now: number[]; then: number[] }>();
  for (const lot of bothDays(lots, day, days)) {
    const u = units.get(lot.product.id) ?? { product: lot.product, now: [], then: [] };
    u.now.push(lot.now / lot.holding.quantity);
    u.then.push(lot.before / lot.holding.quantity);
    units.set(lot.product.id, u);
  }
  return finishMovers(
    [...units.values()].map((u) => ({
      product: u.product,
      nowBase: Math.round(median(u.now)!),
      thenBase: Math.round(median(u.then)!),
      changeBase: 0,
      pct: 0,
    })),
  );
}

/** The lots' values on these days, read out of each one's history (a year of days per lot). */
async function valuesOn(db: Db, lots: SQL | undefined, days: string[]) {
  const rows = await db
    .select({
      productId: holdings.productId,
      // Several paths: the history is parsed once, the values come back as a JSON array.
      values: sql<string>`json_extract(${holdingValues.days}, ${sql.join(
        days.map((d) => sql`${`$."${d}"[0]`}`),
        sql`, `,
      )})`,
    })
    .from(holdings)
    .innerJoin(holdingValues, eq(holdingValues.holdingId, holdings.id))
    .where(lots);
  return rows.map((r) => ({
    productId: r.productId,
    value: JSON.parse(r.values) as (number | null)[],
  }));
}

/**
 * How items' market values moved over each period (requirements S8, Summary insights), from the
 * value history: the latest day against the day `days` before.
 * - mine: the user's lots still owned and counted in value, summed per item (same lots both days),
 *   from their packed values (one row per lot);
 * - market: every item anyone holds, by its unit value, saved by the snapshot run.
 */
export async function moversByPeriod(
  db: Db,
  userId: string,
  periods: readonly number[],
): Promise<{ mine: Map<number, Mover[]>; market: Map<number, Mover[]> }> {
  const mine = new Map<number, Mover[]>();
  const market = new Map<number, Mover[]>();
  const saved = await readSetting<SavedMarketMovers>(db, MARKET_MOVERS_KEY);
  const counted = and(
    eq(holdings.userId, userId),
    eq(holdings.status, 'owned'),
    eq(holdings.countInValue, true),
  );
  // Before the first snapshot run saved its movers: the lots' latest day.
  const day =
    saved?.day ??
    (
      await db
        .select({ day: sql<string | null>`max(j.key)` })
        .from(holdings)
        .innerJoin(holdingValues, eq(holdingValues.holdingId, holdings.id))
        .innerJoin(sql`json_each(${holdingValues.days}) j`, sql`1`)
        .where(counted)
    )[0]?.day;
  if (!day) return { mine, market };
  // The values the snapshot run saved for these days; else read out of each lot's history.
  const [chart] = await db
    .select({ recent: portfolioCharts.recent })
    .from(portfolioCharts)
    .where(eq(portfolioCharts.userId, userId));
  const recent =
    chart?.recent?.day === day && chart.recent.periods.join() === periods.join()
      ? chart.recent
      : null;
  const lots = recent
    ? (
        await db
          .select({ id: holdings.id, productId: holdings.productId })
          .from(holdings)
          .where(counted)
      ).flatMap((h) =>
        recent.lots[h.id] ? [{ productId: h.productId, value: recent.lots[h.id]! }] : [],
      )
    : await valuesOn(db, counted, [day, ...periods.map((days) => daysBefore(day, days))]);
  // Per item and period, the same lots' values on both days; whole items read for the movers.
  const sums = periods.map((_, p) => {
    const own = new Map<string, { nowBase: number; thenBase: number }>();
    for (const { productId, value } of lots) {
      const now = value[0];
      const before = value[p + 1];
      if (now == null || before == null) continue;
      const m = own.get(productId) ?? { nowBase: 0, thenBase: 0 };
      m.nowBase += now;
      m.thenBase += before;
      own.set(productId, m);
    }
    return own;
  });
  const ids = [...new Set(sums.flatMap((own) => [...own.keys()]))];
  const items = new Map(
    (ids.length ? await db.select().from(products).where(inArray(products.id, ids)) : []).map(
      (p) => [p.id, p],
    ),
  );
  periods.forEach((days, p) => {
    mine.set(
      days,
      finishMovers(
        [...sums[p]!].map(([id, m]) => ({ product: items.get(id)!, ...m, changeBase: 0, pct: 0 })),
      ),
    );
    market.set(days, saved?.movers[days] ?? []);
  });
  return { mine, market };
}

/**
 * Sales counted per period for every item anyone holds (one pass): `mine` marks the user's own
 * items. Sorted by the caller per period.
 */
/** Saved trade counts (app setting `tradeCounts`): per owned item, sales per period. */
interface SavedTradeCounts {
  day: string;
  periods: number[];
  counts: Record<string, number[]>;
}

/**
 * Counts the sales of every owned item over each period and saves them (end of a collect: only
 * collects add sales). The Portfolio reads the saved counts instead of scanning the sales.
 */
export async function refreshTradeCounts(
  db: Db,
  periods: readonly number[],
  now = new Date(),
): Promise<SavedTradeCounts> {
  // From the packed item sales (one row per item).
  const since = (days: number) => toLocalIso(new Date(now.getTime() - days * DAY));
  const owned = await db
    .selectDistinct({ id: holdings.productId })
    .from(holdings)
    .where(eq(holdings.status, 'owned'));
  const packed = await loadItemSales(
    db,
    owned.map((o) => o.id),
  );
  const oldest = since(Math.max(...periods));
  const counted = [...packed].map(([productId, sales]) => {
    const at = unpackSales(sales, { since: oldest, types: ['sold'] }).map((o) => o.observedAt);
    return [productId, periods.map((days) => at.filter((t) => t >= since(days)).length)] as const;
  });
  const saved: SavedTradeCounts = {
    day: localDate(now),
    periods: [...periods],
    counts: Object.fromEntries(counted.filter(([, n]) => n.some((x) => x > 0))),
  };
  await db
    .insert(appSettings)
    .values({ key: 'tradeCounts', value: saved })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: saved, updatedAt: toLocalIso(now) },
    });
  return saved;
}

/**
 * Sales per period of the owned items (the Portfolio's most traded panels), from the counts the
 * last collect saved; worked out here only when none were saved in the last 2 days.
 */
export async function tradeCounts(db: Db, userId: string, periods: readonly number[]) {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, 'tradeCounts'));
  let saved = row?.value as SavedTradeCounts | undefined;
  const fresh =
    saved &&
    saved.periods.join() === periods.join() &&
    saved.day >= localDate(new Date(Date.now() - 2 * DAY));
  if (!fresh) saved = await refreshTradeCounts(db, periods);
  const ids = Object.keys(saved!.counts);
  if (ids.length === 0) return [];
  const [items, mine] = await Promise.all([
    db.select().from(products).where(inArray(products.id, ids)),
    db
      .selectDistinct({ productId: holdings.productId })
      .from(holdings)
      .where(and(eq(holdings.userId, userId), eq(holdings.status, 'owned'))),
  ]);
  const own = new Set(mine.map((m) => m.productId));
  return items.map((product) => ({
    product,
    mine: own.has(product.id),
    sales: new Map(periods.map((days, i) => [days, saved!.counts[product.id]?.[i] ?? 0])),
  }));
}

/** Forget every saved value (a source's role changed: every item is valued again). */
export async function clearAllBucketValues(db: Db) {
  await db.delete(bucketValues);
}
