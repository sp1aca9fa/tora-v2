// Popular by the numbers Tora collects (requirements S27): each item's trades over the last 30
// days per site, the 90 days before, and the year. Worked out after each collect.
import { localDate, productClass, toLocalIso } from '@tora/core';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import type { Db } from './client';
import { readSetting, saveSetting } from './registry';
import { type Product, priceObservations, products } from './schema';

const DAY = 86_400_000;
const KEY = 'popularity';

export interface ItemTrades {
  productId: string;
  itemType: string;
  /** Trades in the last 30 days, per site. */
  sold30: Record<string, number>;
  /**
   * For trending, on the sites followed for 120 days or more (a site added since would look like
   * a jump): trades in the last 30 days, and in the 90 days before.
   */
  steady30: number;
  before90: number;
  /** Trades in the last 365 days. */
  sold365: number;
}

export interface SavedPopularity {
  day: string;
  items: ItemTrades[];
}

/** How an item type's items are ranked on Popular. */
export const POPULAR_BY = ['site', 'sold', 'trending', 'year'] as const;
export type PopularBy = (typeof POPULAR_BY)[number];

/**
 * Trending: 10+ trades in 30 days at 1.5x the monthly rate of the 90 days before or more, with
 * 10+ trades in those 90 days (an item followed only lately has too few to compare).
 */
export const TRENDING_MIN = 10;
export const TRENDING_RATIO = 1.5;

export const sold30Of = (i: ItemTrades) => Object.values(i.sold30).reduce((a, b) => a + b, 0);
/** The last 30 days against the monthly rate of the 90 before (sites followed 120+ days). */
export const trendOf = (i: ItemTrades) => i.steady30 / Math.max(1, i.before90 / 3);

export async function refreshPopularity(
  db: Db,
  now = new Date(),
  save = true,
): Promise<SavedPopularity> {
  const at = (days: number) => toLocalIso(new Date(now.getTime() - days * DAY));
  const [d30, d120] = [at(30), at(120)];
  const rows = await db
    .select({
      productId: priceObservations.productId,
      source: priceObservations.source,
      sold30: sql<number>`sum(case when ${priceObservations.observedAt} >= ${d30} then 1 else 0 end)`,
      before90: sql<number>`sum(case when ${priceObservations.observedAt} >= ${d120} and ${priceObservations.observedAt} < ${d30} then 1 else 0 end)`,
      sold365: sql<number>`count(*)`,
      first: sql<string>`min(${priceObservations.observedAt})`,
    })
    .from(priceObservations)
    .where(
      and(
        eq(priceObservations.observationType, 'sold'),
        eq(priceObservations.excluded, false),
        gte(priceObservations.observedAt, at(365)),
      ),
    )
    .groupBy(priceObservations.productId, priceObservations.source);
  const types = new Map(
    (
      await db
        .select({
          id: products.id,
          category: products.category,
          kind: products.kind,
          itemType: products.itemType,
        })
        .from(products)
    ).map((p) => [p.id, productClass(p)]),
  );
  const byItem = new Map<string, ItemTrades>();
  for (const r of rows) {
    const itemType = types.get(r.productId);
    if (!itemType) continue;
    let item = byItem.get(r.productId);
    if (!item) {
      byItem.set(
        r.productId,
        (item = {
          productId: r.productId,
          itemType,
          sold30: {},
          steady30: 0,
          before90: 0,
          sold365: 0,
        }),
      );
    }
    if (r.sold30) item.sold30[r.source] = Number(r.sold30);
    if (r.first < d120) {
      item.steady30 += Number(r.sold30);
      item.before90 += Number(r.before90);
    }
    item.sold365 += Number(r.sold365);
  }
  const saved = { day: localDate(now), items: [...byItem.values()] };
  if (save) await saveSetting(db, KEY, saved);
  return saved;
}

/** Items by id, for a page of ranked items. */
export async function productsByIds(db: Pick<Db, 'select'>, ids: string[]): Promise<Product[]> {
  return ids.length ? db.select().from(products).where(inArray(products.id, ids)) : [];
}

export const loadPopularity = (db: Pick<Db, 'select'>) => readSetting<SavedPopularity>(db, KEY);

/** A type's items ranked by trades over 30 days, trending, or the year (`site`: none here). */
export function rankPopular(saved: SavedPopularity, type: string, by: PopularBy): ItemTrades[] {
  const ofType = saved.items.filter((i) => i.itemType === type);
  if (by === 'sold') {
    return ofType.filter((i) => sold30Of(i) > 0).sort((a, b) => sold30Of(b) - sold30Of(a));
  }
  if (by === 'year') return ofType.sort((a, b) => b.sold365 - a.sold365);
  if (by === 'trending') {
    return ofType
      .filter(
        (i) =>
          i.steady30 >= TRENDING_MIN && i.before90 >= TRENDING_MIN && trendOf(i) >= TRENDING_RATIO,
      )
      .sort((a, b) => trendOf(b) - trendOf(a));
  }
  return [];
}
