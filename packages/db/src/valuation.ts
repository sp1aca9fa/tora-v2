// Holding valuation, box view, manual prices and daily snapshots (requirements section 6, S5).
import {
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
  tokyoDate,
  toTokyoIso,
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
import { and, asc, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm';
import type { Db } from './client';
import { loadSourceRegistry } from './registry';
import {
  type Holding,
  type HoldingEvent,
  type Product,
  bucketValues,
  holdingEvents,
  holdings,
  manualPrices,
  priceObservations,
  productSources,
  products,
  valuationSnapshots,
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

/** Sales a valuation may use (the filters of `loadMarketData`). */
const valuedSales = (currency: string) =>
  and(
    eq(priceObservations.observationType, 'sold'),
    or(isNull(priceObservations.currency), eq(priceObservations.currency, currency)),
    eq(priceObservations.excluded, false),
  );

/**
 * Market data for valuing holdings today, with only the sales their valuation can reach: the
 * same results as `loadMarketData` for these buckets, a fraction of the rows (popular boxes sell
 * hundreds a month, and graded sales of grades not held are never used). Sales are counted per
 * product, source and bucket first; each held bucket then loads from the shortest window that
 * decides its value and confidence (see `valueUnit`): 30 days with 5+ sales, 180 with 3+ in 180
 * days, a year with 3+ in a year, else everything, its similar conditions included.
 */
export async function loadHoldingsMarketData(
  db: Db,
  /** Whose manual prices to load; null for none. */
  userId: string | null,
  wanted: { productId: string; bucket: string | null }[],
  now = new Date(),
): Promise<MarketData> {
  const productIds = [...new Set(wanted.map((w) => w.productId))];
  const observations = new Map<string, ValuationObservation[]>();
  const recent = new Map<string, RecentSaleInput[]>();
  const manual = new Map<string, { bucket: string; priceBase: number; setAt: string }[]>();
  const settings = await valuationSettings(db);
  const { pools } = settings;
  if (productIds.length === 0) return { observations, recent, manual, ...settings };
  const currency = await valuedCurrency(db);
  // Sales are counted over the exact windows and loaded with a day of margin (rows older than a
  // window are never used, so extra is safe).
  const exact = (days: number) => toTokyoIso(new Date(now.getTime() - days * DAY));
  const ago = (days: number) => toTokyoIso(new Date(now.getTime() - (days + 1) * DAY));
  const since = ago(LOOKBACK_DAYS);
  const [c30, c180, c365] = [ago(30), ago(180), ago(LONG_WINDOW)];
  const add = (rows: (ValuationObservation & { productId: string })[]) => {
    for (const { productId, ...o } of rows) {
      const list = observations.get(productId);
      if (list) list.push(o);
      else observations.set(productId, [o]);
    }
  };
  const columns = {
    id: priceObservations.id,
    productId: priceObservations.productId,
    source: priceObservations.source,
    bucket: priceObservations.bucket,
    priceBase: priceObservations.priceBase,
    observedAt: priceObservations.observedAt,
    observationType: priceObservations.observationType,
    excluded: priceObservations.excluded,
    quantityInferred: priceObservations.quantityInferred,
  };

  const counts: {
    productId: string;
    source: string;
    bucket: string | null;
    n30: number;
    n180: number;
    n365: number;
  }[] = [];
  for (let i = 0; i < productIds.length; i += 200) {
    const ids = productIds.slice(i, i + 200);
    const within = (from: string) =>
      sql<number>`sum(case when ${priceObservations.observedAt} >= ${from} then 1 else 0 end)`;
    counts.push(
      ...(await db
        .select({
          productId: priceObservations.productId,
          source: priceObservations.source,
          bucket: priceObservations.bucket,
          n30: within(exact(30)),
          n180: within(exact(180)),
          n365: within(exact(LONG_WINDOW)),
        })
        .from(priceObservations)
        .where(
          and(
            inArray(priceObservations.productId, ids),
            valuedSales(currency),
            gte(priceObservations.observedAt, since),
          ),
        )
        .groupBy(priceObservations.productId, priceObservations.source, priceObservations.bucket)),
    );
    // Shops' asking and buy prices are used for 30 days only.
    add(
      await db
        .select(columns)
        .from(priceObservations)
        .where(
          and(
            inArray(priceObservations.productId, ids),
            inArray(priceObservations.observationType, ['buylist', 'listing']),
            or(isNull(priceObservations.currency), eq(priceObservations.currency, currency)),
            eq(priceObservations.excluded, false),
            gte(priceObservations.observedAt, c30),
          ),
        ),
    );
  }

  // Oldest sale needed per product + source + bucket.
  const from = new Map<string, { productId: string; source: string; bucket: string; at: string }>();
  const need = (productId: string, source: string, bucket: string, at: string) => {
    const key = `${productId}|${source}|${bucket}`;
    const had = from.get(key);
    if (!had || at < had.at) from.set(key, { productId, source, bucket, at });
  };
  for (const { productId, bucket } of wanted) {
    if (!bucket) continue;
    const family = bucketFamily(bucket, pools);
    const ofProduct = counts.filter((c) => c.productId === productId && c.bucket !== null);
    for (const source of new Set(ofProduct.map((c) => c.source))) {
      const own = ofProduct.find((c) => c.source === source && c.bucket === bucket);
      const [n30, n180, n365] = [
        Number(own?.n30 ?? 0),
        Number(own?.n180 ?? 0),
        Number(own?.n365 ?? 0),
      ];
      const at = n30 >= 5 ? c30 : n180 >= 3 ? c180 : n365 >= 3 ? c365 : since;
      if (own) need(productId, source, bucket, at);
      // No own window holds 3 sales: similar conditions are pooled.
      if (at === since && family !== null) {
        for (const c of ofProduct) {
          if (c.source === source && bucketFamily(c.bucket!, pools) === family) {
            need(productId, source, c.bucket!, since);
          }
        }
      }
    }
  }
  const byStart = new Map<string, { productId: string; source: string; bucket: string }[]>();
  for (const { at, ...key } of from.values()) byStart.set(at, [...(byStart.get(at) ?? []), key]);
  for (const [at, keys] of byStart) {
    for (let i = 0; i < keys.length; i += 300) {
      const rows = sql.join(
        keys.slice(i, i + 300).map((k) => sql`(${k.productId}, ${k.source}, ${k.bucket})`),
        sql`, `,
      );
      add(
        await db
          .select(columns)
          .from(priceObservations)
          .where(
            and(
              sql`(${priceObservations.productId}, ${priceObservations.source}, ${priceObservations.bucket}) in (values ${rows})`,
              valuedSales(currency),
              gte(priceObservations.observedAt, at),
            ),
          ),
      );
    }
  }

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
  const at = toTokyoIso(now);
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
 * Values every product + bucket held by anyone and saves them (end of a collect); values no
 * longer held are removed.
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
  const ageLimit = toTokyoIso(new Date(now.getTime() - BUCKET_VALUE_MAX_AGE_DAYS * DAY));
  const oldest = changedAt > ageLimit ? changedAt : ageLimit;
  const at = toTokyoIso(now);
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

/** Valuation buckets of a product's owned holdings, across users (what collectors should cover). */
export async function heldBuckets(db: Db, productId: string): Promise<string[]> {
  const rows = await db
    .select({ holding: holdings, product: products })
    .from(holdings)
    .innerJoin(products, eq(products.id, holdings.productId))
    .where(and(eq(holdings.productId, productId), eq(holdings.status, 'owned')));
  const buckets = rows.map((r) => holdingBucket(r.holding, r.product));
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
  const rows = await db
    .select({ holding: holdings, product: products })
    .from(holdings)
    .innerJoin(products, eq(products.id, holdings.productId))
    .where(and(eq(holdings.userId, userId), inArray(holdings.status, ['owned', 'consumed'])));
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
    .values({ userId, productId, bucket, priceBase, setAt: toTokyoIso(), note: note ?? null });
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
      const at = endOfDay(day);
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

  type Row = typeof valuationSnapshots.$inferInsert;
  const wanted = new Map<string, Row>();
  for (const { holding, product } of rows) {
    const events = eventsBy.get(holding.id) ?? [];
    const bucket = holdingBucket(holding, product);
    const openedDay = openedOn(events);
    for (const day of days) {
      if (!heldOn(holding, events, day)) {
        // Opened (consumed): the cost stays in the chart, the value moved to the pulls.
        if (openedDay && openedDay <= day) {
          wanted.set(`${day}|${holding.id}`, {
            date: day,
            holdingId: holding.id,
            valueBase: 0,
            method: 'opened',
            source: null,
            sampleSize: 0,
            confidence: null,
            quantityInferred: false,
          });
        }
        continue;
      }
      const v = unitOn(holding.userId, product, bucket, day);
      wanted.set(`${day}|${holding.id}`, {
        date: day,
        holdingId: holding.id,
        valueBase: v.unitBase === null ? null : v.unitBase * holding.quantity,
        method: v.method,
        source: v.source,
        sampleSize: v.sampleSize,
        confidence: v.confidence,
        quantityInferred: v.estimatedSamples > 0,
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
      w.valueBase === e.valueBase &&
      w.method === e.method &&
      w.source === e.source &&
      w.sampleSize === e.sampleSize &&
      w.confidence === e.confidence &&
      w.quantityInferred === e.quantityInferred
    ) {
      unchanged.add(key);
    }
  }
  const changed = [...wanted.entries()].filter(([k]) => !unchanged.has(k)).map(([, r]) => r);
  for (let i = 0; i < changed.length; i += 100) {
    await retried(() =>
      db
        .insert(valuationSnapshots)
        .values(changed.slice(i, i + 100))
        .onConflictDoUpdate({
          target: [valuationSnapshots.date, valuationSnapshots.holdingId],
          set: {
            valueBase: sql`excluded.value_base`,
            method: sql`excluded.method`,
            source: sql`excluded.source`,
            sampleSize: sql`excluded.sample_size`,
            confidence: sql`excluded.confidence`,
            quantityInferred: sql`excluded.quantity_inferred`,
            updatedAt: sql`excluded.updated_at`,
          },
        }),
    );
  }
  for (let i = 0; i < stale.length; i += 500) {
    await retried(() =>
      db.delete(valuationSnapshots).where(inArray(valuationSnapshots.id, stale.slice(i, i + 500))),
    );
  }
  return { days: days.length, rows: changed.length, removed: stale.length };
}

/**
 * Value and cost per day for the user's chart. Cost is everything held that day; value is the
 * market value, with holdings that have no market value yet counted at cost (`atCostBase`).
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
      // Lots count by their tracking switches (S8): value lines sum lots counted in value, cost
      // lots counted in cost.
      valueBase: sql<number>`coalesce(sum(case when ${holdings.countInValue} then coalesce(${valuationSnapshots.valueBase}, ${holdings.costTotalBase}) end), 0)`,
      costBase: sql<number>`coalesce(sum(case when ${holdings.countInCost} then ${holdings.costTotalBase} end), 0)`,
      atCostBase: sql<number>`coalesce(sum(case when ${holdings.countInValue} and ${valuationSnapshots.valueBase} is null then ${holdings.costTotalBase} end), 0)`,
      estimatedBase: sql<number>`coalesce(sum(case when ${holdings.countInValue} and ${valuationSnapshots.quantityInferred} then ${valuationSnapshots.valueBase} end), 0)`,
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
  medianBase: number;
  count: number;
  /** Trades of that day whose lot size was estimated. */
  estimated: number;
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
      priceBase: priceObservations.priceBase,
      quantityInferred: priceObservations.quantityInferred,
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
    { day: string; source: string; bucket: string | null; prices: number[]; estimated: number }
  >();
  for (const r of rows) {
    const day = r.observedAt.slice(0, 10);
    const key = `${day}\u0000${r.source}\u0000${r.bucket ?? ''}`;
    const g = groups.get(key) ?? {
      day,
      source: r.source,
      bucket: r.bucket,
      prices: [],
      estimated: 0,
    };
    g.prices.push(r.priceBase);
    if (r.quantityInferred) g.estimated++;
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

/**
 * How items' market values moved over each period (requirements S8, Summary insights), from the
 * daily snapshots: the latest snapshot day against the day `days` before.
 * - mine: the user's lots still owned and counted in value, summed per item (same lots both days);
 * - market: every item anyone holds, by its unit value (the median over the lots holding it).
 * Items worth under ¥1,000 then, and items that did not move, are left out (noise).
 */
export async function moversByPeriod(
  db: Db,
  userId: string,
  periods: readonly number[],
): Promise<{ mine: Map<number, Mover[]>; market: Map<number, Mover[]> }> {
  const mine = new Map<number, Mover[]>();
  const market = new Map<number, Mover[]>();
  const [latest] = await db
    .select({ date: sql<string | null>`max(${valuationSnapshots.date})` })
    .from(valuationSnapshots);
  if (!latest?.date) return { mine, market };
  const thenOf = (days: number) =>
    tokyoDate(new Date(Date.parse(`${latest.date}T12:00:00+09:00`) - days * DAY));
  const rows = await db
    .select({
      product: products,
      holdingId: holdings.id,
      userId: holdings.userId,
      countInValue: holdings.countInValue,
      quantity: holdings.quantity,
      date: valuationSnapshots.date,
      valueBase: valuationSnapshots.valueBase,
    })
    .from(valuationSnapshots)
    .innerJoin(holdings, eq(holdings.id, valuationSnapshots.holdingId))
    .innerJoin(products, eq(products.id, holdings.productId))
    .where(
      and(
        eq(holdings.status, 'owned'),
        inArray(valuationSnapshots.date, [latest.date, ...periods.map(thenOf)]),
      ),
    );
  const valueOn = new Map<string, number>(); // holdingId|date -> value
  const lots = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    if (r.valueBase === null) continue;
    valueOn.set(`${r.holdingId}|${r.date}`, r.valueBase);
    lots.set(r.holdingId, r);
  }
  const finish = (list: Mover[]) =>
    list
      .filter((m) => m.thenBase >= 1_000 && m.nowBase !== m.thenBase)
      .map((m) => ({
        ...m,
        changeBase: m.nowBase - m.thenBase,
        pct: Math.round(((m.nowBase - m.thenBase) / m.thenBase) * 1000) / 10,
      }));
  for (const days of periods) {
    const then = thenOf(days);
    const own = new Map<string, Mover>();
    const units = new Map<string, { product: Product; now: number[]; then: number[] }>();
    for (const lot of lots.values()) {
      const now = valueOn.get(`${lot.holdingId}|${latest.date}`);
      const before = valueOn.get(`${lot.holdingId}|${then}`);
      if (now === undefined || before === undefined) continue;
      if (lot.userId === userId && lot.countInValue) {
        const m = own.get(lot.product.id) ?? {
          product: lot.product,
          nowBase: 0,
          thenBase: 0,
          changeBase: 0,
          pct: 0,
        };
        m.nowBase += now;
        m.thenBase += before;
        own.set(lot.product.id, m);
      }
      const u = units.get(lot.product.id) ?? { product: lot.product, now: [], then: [] };
      u.now.push(now / lot.quantity);
      u.then.push(before / lot.quantity);
      units.set(lot.product.id, u);
    }
    mine.set(days, finish([...own.values()]));
    market.set(
      days,
      finish(
        [...units.values()].map((u) => ({
          product: u.product,
          nowBase: Math.round(median(u.now)!),
          thenBase: Math.round(median(u.then)!),
          changeBase: 0,
          pct: 0,
        })),
      ),
    );
  }
  return { mine, market };
}

/**
 * Sales counted per period for every item anyone holds (one pass): `mine` marks the user's own
 * items. Sorted by the caller per period.
 */
export async function tradeCounts(db: Db, userId: string, periods: readonly number[]) {
  const longest = Math.max(...periods);
  const since = (days: number) => toTokyoIso(new Date(Date.now() - days * DAY));
  const counts = Object.fromEntries(
    periods.map((days) => [
      `d${days}`,
      sql<number>`sum(case when ${priceObservations.observedAt} >= ${since(days)} then 1 else 0 end)`,
    ]),
  );
  const rows = await db
    .select({
      product: products,
      mine: sql<number>`max(case when ${priceObservations.productId} in (select ${holdings.productId} from ${holdings} where ${holdings.userId} = ${userId} and ${holdings.status} = 'owned') then 1 else 0 end)`,
      ...counts,
    })
    .from(priceObservations)
    .innerJoin(products, eq(products.id, priceObservations.productId))
    .where(
      and(
        sql`${priceObservations.productId} in (select ${holdings.productId} from ${holdings} where ${holdings.status} = 'owned')`,
        eq(priceObservations.observationType, 'sold'),
        eq(priceObservations.excluded, false),
        gte(priceObservations.observedAt, since(longest)),
      ),
    )
    .groupBy(priceObservations.productId);
  return rows.map((r) => {
    const row = r as unknown as Record<string, unknown>;
    return {
      product: r.product,
      mine: Number(r.mine) === 1,
      sales: new Map(periods.map((days) => [days, Number(row[`d${days}`] ?? 0)])),
    };
  });
}

/** Forget every saved value (a source's role changed: every item is valued again). */
export async function clearAllBucketValues(db: Db) {
  await db.delete(bucketValues);
}
