// "Download my data" (requirements S6): an account's own data as one JSON file. Collected sale
// prices are left out (other sites' terms, eBay's among them, do not allow passing them on); each
// lot carries its current value instead. Sign-in secrets are never included.
import { appTimeZone, baseCurrency } from '@tora/core';
import { asc, eq, inArray } from 'drizzle-orm';
import type { Db } from './client';
import { loadSourceRegistry } from './registry';
import {
  cancelledOrders,
  holdingEvents,
  holdings,
  importRuns,
  manualPrices,
  productSources,
  products,
  purchaseLinks,
  users,
  watches,
} from './schema';
import { portfolioValuation } from './valuation';

export const ACCOUNT_DATA_FORMAT = 'tora-account';
export const ACCOUNT_DATA_VERSION = 1;

export async function accountData(db: Db, userId: string, now = new Date()) {
  const registry = await loadSourceRegistry(db);
  const [user] = await db
    .select({
      username: users.username,
      role: users.role,
      preferences: users.preferences,
      noticeLevels: users.noticeLevels,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, userId));
  const lots = await db
    .select()
    .from(holdings)
    .where(eq(holdings.userId, userId))
    .orderBy(asc(holdings.acquiredAt), asc(holdings.createdAt));
  const lotIds = lots.map((l) => l.id);
  const manual = await db.select().from(manualPrices).where(eq(manualPrices.userId, userId));
  const watched = await db.select().from(watches).where(eq(watches.userId, userId));
  const productIds = [
    ...new Set([
      ...lots.map((l) => l.productId),
      ...manual.map((m) => m.productId),
      ...watched.map((w) => w.productId),
    ]),
  ];
  const items = productIds.length
    ? await db
        .select()
        .from(products)
        .where(inArray(products.id, productIds))
        .orderBy(asc(products.name))
    : [];
  const history = lotIds.length
    ? await db
        .select()
        .from(holdingEvents)
        .where(inArray(holdingEvents.holdingId, lotIds))
        .orderBy(asc(holdingEvents.occurredAt))
    : [];
  // Which listings each item is linked to; their collected sales and progress stay out.
  const listings = productIds.length
    ? await db
        .select({
          id: productSources.id,
          productId: productSources.productId,
          source: productSources.source,
          externalId: productSources.externalId,
          title: productSources.title,
          url: productSources.url,
          active: productSources.active,
        })
        .from(productSources)
        .where(inArray(productSources.productId, productIds))
    : [];
  const values = new Map(
    (await portfolioValuation(db, userId, now)).rows.map((r) => [r.holding.id, r.valuation]),
  );
  return {
    format: ACCOUNT_DATA_FORMAT,
    version: ACCOUNT_DATA_VERSION,
    exportedAt: now.toISOString(),
    app: { baseCurrency: baseCurrency(registry), timeZone: appTimeZone() },
    account: user ?? null,
    items,
    lots: lots.map((l) => {
      const v = values.get(l.id);
      return {
        ...l,
        currentValueBase: v?.valueBase ?? null,
        valueMethod: v?.method ?? null,
      };
    }),
    history,
    manualPrices: manual,
    watches: watched,
    listings,
    importRuns: await db.select().from(importRuns).where(eq(importRuns.userId, userId)),
    purchaseLinks: await db.select().from(purchaseLinks).where(eq(purchaseLinks.userId, userId)),
    cancelledOrders: await db
      .select()
      .from(cancelledOrders)
      .where(eq(cancelledOrders.userId, userId)),
  };
}
