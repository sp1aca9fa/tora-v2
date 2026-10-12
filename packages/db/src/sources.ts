// Price sources: links between products and source listings, match candidates, observations,
// collector runs and health. Products and market data are shared by all users.
import { type CollectorRunStatus, median, productClass, toTokyoIso } from '@tora/core';
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  gte,
  inArray,
  isNull,
  lt,
  max,
  ne,
  not,
  or,
  sql,
} from 'drizzle-orm';
import type { Db } from './client';
import { clearBucketValues } from './valuation';
import {
  type NewPriceObservation,
  type Product,
  type ProductSource,
  type RecentSale,
  type SourceCandidate,
  type SourceQuery,
  collectorRuns,
  holdings,
  priceObservations,
  productSources,
  products,
  sourceCandidates,
  sourceWarningDismissals,
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
  const counts = await db
    .select({
      source: priceObservations.source,
      n: count(),
      latest: max(priceObservations.observedAt),
    })
    .from(priceObservations)
    .where(eq(priceObservations.productId, productId))
    .groupBy(priceObservations.source);
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

/** Latest trades (sales only: store, buylist and foreign market prices are shown elsewhere). */
export async function recentObservations(db: Db, productId: string, limit = 20) {
  return db
    .select()
    .from(priceObservations)
    .where(
      and(
        eq(priceObservations.productId, productId),
        eq(priceObservations.observationType, 'sold'),
      ),
    )
    .orderBy(desc(priceObservations.observedAt), desc(priceObservations.createdAt))
    .limit(limit);
}

export interface BucketStat {
  source: string;
  bucket: string | null;
  count: number;
  medianJpy: number | null;
  latest: string;
}

/** Sold count and median per source + bucket over the last `days` (plain median; S5 adds IQR). */
export async function bucketStats(
  db: Db,
  productId: string,
  days = 30,
  now = new Date(),
): Promise<BucketStat[]> {
  const since = toTokyoIso(new Date(now.getTime() - days * 86_400_000));
  const rows = await db
    .select({
      source: priceObservations.source,
      bucket: priceObservations.bucket,
      price: priceObservations.priceJpy,
      at: priceObservations.observedAt,
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
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = `${r.source}\u0000${r.bucket ?? ''}`;
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }
  return [...groups.values()]
    .map((g) => ({
      source: g[0]!.source,
      bucket: g[0]!.bucket,
      count: g.length,
      medianJpy: median(g.map((r) => r.price)),
      latest: g
        .map((r) => r.at)
        .sort()
        .at(-1)!,
    }))
    .sort((a, b) => b.count - a.count);
}

// ---------------------------------------------------------------------------------------------
// collector side (home PC)

/** Owned (or opened) products without an active listing or pending candidates for this source. */
export async function productsToMatch(
  db: Db,
  source: string,
  filter: { productId?: string; limit?: number } = {},
): Promise<Product[]> {
  return db
    .select()
    .from(products)
    .where(
      and(
        filter.productId ? eq(products.id, filter.productId) : undefined,
        exists(
          db
            .select({ one: sql`1` })
            .from(holdings)
            .where(
              and(
                eq(holdings.productId, products.id),
                // Opened boxes still need prices: the box view values them "as received".
                inArray(holdings.status, ['owned', 'consumed']),
              ),
            ),
        ),
        not(
          exists(
            db
              .select({ one: sql`1` })
              .from(productSources)
              .where(
                and(
                  eq(productSources.productId, products.id),
                  eq(productSources.source, source),
                  eq(productSources.active, true),
                ),
              ),
          ),
        ),
        not(
          exists(
            db
              .select({ one: sql`1` })
              .from(sourceCandidates)
              .where(
                and(
                  eq(sourceCandidates.productId, products.id),
                  eq(sourceCandidates.source, source),
                  eq(sourceCandidates.status, 'pending'),
                ),
              ),
          ),
        ),
      ),
    )
    .orderBy(asc(products.createdAt))
    .limit(filter.limit ?? 10_000);
}

export interface CandidateInput {
  externalId: string;
  title: string;
  url?: string | null;
  imageUrl?: string | null;
  priceJpy?: number | null;
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

/** Inserts observations, skipping ones already stored (same source + external_ref). */
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
      .set({ detailsSyncedAt: toTokyoIso() })
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
      ...(patch.success ? { lastSuccessAt: toTokyoIso() } : {}),
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

export async function startRun(db: Db, source: string): Promise<string> {
  // Close out runs of this source that never finished (crash, PC shut down mid-run).
  await db
    .update(collectorRuns)
    .set({ status: 'failed', finishedAt: toTokyoIso(), error: 'interrupted (never finished)' })
    .where(
      and(
        eq(collectorRuns.source, source),
        eq(collectorRuns.status, 'running'),
        lt(collectorRuns.startedAt, toTokyoIso(new Date(Date.now() - STALE_RUN_MS))),
      ),
    );
  const [run] = await db
    .insert(collectorRuns)
    .values({ source, startedAt: toTokyoIso(), status: 'running' })
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
    error?: string | null;
  },
): Promise<void> {
  await db
    .update(collectorRuns)
    .set({ ...result, error: result.error?.slice(0, 2000) ?? null, finishedAt: toTokyoIso() })
    .where(eq(collectorRuns.id, id));
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
 * buckets whose last-7-day median moved more than 50 % against the 30 days before.
 */
export async function collectorHealth(db: Db, now = new Date()): Promise<SourceHealth[]> {
  const day = 86_400_000;
  const iso = (ms: number) => toTokyoIso(new Date(now.getTime() - ms));
  const sources = await db
    .selectDistinct({ source: productSources.source })
    .from(productSources)
    .union(db.selectDistinct({ source: collectorRuns.source }).from(collectorRuns));

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

    const obs = await db
      .select({
        productId: priceObservations.productId,
        bucket: priceObservations.bucket,
        price: priceObservations.priceJpy,
        at: priceObservations.observedAt,
      })
      .from(priceObservations)
      .where(
        and(
          eq(priceObservations.source, source),
          eq(priceObservations.observationType, 'sold'),
          eq(priceObservations.excluded, false),
          gte(priceObservations.observedAt, iso(37 * day)),
        ),
      );
    const recentFrom = iso(7 * day);
    const groups = new Map<
      string,
      { recent: number[]; before: number[]; productId: string; bucket: string | null }
    >();
    for (const o of obs) {
      const key = `${o.productId}\u0000${o.bucket ?? ''}`;
      const g = groups.get(key) ?? {
        recent: [],
        before: [],
        productId: o.productId,
        bucket: o.bucket,
      };
      (o.at >= recentFrom ? g.recent : g.before).push(o.price);
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

/** Owned (or opened) products with no source row at all for `source` (an unlinked one counts). */
export async function productsWithoutSource(
  db: Db,
  source: string,
  filter: { productId?: string; limit?: number } = {},
): Promise<Product[]> {
  return db
    .select()
    .from(products)
    .where(
      and(
        filter.productId ? eq(products.id, filter.productId) : undefined,
        exists(
          db
            .select({ one: sql`1` })
            .from(holdings)
            .where(
              and(
                eq(holdings.productId, products.id),
                inArray(holdings.status, ['owned', 'consumed']),
              ),
            ),
        ),
        not(
          exists(
            db
              .select({ one: sql`1` })
              .from(productSources)
              .where(
                and(eq(productSources.productId, products.id), eq(productSources.source, source)),
              ),
          ),
        ),
      ),
    )
    .orderBy(asc(products.createdAt))
    .limit(filter.limit ?? 500);
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
    .set({ query, updatedAt: toTokyoIso() })
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
  if (row) await clearBucketValues(db, [row.productId]);
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
      priceJpy: priceObservations.priceJpy,
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
        gte(priceObservations.observedAt, toTokyoIso(new Date(Date.now() - days * 86_400_000))),
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

/** Non-card items costing more than this should be linked to a store page (user, 2026-10-12). */
export const STORE_LINK_MIN_COST = 3000;

/**
 * The stable, product-level source an item should be linked to: SNKRDUNK for cards and sealed
 * product (boxes, packs, decks, special sets), 駿河屋 for other items costing more than ¥3,000 (what
 * the user paid for the lots they own); else none.
 */
export function stableSourceFor(
  product: Pick<Product, 'category' | 'kind'>,
  costJpy: number,
): 'snkrdunk' | 'surugaya' | null {
  const cls = productClass(product);
  if (cls === 'card' || cls === 'sealed') return 'snkrdunk';
  return costJpy > STORE_LINK_MIN_COST ? 'surugaya' : null;
}

export interface MissingSource {
  product: Product;
  /** The stable source this item should be linked to. */
  source: 'snkrdunk' | 'surugaya';
  /** What the user paid for the lots they own. */
  costJpy: number;
  /** Suggestions from that source waiting for confirmation. */
  suggestions: number;
}

/**
 * Owned items without their stable, product-level price source (requirements S7): cards and
 * sealed product not linked to SNKRDUNK (Mercari searches are a plus, not a replacement), and
 * other items costing more than ¥3,000 not linked to a 駿河屋 page. Lots still in the import review are left out.
 */
export async function missingPriceSources(db: Db, userId: string): Promise<MissingSource[]> {
  const owned = await db
    .select({ product: products, cost: sql<number>`sum(${holdings.costTotalJpy})` })
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
  const wanted = owned.flatMap(({ product, cost }) => {
    const source = stableSourceFor(product, Number(cost));
    return source ? [{ product, costJpy: Number(cost), source }] : [];
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
    .filter((w) => !has.has(`${w.product.id}|${w.source}`) && !dismissed.has(w.product.id))
    .map((w) => ({
      ...w,
      suggestions:
        pending.find((p) => p.productId === w.product.id && p.source === w.source)?.n ?? 0,
    }))
    .sort((a, b) => b.costJpy - a.costJpy);
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
