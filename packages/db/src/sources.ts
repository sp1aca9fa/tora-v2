// Price sources: links between products and source listings, match candidates, observations,
// collector runs and health. Products and market data are shared by all users.
import {
  type CollectorRunStatus,
  type SourceRegistry,
  median,
  productClass,
  identitySources,
  toLocalIso,
  conditionListOf,
  IDENTITY_MIN_COST,
} from '@tora/core';
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  not,
  or,
  sql,
} from 'drizzle-orm';
import type { Db } from './client';
import {
  daysBack,
  loadItemSales,
  refreshItemSales,
  soldDaysOf,
  sourceCounts,
  unpackSales,
} from './item-sales';
import { rankedProductIds } from './rankings';
import { loadSourceRegistry, readSetting, saveSetting } from './registry';
import { clearBucketValues } from './valuation';
import {
  type NewPriceObservation,
  type Product,
  type ProductSource,
  type RecentSale,
  type SourceCandidate,
  type SourceQuery,
  appSettings,
  collectorRuns,
  holdings,
  priceObservations,
  productSources,
  products,
  sourceCandidates,
  sourceWarningDismissals,
  watches,
} from './schema';

// ---------------------------------------------------------------------------------------------
// linking (web app)

export async function userHoldsProduct(db: Db, userId: string, productId: string) {
  const [row] = await db
    .select({ n: count() })
    .from(holdings)
    .where(and(eq(holdings.userId, userId), eq(holdings.productId, productId)));
  return (row?.n ?? 0) > 0;
}

export async function listProductSources(db: Db, productId: string) {
  const sources = await db
    .select()
    .from(productSources)
    .where(eq(productSources.productId, productId))
    .orderBy(asc(productSources.createdAt));
  const counts = sourceCounts((await loadItemSales(db, [productId])).get(productId));
  return sources.map((s) => {
    const c = counts.find((x) => x.source === s.source);
    return { ...s, observations: c?.n ?? 0, latestObservation: c?.latest ?? null };
  });
}

export async function listPendingCandidates(db: Db, productId: string): Promise<SourceCandidate[]> {
  return db
    .select()
    .from(sourceCandidates)
    .where(and(eq(sourceCandidates.productId, productId), eq(sourceCandidates.status, 'pending')))
    .orderBy(desc(sourceCandidates.score), asc(sourceCandidates.createdAt));
}

/** Title without bracketed tags like 【シュリンクなし】: variants of one listing share it. */
export function listingBaseTitle(title: string): string {
  return title
    .normalize('NFKC')
    .replace(/【[^】]*】/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Links (or re-activates) a source listing. A product may have several listings per source
 * (e.g. a box with and without shrink wrap). Pending candidates of that source are cleared,
 * except variants of the confirmed listing (same title apart from 【…】 tags).
 */
export async function linkSource(
  db: Db,
  productId: string,
  link: { source: string; externalId: string; url?: string | null; title?: string | null },
  imageUrl?: string | null,
): Promise<ProductSource> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(productSources)
      .values({ productId, ...link, imageUrl: imageUrl ?? null, active: true })
      .onConflictDoUpdate({
        target: [productSources.productId, productSources.source, productSources.externalId],
        set: {
          active: true,
          ...(link.title ? { title: link.title } : {}),
          ...(imageUrl ? { imageUrl } : {}),
        },
      })
      .returning();
    const pending = await tx
      .select()
      .from(sourceCandidates)
      .where(
        and(
          eq(sourceCandidates.productId, productId),
          eq(sourceCandidates.source, link.source),
          eq(sourceCandidates.status, 'pending'),
        ),
      );
    const base = link.title ? listingBaseTitle(link.title) : null;
    const drop = pending.filter(
      (c) => c.externalId === link.externalId || !base || listingBaseTitle(c.title) !== base,
    );
    if (drop.length) {
      await tx.delete(sourceCandidates).where(
        inArray(
          sourceCandidates.id,
          drop.map((c) => c.id),
        ),
      );
    }
    return row!;
  });
}

export async function confirmCandidate(db: Db, candidateId: string): Promise<ProductSource | null> {
  const [c] = await db.select().from(sourceCandidates).where(eq(sourceCandidates.id, candidateId));
  if (!c || c.status !== 'pending') return null;
  return linkSource(
    db,
    c.productId,
    { source: c.source, externalId: c.externalId, url: c.url, title: c.title },
    c.imageUrl,
  );
}

export async function rejectCandidate(
  db: Db,
  candidateId: string,
): Promise<SourceCandidate | null> {
  const [c] = await db
    .update(sourceCandidates)
    .set({ status: 'rejected' })
    .where(eq(sourceCandidates.id, candidateId))
    .returning();
  return c ?? null;
}

export async function getCandidate(db: Db, id: string) {
  const [c] = await db.select().from(sourceCandidates).where(eq(sourceCandidates.id, id));
  return c ?? null;
}

export async function getProductSource(db: Db, id: string) {
  const [s] = await db.select().from(productSources).where(eq(productSources.id, id));
  return s ?? null;
}

/** Stops collecting from a listing; its observations are kept. */
export async function unlinkSource(db: Db, sourceId: string): Promise<void> {
  const [link] = await db
    .update(productSources)
    .set({ active: false })
    .where(eq(productSources.id, sourceId))
    .returning({ productId: productSources.productId });
  // Its recent sales no longer count.
  if (link) await clearBucketValues(db, [link.productId]);
}

/**
 * Products the user holds with matches waiting for confirmation from a source they are not linked
 * to yet, one holding each. Leftover suggestions of a linked source (e.g. a no-shrink variant) are
 * optional and not counted.
 */
export async function pendingMatchesForUser(db: Db, userId: string) {
  return db
    .select({ product: products, holdingId: sql<string>`min(${holdings.id})` })
    .from(products)
    .innerJoin(holdings, and(eq(holdings.productId, products.id), eq(holdings.userId, userId)))
    .where(
      exists(
        db
          .select({ one: sql`1` })
          .from(sourceCandidates)
          .where(
            and(
              eq(sourceCandidates.productId, products.id),
              eq(sourceCandidates.status, 'pending'),
              not(
                exists(
                  db
                    .select({ one: sql`1` })
                    .from(productSources)
                    .where(
                      and(
                        eq(productSources.productId, products.id),
                        eq(productSources.source, sourceCandidates.source),
                        eq(productSources.active, true),
                      ),
                    ),
                ),
              ),
            ),
          ),
      ),
    )
    .groupBy(products.id)
    .orderBy(asc(products.name));
}

// ---------------------------------------------------------------------------------------------
// market data (web app)

/**
 * Latest trades (sales only: store, buylist and foreign market prices are shown elsewhere): the
 * latest of each source (one short read each on the item + source index), merged.
 */
export async function recentObservations(db: Db, productId: string, limit = 20) {
  const sources = (await loadSourceRegistry(db)).sources.map((s) => s.key);
  const lists = await Promise.all(
    sources.map((source) =>
      db
        .select()
        .from(priceObservations)
        .where(
          and(
            eq(priceObservations.productId, productId),
            eq(priceObservations.source, source),
            eq(priceObservations.observationType, 'sold'),
          ),
        )
        .orderBy(desc(priceObservations.observedAt), desc(priceObservations.createdAt))
        .limit(limit),
    ),
  );
  return lists
    .flat()
    .sort(
      (a, b) => b.observedAt.localeCompare(a.observedAt) || b.createdAt.localeCompare(a.createdAt),
    )
    .slice(0, limit);
}

export interface BucketStat {
  source: string;
  bucket: string | null;
  count: number;
  medianBase: number | null;
  /** The time of the last sale. */
  latest: string;
}

/** Sold count and median per source + bucket over the last `days` (from the packed item sales). */
export async function bucketStats(
  db: Db,
  productId: string,
  days = 30,
  now = new Date(),
): Promise<BucketStat[]> {
  const since = toLocalIso(new Date(now.getTime() - days * 86_400_000));
  const groups = new Map<string, BucketStat & { prices: number[] }>();
  const sales = (await loadItemSales(db, [productId])).get(productId);
  for (const o of unpackSales(sales, { since, types: ['sold'] })) {
    const key = `${o.source}\u0000${o.bucket ?? ''}`;
    const g = groups.get(key) ?? {
      source: o.source,
      bucket: o.bucket,
      count: 0,
      medianBase: null,
      latest: o.observedAt,
      prices: [],
    };
    g.prices.push(o.priceBase);
    if (o.observedAt > g.latest) g.latest = o.observedAt;
    groups.set(key, g);
  }
  return [...groups.values()]
    .map(({ prices, ...g }) => ({ ...g, count: prices.length, medianBase: median(prices) }))
    .sort((a, b) => b.count - a.count);
}

// ---------------------------------------------------------------------------------------------
// collector side (home PC)

/**
 * Products someone owns, has opened (the box view values them "as received") or watches (S9), and
 * a ranking's top items (S13): the ones collectors match and collect.
 */
async function trackedProductIds(db: Db): Promise<Set<string>> {
  const held = await db
    .selectDistinct({ id: holdings.productId })
    .from(holdings)
    .where(inArray(holdings.status, ['owned', 'consumed']));
  const watched = await db.selectDistinct({ id: watches.productId }).from(watches);
  // A ranking's top items (S13): candidates are collected while they stay there.
  const ranked = await rankedProductIds(db);
  return new Set([...[...held, ...watched].map((r) => r.id), ...ranked]);
}

/** These products, oldest first (in chunks: an id list can be long). */
async function productsByIds(db: Db, ids: string[], limit: number): Promise<Product[]> {
  const out: Product[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    out.push(
      ...(await db
        .select()
        .from(products)
        .where(inArray(products.id, ids.slice(i, i + 500)))),
    );
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, limit);
}

/** Products searched on a source today (app setting per source: one day's ids). */
const searchedKey = (source: string) => `matchSearched:${source}`;

export async function searchedToday(db: Db, source: string, day: string): Promise<Set<string>> {
  const saved = await readSetting<{ day: string; ids: string[] }>(db, searchedKey(source));
  return new Set(saved?.day === day ? saved.ids : []);
}

/** Marks a product searched on a source today (a retry that day leaves it out). */
export async function markSearched(
  db: Db,
  source: string,
  day: string,
  ids: Set<string>,
): Promise<void> {
  await saveSetting(db, searchedKey(source), { day, ids: [...ids] });
}

/** Tracked products (owned, opened or watched) without an active listing or pending candidates for this source. */
export async function productsToMatch(
  db: Db,
  source: string,
  filter: { productId?: string; limit?: number } = {},
): Promise<Product[]> {
  // Set by set on indexes (not a lookup per product): tracked, minus linked or with suggestions.
  const tracked = await trackedProductIds(db);
  const linked = await db
    .selectDistinct({ id: productSources.productId })
    .from(productSources)
    .where(and(eq(productSources.source, source), eq(productSources.active, true)));
  const pending = await db
    .selectDistinct({ id: sourceCandidates.productId })
    .from(sourceCandidates)
    .where(and(eq(sourceCandidates.source, source), eq(sourceCandidates.status, 'pending')));
  const skip = new Set([...linked, ...pending].map((r) => r.id));
  const ids = [...tracked].filter(
    (id) => !skip.has(id) && (!filter.productId || id === filter.productId),
  );
  return productsByIds(db, ids, filter.limit ?? 10_000);
}

export interface CandidateInput {
  externalId: string;
  title: string;
  url?: string | null;
  imageUrl?: string | null;
  priceBase?: number | null;
  score: number;
}

/** Stores new candidates; ones the user already rejected stay rejected. Returns how many are pending. */
export async function saveCandidates(
  db: Db,
  productId: string,
  source: string,
  candidates: CandidateInput[],
): Promise<number> {
  if (candidates.length === 0) return 0;
  const inserted = await db
    .insert(sourceCandidates)
    .values(candidates.map((c) => ({ productId, source, ...c })))
    .onConflictDoNothing()
    .returning({ id: sourceCandidates.id });
  return inserted.length;
}

export async function activeSources(
  db: Db,
  source: string,
  filter: { productId?: string } = {},
): Promise<{ source: ProductSource; product: Product }[]> {
  return (
    db
      .select({ source: productSources, product: products })
      .from(productSources)
      .innerJoin(products, eq(products.id, productSources.productId))
      .where(
        and(
          eq(productSources.source, source),
          eq(productSources.active, true),
          filter.productId ? eq(productSources.productId, filter.productId) : undefined,
        ),
      )
      // Sources never collected (or least recently) first, so a capped run still makes progress.
      .orderBy(sql`${productSources.lastSuccessAt} IS NOT NULL`, asc(productSources.lastSuccessAt))
  );
}

/**
 * Inserts observations, skipping ones already stored (same source + external_ref), and rebuilds
 * the packed item sales of the days they fall on.
 */
export async function insertObservations(db: Db, rows: NewPriceObservation[]): Promise<number> {
  let added = 0;
  // Sales the user vouched for (a pasted listing) are included even if stored excluded before.
  const vouched = rows.filter((r) => (r.raw as { reference?: boolean } | null)?.reference);
  for (const r of vouched) {
    const inserted = await db
      .insert(priceObservations)
      .values(r)
      .onConflictDoUpdate({
        target: [priceObservations.source, priceObservations.externalRef],
        set: { excluded: false, excludedReason: null, bucket: r.bucket, raw: r.raw },
      })
      .returning({ id: priceObservations.id });
    added += inserted.length;
  }
  rows = rows.filter((r) => !vouched.includes(r));
  for (let i = 0; i < rows.length; i += 100) {
    const inserted = await db
      .insert(priceObservations)
      .values(rows.slice(i, i + 100))
      .onConflictDoNothing({ target: [priceObservations.source, priceObservations.externalRef] })
      .returning({ id: priceObservations.id });
    added += inserted.length;
  }
  if (added > 0 || vouched.length > 0) {
    await clearBucketValues(db, [...new Set([...vouched, ...rows].map((r) => r.productId))]);
    // The packed item sales of the days just added, so they never lag behind the sales.
    await refreshItemSales(db, { marksOnly: true });
  }
  return added;
}

/**
 * Applies details read from a linked listing to its product, once per link. Catalog products
 * keep their catalog set (id, name, code); only empty or listing-specific fields change there.
 */
export async function syncProductDetails(
  db: Db,
  link: Pick<ProductSource, 'id' | 'productId'>,
  details: Partial<
    Pick<Product, 'name' | 'rarity' | 'setName' | 'setCode' | 'cardNumber' | 'variant' | 'imageUrl'>
  > | null,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    let changed = false;
    if (details) {
      const [product] = await tx.select().from(products).where(eq(products.id, link.productId));
      if (product) {
        const patch = Object.fromEntries(
          Object.entries(details).filter(([key, value]) => {
            if (value === undefined || value === null || value === '') return false;
            if (product.setId && (key === 'setName' || key === 'setCode')) return false;
            return product[key as keyof Product] !== value;
          }),
        );
        if (Object.keys(patch).length) {
          await tx.update(products).set(patch).where(eq(products.id, product.id));
          changed = true;
        }
      }
    }
    await tx
      .update(productSources)
      .set({ detailsSyncedAt: toLocalIso() })
      .where(eq(productSources.id, link.id));
    return changed;
  });
}

export async function updateSourceProgress(
  db: Db,
  sourceId: string,
  patch: {
    state?: unknown;
    success?: boolean;
    title?: string | null;
    url?: string | null;
    recentSales?: RecentSale[];
    imageUrl?: string | null;
  },
): Promise<void> {
  const [link] = await db
    .update(productSources)
    .set({
      ...(patch.state !== undefined ? { state: patch.state } : {}),
      ...(patch.success ? { lastSuccessAt: toLocalIso() } : {}),
      ...(patch.title ? { title: patch.title } : {}),
      ...(patch.url ? { url: patch.url } : {}),
      ...(patch.recentSales ? { recentSales: patch.recentSales } : {}),
      ...(patch.imageUrl ? { imageUrl: patch.imageUrl } : {}),
    })
    .where(eq(productSources.id, sourceId))
    .returning({ productId: productSources.productId });
  if (link && patch.recentSales) await clearBucketValues(db, [link.productId]);
}

/** A run still "running" after this long was interrupted (runs take about half an hour). */
const STALE_RUN_MS = 3 * 60 * 60 * 1000;

/**
 * Records a run's start. `exclusive`: the caller holds the source's lock, so any run still marked
 * running was cut off and is closed out whatever its age.
 */
export async function startRun(
  db: Db,
  source: string,
  options: { exclusive?: boolean } = {},
): Promise<string> {
  // Close out runs of this source that never finished (crash, PC shut down mid-run).
  await db
    .update(collectorRuns)
    .set({ status: 'failed', finishedAt: toLocalIso(), error: 'interrupted (never finished)' })
    .where(
      and(
        eq(collectorRuns.source, source),
        eq(collectorRuns.status, 'running'),
        options.exclusive
          ? undefined
          : lt(collectorRuns.startedAt, toLocalIso(new Date(Date.now() - STALE_RUN_MS))),
      ),
    );
  const [run] = await db
    .insert(collectorRuns)
    .values({ source, startedAt: toLocalIso(), status: 'running' })
    .returning({ id: collectorRuns.id });
  return run!.id;
}

export async function finishRun(
  db: Db,
  id: string,
  result: {
    status: CollectorRunStatus;
    requests: number;
    observationsAdded: number;
    /** Working time, without time the PC slept. */
    activeMs?: number | null;
    error?: string | null;
  },
): Promise<void> {
  await db
    .update(collectorRuns)
    .set({ ...result, error: result.error?.slice(0, 2000) ?? null, finishedAt: toLocalIso() })
    .where(eq(collectorRuns.id, id));
}

// ---------------------------------------------------------------------------------------------
// run times (S16: ground rules for heavy users)

/** The night window when the admin has not set one: 6 hours. */
export const COLLECT_WINDOW_HOURS = 6;

export interface CollectorTimes {
  /** Per source: its last finished run's working time and the median of the runs before (ms). */
  sources: Record<string, { last: number; usual: number | null; long: boolean }>;
  /** The last night: each source's last run started within a day of the newest one, added up. */
  night: number;
  windowHours: number;
  over: boolean;
}

/** A run's working time; older runs without one: start to finish. */
const runMs = (r: { activeMs: number | null; startedAt: string; finishedAt: string | null }) =>
  r.activeMs ?? Math.max(0, Date.parse(r.finishedAt!) - Date.parse(r.startedAt));

/**
 * How long collectors take (Settings > Collectors): a run is long when it took over twice its
 * usual time and at least 5 minutes more; the night is over when its total passes the window.
 */
export async function collectorTimes(db: Db): Promise<CollectorTimes> {
  const [runs, [setting]] = await Promise.all([
    db
      .select({
        source: collectorRuns.source,
        startedAt: collectorRuns.startedAt,
        finishedAt: collectorRuns.finishedAt,
        activeMs: collectorRuns.activeMs,
      })
      .from(collectorRuns)
      .where(isNotNull(collectorRuns.finishedAt))
      .orderBy(desc(collectorRuns.startedAt))
      .limit(500),
    db.select().from(appSettings).where(eq(appSettings.key, 'collectWindow')),
  ]);
  const bySource = new Map<string, typeof runs>();
  for (const r of runs) {
    const list = bySource.get(r.source) ?? [];
    if (list.length < 8) bySource.set(r.source, [...list, r]);
  }
  const sources: CollectorTimes['sources'] = {};
  const newest = runs[0]?.startedAt;
  let night = 0;
  for (const [source, [last, ...before]] of bySource) {
    const ms = runMs(last!);
    const usual = median(before.map(runMs));
    sources[source] = {
      last: ms,
      usual,
      long: usual !== null && ms > 2 * usual && ms - usual >= 5 * 60_000,
    };
    if (newest && Date.parse(newest) - Date.parse(last!.startedAt) < 86_400_000) night += ms;
  }
  const saved = Number(setting?.value);
  const windowHours = saved > 0 ? saved : COLLECT_WINDOW_HOURS;
  return { sources, night, windowHours, over: night > windowHours * 3_600_000 };
}

// ---------------------------------------------------------------------------------------------
// health (Settings)

export interface SourceHealth {
  source: string;
  lastRun: typeof collectorRuns.$inferSelect | null;
  linked: number;
  pending: number;
  stale: { product: Product; lastSuccessAt: string | null }[];
  jumps: { product: Product; bucket: string | null; before: number; recent: number }[];
}

/**
 * Per source: last run, linked / pending counts, listings not collected for 3+ days, and
 * buckets whose last-7-day median moved more than 50 % against the 30 days before (whole days).
 */
export async function collectorHealth(db: Db, now = new Date()): Promise<SourceHealth[]> {
  const day = 86_400_000;
  const iso = (ms: number) => toLocalIso(new Date(now.getTime() - ms));
  const sources = await db
    .selectDistinct({ source: productSources.source })
    .from(productSources)
    .union(db.selectDistinct({ source: collectorRuns.source }).from(collectorRuns));

  // Every item's last 37 days of kept sales, from the packed item sales (one row per item).
  const recentFrom = daysBack(7, now);
  const allDays = [...(await loadItemSales(db))].flatMap(([productId, sales]) =>
    soldDaysOf(productId, sales, { since: daysBack(37, now) }),
  );
  const out: SourceHealth[] = [];
  for (const { source } of sources) {
    const [lastRun] = await db
      .select()
      .from(collectorRuns)
      .where(eq(collectorRuns.source, source))
      .orderBy(desc(collectorRuns.startedAt))
      .limit(1);
    const [linked] = await db
      .select({ n: count() })
      .from(productSources)
      .where(and(eq(productSources.source, source), eq(productSources.active, true)));
    const [pending] = await db
      .select({ n: count() })
      .from(sourceCandidates)
      .where(and(eq(sourceCandidates.source, source), eq(sourceCandidates.status, 'pending')));
    const stale = await db
      .select({ product: products, lastSuccessAt: productSources.lastSuccessAt })
      .from(productSources)
      .innerJoin(products, eq(products.id, productSources.productId))
      .where(
        and(
          eq(productSources.source, source),
          eq(productSources.active, true),
          lt(productSources.createdAt, iso(day)),
          or(isNull(productSources.lastSuccessAt), lt(productSources.lastSuccessAt, iso(3 * day))),
        ),
      );

    const groups = new Map<
      string,
      { recent: number[]; before: number[]; productId: string; bucket: string | null }
    >();
    for (const d of allDays) {
      if (d.source !== source) continue;
      const key = `${d.productId}\u0000${d.bucket ?? ''}`;
      const g = groups.get(key) ?? {
        recent: [],
        before: [],
        productId: d.productId,
        bucket: d.bucket,
      };
      (d.day >= recentFrom ? g.recent : g.before).push(...d.prices);
      groups.set(key, g);
    }
    const flagged = [...groups.values()].filter((g) => {
      const r = median(g.recent);
      const b = median(g.before);
      return g.recent.length >= 3 && g.before.length >= 3 && r && b && Math.abs(r - b) / b > 0.5;
    });
    const flaggedProducts = flagged.length
      ? await db
          .select()
          .from(products)
          .where(
            inArray(
              products.id,
              flagged.map((g) => g.productId),
            ),
          )
      : [];
    out.push({
      source,
      lastRun: lastRun ?? null,
      linked: linked?.n ?? 0,
      pending: pending?.n ?? 0,
      stale,
      jumps: flagged.map((g) => ({
        product: flaggedProducts.find((p) => p.id === g.productId)!,
        bucket: g.bucket,
        before: median(g.before)!,
        recent: median(g.recent)!,
      })),
    });
  }
  return out;
}

/** Which of these products have an active listing at any source. */
export async function linkedProductIds(db: Db, productIds: string[]): Promise<Set<string>> {
  if (productIds.length === 0) return new Set();
  const rows = await db
    .selectDistinct({ productId: productSources.productId })
    .from(productSources)
    .where(and(inArray(productSources.productId, productIds), eq(productSources.active, true)));
  return new Set(rows.map((r) => r.productId));
}

// ---------------------------------------------------------------------------------------------
// search-based sources (a saved query per product instead of a listing, e.g. a flea market)

/** Listing id used for a product's search-based source (one query per product and source). */
export const QUERY_SOURCE_ID = 'search';

/** Tracked products (owned, opened or watched) with no source row at all for `source` (an unlinked one counts). */
export async function productsWithoutSource(
  db: Db,
  source: string,
  filter: { productId?: string; limit?: number } = {},
): Promise<Product[]> {
  const tracked = await trackedProductIds(db);
  const listed = await db
    .selectDistinct({ id: productSources.productId })
    .from(productSources)
    .where(eq(productSources.source, source));
  const skip = new Set(listed.map((r) => r.id));
  const ids = [...tracked].filter(
    (id) => !skip.has(id) && (!filter.productId || id === filter.productId),
  );
  return productsByIds(db, ids, filter.limit ?? 500);
}

/** Starts a product's search-based source with a query (active at once). */
export async function createQuerySource(
  db: Db,
  productId: string,
  source: string,
  query: SourceQuery,
): Promise<void> {
  await db
    .insert(productSources)
    .values({ productId, source, externalId: QUERY_SOURCE_ID, query, active: true })
    .onConflictDoNothing();
}

/**
 * Saves an edited query. Sales collected under the old query are dropped (the next run fetches
 * again under the new one), except the ones the user excluded by hand.
 */
/** A collector filled in the search it runs (e.g. keywords built from a linked listing's title). */
export async function setSourceQuery(db: Db, sourceId: string, query: SourceQuery): Promise<void> {
  await db
    .update(productSources)
    .set({ query, updatedAt: toLocalIso() })
    .where(eq(productSources.id, sourceId));
}

export async function updateSourceQuery(
  db: Db,
  sourceId: string,
  query: SourceQuery,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [link] = await tx.select().from(productSources).where(eq(productSources.id, sourceId));
    if (!link) return;
    await tx
      .update(productSources)
      .set({ query, state: null, active: true })
      .where(eq(productSources.id, sourceId));
    await tx
      .delete(priceObservations)
      .where(
        and(
          eq(priceObservations.productId, link.productId),
          eq(priceObservations.source, link.source),
          or(
            isNull(priceObservations.excludedReason),
            ne(priceObservations.excludedReason, 'manual'),
          ),
        ),
      );
    await clearBucketValues(tx, [link.productId]);
  });
  await refreshItemSales(db, { marksOnly: true });
}

/** Latest collected sales of a product from one source, excluded ones included (for review). */
export async function sourceObservations(db: Db, productId: string, source: string, limit = 30) {
  return db
    .select()
    .from(priceObservations)
    .where(and(eq(priceObservations.productId, productId), eq(priceObservations.source, source)))
    .orderBy(desc(priceObservations.observedAt))
    .limit(limit);
}

/** Excludes a sale by hand (or includes it again). */
export async function setObservationExcluded(
  db: Db,
  observationId: string,
  excluded: boolean,
): Promise<{ productId: string } | null> {
  const [row] = await db
    .update(priceObservations)
    .set({ excluded, excludedReason: excluded ? 'manual' : null })
    .where(eq(priceObservations.id, observationId))
    .returning({ productId: priceObservations.productId });
  if (row) {
    await clearBucketValues(db, [row.productId]);
    await refreshItemSales(db, { marksOnly: true });
  }
  return row ?? null;
}

/** Turns a source back on (e.g. a search the user had switched off). */
export async function reactivateSource(db: Db, sourceId: string): Promise<void> {
  const [link] = await db
    .update(productSources)
    .set({ active: true })
    .where(eq(productSources.id, sourceId))
    .returning({ productId: productSources.productId });
  if (link) await clearBucketValues(db, [link.productId]);
}

/** One collected observation (to check who may change it). */
export async function getObservation(db: Db, id: string) {
  const [row] = await db.select().from(priceObservations).where(eq(priceObservations.id, id));
  return row ?? null;
}

/** Kept (not excluded) sold observations of one source for a product, within `days`. */
export async function keptObservations(db: Db, productId: string, source: string, days = 180) {
  return db
    .select({
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
        eq(priceObservations.productId, productId),
        eq(priceObservations.source, source),
        eq(priceObservations.observationType, 'sold'),
        eq(priceObservations.excluded, false),
        gte(priceObservations.observedAt, toLocalIso(new Date(Date.now() - days * 86_400_000))),
      ),
    );
}

/** Listing links the user added to a search-based source (kept in its query, not refetched). */
export async function setSourceReferences(
  db: Db,
  sourceId: string,
  references: string[],
): Promise<void> {
  const [link] = await db.select().from(productSources).where(eq(productSources.id, sourceId));
  if (!link) return;
  const query: SourceQuery = { ...link.query, extra: { ...link.query?.extra, references } };
  await db.update(productSources).set({ query }).where(eq(productSources.id, sourceId));
}

/**
 * Adds a reference listing (a listing of this exact item) to the product's search for `source`,
 * setting the search up with `query` when the product has none. False when the product is linked
 * to a single listing there instead (nothing to add to) or no search could be made.
 */
export async function addSourceReference(
  db: Db,
  productId: string,
  source: string,
  url: string,
  query: SourceQuery | null,
): Promise<boolean> {
  const rows = await db
    .select()
    .from(productSources)
    .where(and(eq(productSources.productId, productId), eq(productSources.source, source)));
  const search = rows.find((r) => r.externalId === QUERY_SOURCE_ID);
  if (search) {
    const refs = (search.query?.extra?.references as string[] | undefined) ?? [];
    if (!refs.includes(url)) await setSourceReferences(db, search.id, [...refs, url]);
    return true;
  }
  if (rows.length > 0 || !query) return false;
  await createQuerySource(db, productId, source, {
    ...query,
    extra: { ...query.extra, references: [url] },
  });
  return true;
}

/**
 * The identity link an item is expected to have (requirements S8): a product page of one of its
 * class's identity sources (see `identitySources`), whatever the price roles; for other items
 * only when they cost more than the admin's identity amount (what the user paid for the lots
 * they own). The preferred source (to look for and suggest) and every source whose page counts, in a market (default:
 * the primary one, S11). Null when none applies.
 */
export function identityFor(
  product: Pick<Product, 'category' | 'kind'> & { itemType?: string | null },
  costBase: number,
  registry: SourceRegistry,
  market: string | null | undefined = registry.markets?.primary,
): { preferred: string; accepted: string[] } | null {
  const cls = productClass(product);
  // Cards and sealed TCG always; other items (the item-condition list, the admin's lists) when not cheap.
  const always = ['card_grades', 'sealed'].includes(conditionListOf(cls));
  if (!always && costBase <= (registry.markets?.identityMinCost ?? IDENTITY_MIN_COST)) return null;
  const accepted = identitySources(registry, cls, market);
  return accepted.length ? { preferred: accepted[0]!, accepted } : null;
}

/** The source an item's identity link is looked for on (see `identityFor`). */
export function stableSourceFor(
  product: Pick<Product, 'category' | 'kind'> & { itemType?: string | null },
  costBase: number,
  registry: SourceRegistry,
): string | null {
  return identityFor(product, costBase, registry)?.preferred ?? null;
}

export interface MissingSource {
  product: Product;
  /** The main source this item should be linked to. */
  source: string;
  /** What the user paid for the lots they own. */
  costBase: number;
  /** Suggestions from that source waiting for confirmation. */
  suggestions: number;
}

/**
 * Owned items without their main price source (requirements S7; see `stableSourceFor`). Lots
 * still in the import review are left out.
 */
export async function missingPriceSources(db: Db, userId: string): Promise<MissingSource[]> {
  const owned = await db
    .select({ product: products, cost: sql<number>`sum(${holdings.costTotalBase})` })
    .from(holdings)
    .innerJoin(products, eq(products.id, holdings.productId))
    .where(
      and(
        eq(holdings.userId, userId),
        eq(holdings.status, 'owned'),
        eq(holdings.reviewPending, false),
      ),
    )
    .groupBy(products.id);
  const registry = await loadSourceRegistry(db);
  const wanted = owned.flatMap(({ product, cost }) => {
    const identity = identityFor(product, Number(cost), registry);
    return identity
      ? [
          {
            product,
            costBase: Number(cost),
            source: identity.preferred,
            accepted: identity.accepted,
          },
        ]
      : [];
  });
  if (wanted.length === 0) return [];
  const ids = wanted.map((w) => w.product.id);
  const [linked, pending] = await Promise.all([
    db
      .select({ productId: productSources.productId, source: productSources.source })
      .from(productSources)
      .where(and(inArray(productSources.productId, ids), eq(productSources.active, true))),
    db
      .select({
        productId: sourceCandidates.productId,
        source: sourceCandidates.source,
        n: count(),
      })
      .from(sourceCandidates)
      .where(and(inArray(sourceCandidates.productId, ids), eq(sourceCandidates.status, 'pending')))
      .groupBy(sourceCandidates.productId, sourceCandidates.source),
  ]);
  const has = new Set(linked.map((l) => `${l.productId}|${l.source}`));
  const dismissed = await dismissedSourceWarnings(db, userId);
  return wanted
    .filter(
      (w) =>
        !w.accepted.some((source) => has.has(`${w.product.id}|${source}`)) &&
        !dismissed.has(w.product.id),
    )
    .map(({ accepted: _accepted, ...w }) => ({
      ...w,
      suggestions:
        pending.find((p) => p.productId === w.product.id && p.source === w.source)?.n ?? 0,
    }))
    .sort((a, b) => b.costBase - a.costBase);
}

/** Items the user asked not to be warned about (no stable source expected). */
export async function dismissedSourceWarnings(db: Db, userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ productId: sourceWarningDismissals.productId })
    .from(sourceWarningDismissals)
    .where(eq(sourceWarningDismissals.userId, userId));
  return new Set(rows.map((r) => r.productId));
}

/** Stops (or, with `dismiss` false, restarts) the "not linked" warning for an item. */
export async function setSourceWarningDismissed(
  db: Db,
  userId: string,
  productId: string,
  dismiss: boolean,
): Promise<void> {
  if (dismiss) {
    await db.insert(sourceWarningDismissals).values({ userId, productId }).onConflictDoNothing();
  } else {
    await db
      .delete(sourceWarningDismissals)
      .where(
        and(
          eq(sourceWarningDismissals.userId, userId),
          eq(sourceWarningDismissals.productId, productId),
        ),
      );
  }
}
