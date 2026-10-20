// Opportunities (requirements S13 part 1): after each collect, the signals of every item (any
// person's, owned, watched or not) on the condition with the most days of sales, and each
// signal's test on its group's whole history, saved in one setting that pages and the MCP read.
import {
  type OpportunityMember,
  type OpportunityNumbers,
  type OpportunitySignal,
  type OpportunityTests,
  ASK_FLOOR,
  ASK_UNDER,
  BUYLIST_NEAR,
  OpportunityGroup,
  localDate,
  productClass,
  rankOpportunity,
  signalsOn,
  toLocalIso,
} from '@tora/core';
import { and, eq, gte, inArray } from 'drizzle-orm';
import type { Db } from './client';
import { refreshItemSales } from './item-sales';
import { readSetting, saveSetting } from './registry';
import { productLines, releaseDates, similarKey } from './release';
import { type Product, holdings, priceObservations, products, watches } from './schema';
import { dailySeries, pickSeries } from './signals';
import { currentSupply, lowestAsk } from './supply';

const DAY = 86_400_000;
/** Shop buy prices (買取) older than this are not shown. */
const BUYLIST_DAYS = 30;

/** An item's signals today. Prices per unit in the base currency. */
export interface OpportunityItem {
  productId: string;
  /** The condition studied ('' for none) and the source of its prices. */
  bucket: string;
  source: string;
  /** Its group of similar items (S9) and its item type (the page's tabs). */
  group: string;
  itemType: string;
  numbers: OpportunityNumbers;
  on: OpportunitySignal[];
  /**
   * Facts, not tested: the lowest ask now in this condition on the price source, the latest shop
   * buy price.
   */
  ask: { price: number; source: string; url: string | null } | null;
  buylist: { price: number; source: string; day: string } | null;
}

export interface SavedOpportunities {
  day: string;
  tests: Record<string, OpportunityTests>;
  items: OpportunityItem[];
}

const KEY = 'opportunities';

/**
 * Works out every item's signals today and every group's tests, and saves them (`save` false:
 * only returns them, for checks on real data).
 */
export async function refreshOpportunities(
  db: Db,
  now = new Date(),
  save = true,
): Promise<SavedOpportunities> {
  // The daily prices come from the packed item sales: any days still marked are updated first.
  await refreshItemSales(db, { marksOnly: true });
  const today = localDate(now);
  const all = await db.select().from(products);
  const [series, lines, released] = await Promise.all([
    dailySeries(
      db,
      all.map((p) => p.id),
    ),
    productLines(db, all),
    releaseDates(db, all),
  ]);

  // Each item on its longest series (any source and condition), grouped with similar items.
  const groups = new Map<string, { id: string; bucket: string | null; source: string }[]>();
  const memberOf = new Map<string, OpportunityMember>();
  for (const p of all) {
    const key = similarKey(p);
    if (!key) continue;
    let best: { bucket: string | null; source: string; length: number } | null = null;
    for (const [k, s] of series) {
      if (!k.startsWith(`${p.id}|`)) continue;
      const [source, bucket] = k.slice(p.id.length + 1).split('|');
      if (!best || s.length > best.length) {
        best = { bucket: bucket || null, source: source!, length: s.length };
      }
    }
    if (!best) continue;
    const picked = pickSeries(series, p.id, best.bucket, best.source)!;
    const r = released.get(p.id);
    memberOf.set(p.id, {
      id: p.id,
      line: lines.get(p.id) ?? null,
      // A first collected sale is not a release date.
      release: r && r.from !== 'first_sale' ? r.date : null,
      series: picked.series,
    });
    groups.set(key, [
      ...(groups.get(key) ?? []),
      { id: p.id, bucket: best.bucket, source: best.source },
    ]);
  }

  const ids = [...memberOf.keys()];
  const [supply, buylist] = await Promise.all([
    currentSupply(db, ids, now),
    latestBuylist(db, now),
  ]);
  const byId = new Map(all.map((p) => [p.id, p]));
  const tests: SavedOpportunities['tests'] = {};
  const items: OpportunityItem[] = [];
  for (const [key, list] of groups) {
    const group = new OpportunityGroup(list.map((m) => memberOf.get(m.id)!));
    tests[key] = group.tests(today);
    for (const m of list) {
      const numbers = group.numbers(m.id, today);
      if (!numbers?.price) continue;
      const bucket = m.bucket ?? '';
      // Like for like: another site's cheapest listing is too often something else (no shrink,
      // one pack), so the ask is the price source's own.
      const ask = lowestAsk(
        (supply.get(m.id) ?? []).filter((s) => s.source === m.source),
        bucket,
      );
      const shop = buylist.get(m.id)?.find((b) => b.bucket === bucket || b.bucket === null);
      items.push({
        productId: m.id,
        bucket,
        source: m.source,
        group: key,
        itemType: productClass(byId.get(m.id)!),
        numbers,
        on: signalsOn(numbers),
        ask: ask?.lowestAskBase
          ? { price: ask.lowestAskBase, source: ask.source, url: ask.url }
          : null,
        buylist: shop ? { price: shop.price, source: shop.source, day: shop.day } : null,
      });
    }
  }
  const saved: SavedOpportunities = { day: today, tests, items };
  if (save) await saveSetting(db, KEY, saved);
  return saved;
}

/** Each item's latest shop buy prices (買取) of the last 30 days, newest first. */
async function latestBuylist(db: Db, now: Date) {
  const out = new Map<
    string,
    { bucket: string | null; price: number; source: string; day: string }[]
  >();
  const rows = await db
    .select({
      productId: priceObservations.productId,
      bucket: priceObservations.bucket,
      price: priceObservations.priceBase,
      source: priceObservations.source,
      at: priceObservations.observedAt,
    })
    .from(priceObservations)
    .where(
      and(
        eq(priceObservations.observationType, 'buylist'),
        eq(priceObservations.excluded, false),
        gte(priceObservations.observedAt, toLocalIso(new Date(now.getTime() - BUYLIST_DAYS * DAY))),
      ),
    );
  rows.sort((a, b) => b.at.localeCompare(a.at));
  for (const r of rows) {
    const list = out.get(r.productId) ?? [];
    list.push({ bucket: r.bucket, price: r.price, source: r.source, day: r.at.slice(0, 10) });
    out.set(r.productId, list);
  }
  return out;
}

/** An item's opportunity: its signals today ranked by its group's tests, and the facts. */
export interface Opportunity extends OpportunityItem {
  proven: OpportunitySignal[];
  warnings: OpportunitySignal[];
  unproven: OpportunitySignal[];
  score: number;
  tests: OpportunityTests | null;
  /**
   * The lowest ask is 15 % to 50 % under the recent price (more is likely something else); a shop
   * buys at 80 % of it or more.
   */
  askUnder: boolean;
  buylistNear: boolean;
}

/**
 * The saved opportunities (null before the first collect works them out), best first: items
 * with proven signals by score, then the rest by score.
 */
export async function loadOpportunities(
  db: Pick<Db, 'select'>,
): Promise<{ day: string; items: Opportunity[] } | null> {
  const saved = await readSetting<SavedOpportunities>(db, KEY);
  if (!saved) return null;
  const items = saved.items.map((item): Opportunity => {
    const tests = saved.tests[item.group] ?? null;
    const price = item.numbers.price;
    return {
      ...item,
      ...rankOpportunity(item.on, tests ?? undefined),
      tests,
      askUnder:
        !!item.ask &&
        !!price &&
        item.ask.price <= price * ASK_UNDER &&
        item.ask.price >= price * ASK_FLOOR,
      buylistNear: !!item.buylist && !!price && item.buylist.price >= price * BUYLIST_NEAR,
    };
  });
  items.sort(
    (a, b) =>
      Number(b.proven.length > 0) - Number(a.proven.length > 0) ||
      b.score - a.score ||
      a.productId.localeCompare(b.productId),
  );
  return { day: saved.day, items };
}

/** The Opportunities page: the saved opportunities with each item and whether the person owns or watches it. */
export async function opportunitiesFor(
  db: Db,
  userId: string,
): Promise<{
  day: string;
  items: (Opportunity & { product: Product; owned: boolean; watching: boolean })[];
} | null> {
  const saved = await loadOpportunities(db);
  if (!saved) return null;
  const ids = saved.items.map((o) => o.productId);
  const byId = new Map<string, Product>();
  for (let i = 0; i < ids.length; i += 500) {
    for (const p of await db
      .select()
      .from(products)
      .where(inArray(products.id, ids.slice(i, i + 500)))) {
      byId.set(p.id, p);
    }
  }
  const [owned, watched] = await Promise.all([
    db
      .selectDistinct({ id: holdings.productId })
      .from(holdings)
      .where(and(eq(holdings.userId, userId), eq(holdings.status, 'owned'))),
    db.selectDistinct({ id: watches.productId }).from(watches).where(eq(watches.userId, userId)),
  ]);
  const own = new Set(owned.map((r) => r.id));
  const watching = new Set(watched.map((r) => r.id));
  return {
    day: saved.day,
    items: saved.items.flatMap((o) => {
      const product = byId.get(o.productId);
      return product
        ? [{ ...o, product, owned: own.has(o.productId), watching: watching.has(o.productId) }]
        : [];
    }),
  };
}
