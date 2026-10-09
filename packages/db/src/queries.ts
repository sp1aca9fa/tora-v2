import { asc, desc, eq } from 'drizzle-orm';
import type { Db } from './client';
import { collectorRuns, holdings, products } from './schema';

/** Holdings with their product, newest acquisition first. */
export async function listHoldingsWithProducts(db: Db) {
  return db
    .select({ holding: holdings, product: products })
    .from(holdings)
    .innerJoin(products, eq(holdings.productId, products.id))
    .orderBy(desc(holdings.acquiredAt), asc(holdings.id));
}

export async function listRecentCollectorRuns(db: Db, limit = 20) {
  return db.select().from(collectorRuns).orderBy(desc(collectorRuns.startedAt)).limit(limit);
}
