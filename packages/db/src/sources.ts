// Price sources: links between products and source listings, match candidates, observations,
// collector runs and health. Products and market data are shared by all users.
import { type CollectorRunStatus, median, toTokyoIso } from '@tora/core';
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
  not,
  or,
  sql,
} from 'drizzle-orm';
import type { Db } from './client';
import {
  type NewPriceObservation,
  type Product,
  type ProductSource,
  type SourceCandidate,
  collectorRuns,
  holdings,
  priceObservations,
  productSources,
  products,
  sourceCandidates,
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
      .values({ productId, ...link, active: true })
      .onConflictDoUpdate({
        target: [productSources.productId, productSources.source, productSources.externalId],
        set: { active: true, ...(link.title ? { title: link.title } : {}) },
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
    if (imageUrl) {
      await tx
        .update(products)
        .set({ imageUrl })
        .where(and(eq(products.id, productId), isNull(products.imageUrl)));
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
  await db.update(productSources).set({ active: false }).where(eq(productSources.id, sourceId));
}

/** Unlinked products the user holds that have matches waiting for confirmation, one holding each. */
export async function pendingMatchesForUser(db: Db, userId: string) {
  return db
    .select({ product: products, holdingId: sql<string>`min(${holdings.id})` })
    .from(products)
    .innerJoin(holdings, and(eq(holdings.productId, products.id), eq(holdings.userId, userId)))
    .where(
      and(
        exists(
          db
            .select({ one: sql`1` })
            .from(sourceCandidates)
            .where(
              and(
                eq(sourceCandidates.productId, products.id),
                eq(sourceCandidates.status, 'pending'),
              ),
            ),
        ),
        // Already linked: leftover suggestions (e.g. a no-shrink variant) are optional.
        not(
          exists(
            db
              .select({ one: sql`1` })
              .from(productSources)
              .where(
                and(eq(productSources.productId, products.id), eq(productSources.active, true)),
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

export async function recentObservations(db: Db, productId: string, limit = 20) {
  return db
    .select()
    .from(priceObservations)
    .where(eq(priceObservations.productId, productId))
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
    groups.set(key, [...(groups.get(key) ?? []), r]);
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
    .limit(filter.limit ?? 50);
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
  for (let i = 0; i < rows.length; i += 100) {
    const inserted = await db
      .insert(priceObservations)
      .values(rows.slice(i, i + 100))
      .onConflictDoNothing({ target: [priceObservations.source, priceObservations.externalRef] })
      .returning({ id: priceObservations.id });
    added += inserted.length;
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
  patch: { state?: unknown; success?: boolean; title?: string | null; url?: string | null },
): Promise<void> {
  await db
    .update(productSources)
    .set({
      ...(patch.state !== undefined ? { state: patch.state } : {}),
      ...(patch.success ? { lastSuccessAt: toTokyoIso() } : {}),
      ...(patch.title ? { title: patch.title } : {}),
      ...(patch.url ? { url: patch.url } : {}),
    })
    .where(eq(productSources.id, sourceId));
}

export async function startRun(db: Db, source: string): Promise<string> {
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
