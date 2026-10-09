import type { HoldingStatus, ProductType } from '@tora/core';
import { type SQL, and, asc, count, desc, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';
import { type AnySQLiteColumn, alias } from 'drizzle-orm/sqlite-core';
import type { Db } from './client';
import { collectorRuns, holdingEvents, holdings, products } from './schema';

/** Case-insensitive substring match, with LIKE wildcards in the user's text escaped. */
function contains(column: AnySQLiteColumn, text: string): SQL {
  const pattern = `%${text.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return sql`lower(${column}) LIKE ${pattern} ESCAPE '\\'`;
}

function productMatches(q: string): SQL | undefined {
  const terms = q.trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return undefined;
  // Every term must appear in at least one of the name / set fields.
  return and(
    ...terms.map((term) =>
      or(
        contains(products.nameEn, term),
        contains(products.nameJa, term),
        contains(products.setName, term),
        contains(products.setCode, term),
        contains(products.cardNumber, term),
      ),
    ),
  );
}

/** Holdings with their product, newest acquisition first. */
export async function listHoldingsWithProducts(db: Db) {
  return db
    .select({ holding: holdings, product: products })
    .from(holdings)
    .innerJoin(products, eq(holdings.productId, products.id))
    .orderBy(desc(holdings.acquiredAt), asc(holdings.id));
}

export interface InventoryFilter {
  type?: ProductType;
  status?: HoldingStatus | 'all';
  q?: string;
}

/** Inventory list with filters; includes the parent product name for pulls. */
export async function listInventory(db: Db, filter: InventoryFilter = {}) {
  const parent = alias(holdings, 'parent');
  const parentProduct = alias(products, 'parent_product');
  const status = filter.status ?? 'owned';
  return db
    .select({
      holding: holdings,
      product: products,
      parentProduct: { nameJa: parentProduct.nameJa, nameEn: parentProduct.nameEn },
    })
    .from(holdings)
    .innerJoin(products, eq(holdings.productId, products.id))
    .leftJoin(parent, eq(parent.id, holdings.parentHoldingId))
    .leftJoin(parentProduct, eq(parentProduct.id, parent.productId))
    .where(
      and(
        status === 'all' ? undefined : eq(holdings.status, status),
        filter.type ? eq(products.type, filter.type) : undefined,
        filter.q ? productMatches(filter.q) : undefined,
      ),
    )
    .orderBy(desc(holdings.acquiredAt), desc(holdings.createdAt), asc(holdings.id));
}

/** Everything the holding page shows: the lot, its product, history, parent and pulls. */
export async function getHoldingDetail(db: Db, id: string) {
  const [row] = await db
    .select({ holding: holdings, product: products })
    .from(holdings)
    .innerJoin(products, eq(holdings.productId, products.id))
    .where(eq(holdings.id, id));
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
      .where(eq(holdings.parentHoldingId, id))
      .orderBy(asc(holdings.createdAt), asc(holdings.id)),
    row.holding.parentHoldingId
      ? db
          .select({ holding: holdings, product: products })
          .from(holdings)
          .innerJoin(products, eq(holdings.productId, products.id))
          .where(eq(holdings.id, row.holding.parentHoldingId))
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
  options: { types?: ProductType[]; limit?: number } = {},
) {
  const match = productMatches(q);
  if (!match) return [];
  return db
    .select()
    .from(products)
    .where(and(match, options.types?.length ? inArray(products.type, options.types) : undefined))
    .orderBy(asc(products.nameEn), asc(products.nameJa))
    .limit(options.limit ?? 20);
}

/** Previously used "acquired from" values, most frequent first. */
export async function acquiredFromSuggestions(db: Db, limit = 30): Promise<string[]> {
  const rows = await db
    .select({ value: holdings.acquiredFrom, n: count() })
    .from(holdings)
    .where(isNotNull(holdings.acquiredFrom))
    .groupBy(holdings.acquiredFrom)
    .orderBy(desc(count()))
    .limit(limit);
  return rows.map((r) => r.value).filter((v): v is string => Boolean(v));
}

export async function listRecentCollectorRuns(db: Db, limit = 20) {
  return db.select().from(collectorRuns).orderBy(desc(collectorRuns.startedAt)).limit(limit);
}
