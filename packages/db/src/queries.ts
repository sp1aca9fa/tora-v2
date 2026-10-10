import type { Category, HoldingStatus, ProductKind, Region } from '@tora/core';
import {
  type SQL,
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
  sum,
} from 'drizzle-orm';
import { type AnySQLiteColumn, alias } from 'drizzle-orm/sqlite-core';
import type { Db } from './client';
import { collectorRuns, holdingEvents, holdings, products, tcgSets } from './schema';

/** Case-insensitive substring match, with LIKE wildcards in the user's text escaped. */
function contains(column: AnySQLiteColumn, text: string): SQL {
  const pattern = `%${text.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return sql`lower(${column}) LIKE ${pattern} ESCAPE '\\'`;
}

/** Every whitespace-separated term must appear in at least one of the columns. */
function matchesAll(q: string, columns: AnySQLiteColumn[]): SQL | undefined {
  const terms = q.normalize('NFKC').trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return undefined;
  return and(...terms.map((term) => or(...columns.map((c) => contains(c, term)))));
}

const PRODUCT_SEARCH_COLUMNS = [
  products.name,
  products.nameAlias,
  products.setName,
  products.setCode,
  products.cardNumber,
  products.platform,
];

export interface InventoryFilter {
  category?: Category;
  kind?: ProductKind;
  status?: HoldingStatus | 'all';
  q?: string;
}

/** A user's holdings with filters; includes the parent product name for pulls. */
export async function listInventory(db: Db, userId: string, filter: InventoryFilter = {}) {
  const parent = alias(holdings, 'parent');
  const parentProduct = alias(products, 'parent_product');
  const status = filter.status ?? 'owned';
  return db
    .select({
      holding: holdings,
      product: products,
      parentProduct: { name: parentProduct.name },
    })
    .from(holdings)
    .innerJoin(products, eq(holdings.productId, products.id))
    .leftJoin(parent, eq(parent.id, holdings.parentHoldingId))
    .leftJoin(parentProduct, eq(parentProduct.id, parent.productId))
    .where(
      and(
        eq(holdings.userId, userId),
        status === 'all' ? undefined : eq(holdings.status, status),
        filter.category ? eq(products.category, filter.category) : undefined,
        filter.kind ? eq(products.kind, filter.kind) : undefined,
        filter.q ? matchesAll(filter.q, PRODUCT_SEARCH_COLUMNS) : undefined,
      ),
    )
    .orderBy(desc(holdings.acquiredAt), desc(holdings.createdAt), asc(holdings.id));
}

/** Total paid for what the user still owns. Market value arrives with valuation (S5). */
export async function ownedTotals(db: Db, userId: string) {
  const [row] = await db
    .select({ spentJpy: sum(holdings.costTotalJpy), lots: count(), units: sum(holdings.quantity) })
    .from(holdings)
    .where(and(eq(holdings.userId, userId), eq(holdings.status, 'owned')));
  return {
    spentJpy: Number(row?.spentJpy ?? 0),
    lots: row?.lots ?? 0,
    units: Number(row?.units ?? 0),
  };
}

/** Everything the holding page shows: the lot, its product, history, parent and pulls. */
export async function getHoldingDetail(db: Db, userId: string, id: string) {
  const [row] = await db
    .select({ holding: holdings, product: products })
    .from(holdings)
    .innerJoin(products, eq(holdings.productId, products.id))
    .where(and(eq(holdings.id, id), eq(holdings.userId, userId)));
  if (!row) return null;

  const [events, children, parent] = await Promise.all([
    db
      .select()
      .from(holdingEvents)
      .where(eq(holdingEvents.holdingId, id))
      .orderBy(asc(holdingEvents.occurredAt), asc(holdingEvents.createdAt), asc(holdingEvents.id)),
    db
      .select({ holding: holdings, product: products })
      .from(holdings)
      .innerJoin(products, eq(holdings.productId, products.id))
      .where(and(eq(holdings.parentHoldingId, id), eq(holdings.userId, userId)))
      .orderBy(asc(holdings.createdAt), asc(holdings.id)),
    row.holding.parentHoldingId
      ? db
          .select({ holding: holdings, product: products })
          .from(holdings)
          .innerJoin(products, eq(holdings.productId, products.id))
          .where(and(eq(holdings.id, row.holding.parentHoldingId), eq(holdings.userId, userId)))
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
  ]);
  return { ...row, events, children, parent };
}

export async function getProduct(db: Db, id: string) {
  const [product] = await db.select().from(products).where(eq(products.id, id));
  return product ?? null;
}

export async function searchProducts(
  db: Db,
  q: string,
  options: { category?: Category; kinds?: ProductKind[]; limit?: number } = {},
) {
  const match = matchesAll(q, PRODUCT_SEARCH_COLUMNS);
  if (!match) return [];
  return db
    .select()
    .from(products)
    .where(
      and(
        match,
        options.category ? eq(products.category, options.category) : undefined,
        options.kinds?.length ? inArray(products.kind, options.kinds) : undefined,
      ),
    )
    .orderBy(desc(products.releaseDate), asc(products.name))
    .limit(options.limit ?? 20);
}

/**
 * Catalog sets of a franchise, newest first. Sets without a region (Magic) match every region.
 * Without a query, returns the most recent sets.
 */
export async function searchSets(
  db: Db,
  options: { franchise: string; region?: Region | null; q?: string; limit?: number },
) {
  return db
    .select()
    .from(tcgSets)
    .where(
      and(
        eq(tcgSets.franchise, options.franchise),
        options.region ? or(eq(tcgSets.region, options.region), isNull(tcgSets.region)) : undefined,
        options.q
          ? matchesAll(options.q, [tcgSets.name, tcgSets.nameAlias, tcgSets.code])
          : undefined,
      ),
    )
    .orderBy(sql`${tcgSets.releaseDate} IS NULL`, desc(tcgSets.releaseDate), asc(tcgSets.name))
    .limit(options.limit ?? 30);
}

export async function getSet(db: Db, id: string) {
  const [set] = await db.select().from(tcgSets).where(eq(tcgSets.id, id));
  return set ?? null;
}

/** Sets available per franchise and region, for the add flow. */
export async function catalogCounts(db: Db) {
  return db
    .select({ franchise: tcgSets.franchise, region: tcgSets.region, n: count() })
    .from(tcgSets)
    .groupBy(tcgSets.franchise, tcgSets.region);
}

/** The user's previously used "acquired from" values, most frequent first. */
export async function acquiredFromSuggestions(db: Db, userId: string, limit = 30) {
  const rows = await db
    .select({ value: holdings.acquiredFrom, n: count() })
    .from(holdings)
    .where(and(eq(holdings.userId, userId), isNotNull(holdings.acquiredFrom)))
    .groupBy(holdings.acquiredFrom)
    .orderBy(desc(count()))
    .limit(limit);
  return rows.map((r) => r.value).filter((v): v is string => Boolean(v));
}

/** Distinct values used so far for a product text column (franchise, platform). */
export async function productValueSuggestions(
  db: Db,
  column: 'franchise' | 'platform',
  category: Category,
  limit = 30,
) {
  const col = products[column];
  const rows = await db
    .select({ value: col, n: count() })
    .from(products)
    .where(and(eq(products.category, category), isNotNull(col)))
    .groupBy(col)
    .orderBy(desc(count()))
    .limit(limit);
  return rows.map((r) => r.value).filter((v): v is string => Boolean(v));
}

export async function listRecentCollectorRuns(db: Db, limit = 20) {
  return db.select().from(collectorRuns).orderBy(desc(collectorRuns.startedAt)).limit(limit);
}

/** The user's owned cards, ungraded first (for setting grades in bulk). */
export async function ownedCards(db: Db, userId: string) {
  return db
    .select({ holding: holdings, product: products })
    .from(holdings)
    .innerJoin(products, eq(products.id, holdings.productId))
    .where(
      and(
        eq(holdings.userId, userId),
        eq(holdings.status, 'owned'),
        eq(products.category, 'tcg'),
        eq(products.kind, 'single'),
      ),
    )
    .orderBy(sql`${holdings.grading} is not null`, products.name, holdings.acquiredAt);
}

/** Owned card lots, and how many have no grade (not valued until they do). */
export async function cardGradeCounts(db: Db, userId: string) {
  const [row] = await db
    .select({
      cards: count(),
      ungraded: sql<number>`coalesce(sum(case when ${holdings.grading} is null or (${holdings.grading} = 'raw' and ${holdings.rawGrade} is null) then 1 else 0 end), 0)`,
    })
    .from(holdings)
    .innerJoin(products, eq(products.id, holdings.productId))
    .where(
      and(
        eq(holdings.userId, userId),
        eq(holdings.status, 'owned'),
        eq(products.category, 'tcg'),
        eq(products.kind, 'single'),
      ),
    );
  return { cards: row?.cards ?? 0, ungraded: Number(row?.ungraded ?? 0) };
}
