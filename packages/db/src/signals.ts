// Buy timing (requirements S9 part 4): the numbers saved daily per item and condition held or
// watched (after the collect), the set line suggestions, the rule tests (part 5), and what pages
// read.
import {
  type DayPrice,
  type RuleTestResult,
  type SignalStats,
  type StrategyChoice,
  DEFAULT_MARGIN,
  PATTERN_MIN_ITEMS,
  RULE_TEST_MIN_SIGNALS,
  byLine,
  earlyChange,
  localDate,
  marketCurrency,
  marketTrend,
  median,
  newSetPattern,
  productClass,
  rankOpportunity,
  ruleTests,
  seriesStats,
  strategyKey,
  toLocalIso,
  typicalLowAge,
} from '@tora/core';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { Db } from './client';
import { refreshItemSales, soldDays } from './item-sales';
import { loadSourceRegistry, readSetting, saveSetting } from './registry';
import type { SavedOpportunities } from './opportunities';
import { rankedProductIds } from './rankings';
import { productLines, releaseDates, similarKey } from './release';
import { type Product, holdings, products, signals, users, watches } from './schema';
import { fileSuggestion } from './suggestions';
import { currentSupply, lowestAsk } from './supply';
import { holdingBucket, savedBucketValues } from './valuation';

const DAY = 86_400_000;
/** Daily prices loaded for a day's numbers: a year, plus the 90 days the replay looks ahead. */
const SERIES_DAYS = 365 + 90;

const seriesKey = (productId: string, source: string, bucket: string | null) =>
  `${productId}|${source}|${bucket ?? ''}`;

/**
 * Daily medians of kept sales in the primary market's currency, per product, source and bucket
 * (`seriesKey`), oldest first; from `since` (ISO, whole days) or all. Read from the packed item
 * sales.
 */
export async function dailySeries(
  db: Db,
  productIds: string[],
  since?: string,
): Promise<Map<string, DayPrice[]>> {
  const out = new Map<string, DayPrice[]>();
  if (productIds.length === 0) return out;
  const currency = marketCurrency(await loadSourceRegistry(db));
  const days = new Map<string, { key: string; day: string; prices: number[] }>();
  for (const r of await soldDays(db, productIds, { since: since?.slice(0, 10), currency })) {
    const key = seriesKey(r.productId, r.source, r.bucket);
    const d = days.get(`${key}|${r.day}`);
    if (d) d.prices.push(...r.prices);
    else days.set(`${key}|${r.day}`, { key, day: r.day, prices: [...r.prices] });
  }
  for (const { key, day, prices } of days.values()) {
    prices.sort((a, b) => a - b);
    const mid = Math.floor(prices.length / 2);
    const price = prices.length % 2 ? prices[mid]! : (prices[mid - 1]! + prices[mid]!) / 2;
    const list = out.get(key) ?? [];
    list.push({ day, price, count: prices.length });
    out.set(key, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.day.localeCompare(b.day));
  return out;
}

/** The series of a product + bucket: the given source's, else the one with the most days. */
export function pickSeries(
  all: Map<string, DayPrice[]>,
  productId: string,
  bucket: string | null,
  source?: string | null,
): { source: string; series: DayPrice[] } | null {
  if (source) {
    const own = all.get(seriesKey(productId, source, bucket));
    if (own?.length) return { source, series: own };
  }
  let best: { source: string; series: DayPrice[] } | null = null;
  const prefix = `${productId}|`;
  const suffix = `|${bucket ?? ''}`;
  for (const [key, series] of all) {
    if (!key.startsWith(prefix) || !key.endsWith(suffix)) continue;
    const s = key.slice(prefix.length, key.length - suffix.length);
    if (s.includes('|')) continue;
    if (!best || series.length > best.series.length) best = { source: s, series };
  }
  return best;
}

/** Every item and condition held (owned) or watched by anyone. */
async function valuedPairs(db: Db): Promise<{ product: Product; bucket: string | null }[]> {
  const wanted = new Map<string, { product: Product; bucket: string | null }>();
  for (const { holding, product } of await db
    .select({ holding: holdings, product: products })
    .from(holdings)
    .innerJoin(products, eq(products.id, holdings.productId))
    .where(eq(holdings.status, 'owned'))) {
    const bucket = holdingBucket(holding, product);
    wanted.set(`${product.id}|${bucket ?? ''}`, { product, bucket });
  }
  for (const { watch, product } of await db
    .select({ watch: watches, product: products })
    .from(watches)
    .innerJoin(products, eq(products.id, watches.productId))) {
    wanted.set(`${product.id}|${watch.bucket}`, { product, bucket: watch.bucket || null });
  }
  return [...wanted.values()];
}

/**
 * Items and conditions worth buy timing numbers besides those held or watched (S13): the ones
 * with a proven opportunity signal (last saved opportunities), ranked candidates, and the ones in
 * someone's budget plan.
 */
async function plannedPairs(
  db: Db,
  had: { product: Product; bucket: string | null }[],
): Promise<{ product: Product; bucket: string | null }[]> {
  const known = new Set(had.map((p) => `${p.product.id}|${p.bucket ?? ''}`));
  const wanted = new Map<string, { productId: string; bucket: string }>();
  const add = (productId: string, bucket: string) => {
    const key = `${productId}|${bucket}`;
    if (!known.has(key)) wanted.set(key, { productId, bucket });
  };
  const saved = await readSetting<SavedOpportunities>(db, 'opportunities');
  const ranked = new Set(await rankedProductIds(db));
  for (const o of saved?.items ?? []) {
    const proven = rankOpportunity(o.on, saved!.tests[o.group]).proven.length > 0;
    if (proven || ranked.has(o.productId)) add(o.productId, o.bucket);
  }
  for (const u of await db.select({ preferences: users.preferences }).from(users)) {
    for (const i of u.preferences?.buyPlan?.items ?? []) add(i.productId, i.bucket);
  }
  const ids = [...new Set([...wanted.values()].map((w) => w.productId))];
  const byId = new Map<string, Product>();
  for (let i = 0; i < ids.length; i += 500) {
    for (const p of await db
      .select()
      .from(products)
      .where(inArray(products.id, ids.slice(i, i + 500)))) {
      byId.set(p.id, p);
    }
  }
  return [...wanted.values()].flatMap((w) => {
    const product = byId.get(w.productId);
    return product ? [{ product, bucket: w.bucket || null }] : [];
  });
}

/**
 * Today's numbers for every item and condition held or watched, saved (one row per day; a second
 * collect the same day replaces it). Then set lines are suggested for items unlike their group.
 */
export async function refreshSignals(
  db: Db,
  now = new Date(),
  /** False: work everything out without saving (checks on real data). */
  save = true,
): Promise<{
  saved: number;
  withPattern: number;
  /** Set lines suggested on Actions. */
  lineSuggestions: number;
  rows: { productId: string; bucket: string; source: string | null; stats: SignalStats }[];
}> {
  const held = await valuedPairs(db);
  // Also the items an opportunity, a ranking or a budget plan brings (S13).
  const pairs = [...held, ...(await plannedPairs(db, held))];
  if (pairs.length === 0) return { saved: 0, withPattern: 0, lineSuggestions: 0, rows: [] };
  // The daily prices come from the packed item sales: any days still marked are updated first.
  await refreshItemSales(db, { marksOnly: true });
  const today = localDate(now);
  const productIds = [...new Set(pairs.map((p) => p.product.id))];
  const since = toLocalIso(new Date(now.getTime() - SERIES_DAYS * DAY));
  const [values, series, supply, released] = await Promise.all([
    savedBucketValues(db, pairs, now),
    dailySeries(db, productIds, since),
    currentSupply(db, productIds, now),
    releaseDates(
      db,
      pairs.map((p) => p.product),
    ),
  ]);

  // Group studies use the item's set line when it has enough items, else the whole group.
  const allProducts = await db.select().from(products);
  const lines = await productLines(db, allProducts);

  // The new-set pattern and the new-release wait per group and bucket, for items in their first
  // year: every similar item's whole history (any person's), loaded once per group.
  type Member = { id: string; release: string; series: DayPrice[]; line: string | null };
  const groups = new Map<string, Member[]>();
  const lowAges = new Map<string, SignalStats['lowAge']>();
  // A first collected sale is not a release date (collecting may start years later): the
  // pattern needs the set's date or the item's own, for the item and the items it is compared to.
  const known = (r: { from: string } | undefined) => !!r && r.from !== 'first_sale';
  const young = pairs.filter((p) => {
    const r = released.get(p.product.id);
    return known(r) && (now.getTime() - Date.parse(`${r!.date}T00:00:00Z`)) / DAY <= 365;
  });
  if (young.length) {
    const keys = new Set(young.map((p) => similarKey(p.product)).filter((k) => k !== null));
    const all = allProducts.filter((p) => keys.has(similarKey(p) ?? ''));
    const [history, dates] = await Promise.all([
      dailySeries(
        db,
        all.map((p) => p.id),
      ),
      releaseDates(db, all),
    ]);
    for (const p of young) {
      const key = similarKey(p.product);
      const groupKey = `${key}|${p.bucket ?? ''}`;
      if (!key || groups.has(groupKey)) continue;
      groups.set(
        groupKey,
        all.flatMap((o) => {
          const r = dates.get(o.id);
          const s = pickSeries(history, o.id, p.bucket);
          return r && known(r) && s
            ? [{ id: o.id, release: r.date, series: s.series, line: lines.get(o.id) ?? null }]
            : [];
        }),
      );
    }
  }

  // The market per group of similar items: every item's 12-week trend (any person's items), on
  // the condition with the most days of sales.
  const markets = new Map<string, SignalStats['market']>();
  {
    const keys = new Set(pairs.map((p) => similarKey(p.product)).filter((k) => k !== null));
    const members = allProducts.filter((p) => keys.has(similarKey(p) ?? ''));
    const recent = await dailySeries(
      db,
      members.map((p) => p.id),
      toLocalIso(new Date(now.getTime() - 100 * DAY)),
    );
    const longest = new Map<string, DayPrice[]>();
    for (const [key, s] of recent) {
      const id = key.slice(0, key.indexOf('|'));
      if (s.length > (longest.get(id)?.length ?? 0)) longest.set(id, s);
    }
    for (const { product } of pairs) {
      const key = similarKey(product);
      const line = lines.get(product.id) ?? null;
      if (!key || markets.has(`${key}|${line ?? ''}`)) continue;
      const group = members
        .filter((p) => similarKey(p) === key)
        .map((p) => ({ line: lines.get(p.id) ?? null, series: longest.get(p.id) ?? [] }));
      markets.set(
        `${key}|${line ?? ''}`,
        byLine(line, group, (g) =>
          marketTrend(
            g.map((m) => m.series),
            today,
          ),
        ),
      );
    }
  }

  const rows: { productId: string; bucket: string; source: string | null; stats: SignalStats }[] =
    [];
  let withPattern = 0;
  for (const { product, bucket } of pairs) {
    const value = values.get(`${product.id}|${bucket ?? ''}`);
    const valued = value?.valuation.source;
    const picked = pickSeries(
      series,
      product.id,
      bucket,
      valued && valued !== 'manual' ? valued : null,
    );
    const r = released.get(product.id);
    const ageDays = r
      ? Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${r.date}T00:00:00Z`)) / DAY)
      : null;
    const line = lines.get(product.id) ?? null;
    const groupKey = `${similarKey(product)}|${bucket ?? ''}`;
    const others = (groups.get(groupKey) ?? []).filter((o) => o.id !== product.id);
    const firstYear = ageDays !== null && ageDays <= 365 && known(r);
    const pattern = firstYear
      ? byLine(line, others, (o) => newSetPattern(ageDays!, o, today))
      : null;
    // An item in its first year never has a full first year itself: one study per group and line.
    let lowAge: SignalStats['lowAge'] = null;
    if (firstYear) {
      const lowKey = `${groupKey}|${line ?? ''}`;
      if (!lowAges.has(lowKey)) {
        lowAges.set(
          lowKey,
          byLine(line, others, (o) => typicalLowAge(o, today)),
        );
      }
      lowAge = lowAges.get(lowKey) ?? null;
    }
    if (pattern) withPattern++;
    // Like for like (as Opportunities): the price source's own ask; another site's cheapest
    // listing is too often something else (Mercari asks at a third of the sales price).
    const ask = lowestAsk(
      (supply.get(product.id) ?? []).filter((x) => !picked || x.source === picked.source),
      bucket ?? '',
    );
    rows.push({
      productId: product.id,
      bucket: bucket ?? '',
      source: picked?.source ?? null,
      stats: {
        ...seriesStats(picked?.series ?? [], today, value?.valuation.unitBase ?? null),
        ask: ask?.lowestAskBase ?? null,
        ageDays,
        releaseFrom: r?.from ?? null,
        line,
        market: markets.get(`${similarKey(product)}|${line ?? ''}`) ?? null,
        pattern,
        lowAge,
      },
    });
  }
  if (!save) return { saved: 0, withPattern, lineSuggestions: 0, rows };
  const at = toLocalIso(now);
  for (let i = 0; i < rows.length; i += 100) {
    await db
      .insert(signals)
      .values(
        rows.slice(i, i + 100).map((r) => ({ ...r, day: today, createdAt: at, updatedAt: at })),
      )
      .onConflictDoUpdate({
        target: [signals.productId, signals.bucket, signals.day],
        set: { source: sql`excluded.source`, stats: sql`excluded.stats`, updatedAt: at },
      });
  }
  const lineSuggestions = await suggestLines(db, allProducts, lines);
  return { saved: rows.length, withPattern, lineSuggestions, rows };
}

/** An item's first months unlike its group's by this much, and like a line's within this. */
const UNLIKE_GROUP = 0.2;
const LIKE_LINE = 0.1;

/**
 * Suggests a set line for items without one whose prices behave unlike their group: their change
 * over the first months after release (day 7 to 97) is 20 points or more from the group's typical
 * one and within 10 points of a line's (3+ items). Filed on Actions to the person who made the
 * item, else the admins.
 */
export async function suggestLines(
  db: Db,
  all: Product[],
  lines: Map<string, string | null>,
): Promise<number> {
  const tcg = all.filter((p) => p.category === 'tcg' && similarKey(p));
  if (!tcg.some((p) => !lines.get(p.id))) return 0;
  const dates = await releaseDates(db, tcg);
  const known = tcg.filter((p) => {
    const r = dates.get(p.id);
    return r && r.from !== 'first_sale';
  });
  if (!known.some((p) => !lines.get(p.id))) return 0;
  // Each item on its condition with the most days of sales.
  const longest = new Map<string, DayPrice[]>();
  for (const [key, s] of await dailySeries(
    db,
    known.map((p) => p.id),
  )) {
    const id = key.slice(0, key.indexOf('|'));
    if (s.length > (longest.get(id)?.length ?? 0)) longest.set(id, s);
  }
  const byGroup = new Map<string, { product: Product; line: string | null; change: number }[]>();
  for (const p of known) {
    const change = earlyChange(dates.get(p.id)!.date, longest.get(p.id) ?? []);
    if (change === null) continue;
    const key = similarKey(p)!;
    byGroup.set(key, [
      ...(byGroup.get(key) ?? []),
      { product: p, line: lines.get(p.id) ?? null, change },
    ]);
  }
  let admins: string[] | null = null;
  let filed = 0;
  for (const items of byGroup.values()) {
    for (const it of items) {
      if (it.line) continue;
      const rest = items.filter((o) => o !== it);
      if (rest.length < PATTERN_MIN_ITEMS) continue;
      const typical = median(rest.map((o) => o.change))!;
      if (Math.abs(it.change - typical) < UNLIKE_GROUP) continue;
      const byLineChanges = new Map<string, number[]>();
      for (const o of rest) {
        if (o.line) byLineChanges.set(o.line, [...(byLineChanges.get(o.line) ?? []), o.change]);
      }
      let best: { line: string; change: number; items: number } | null = null;
      for (const [line, changes] of byLineChanges) {
        if (changes.length < PATTERN_MIN_ITEMS) continue;
        const change = median(changes)!;
        if (!best || Math.abs(it.change - change) < Math.abs(it.change - best.change)) {
          best = { line, change, items: changes.length };
        }
      }
      if (!best || Math.abs(it.change - best.change) > LIKE_LINE) continue;
      admins ??= (await db.select({ id: users.id }).from(users).where(eq(users.role, 'admin'))).map(
        (u) => u.id,
      );
      for (const userId of it.product.createdBy ? [it.product.createdBy] : admins) {
        const done = await fileSuggestion(db, {
          userId,
          kind: 'set_line',
          targetKey: it.product.id,
          productId: it.product.id,
          payload: { line: best.line },
          reason: 'line',
          evidence: {
            change: it.change,
            group: { items: rest.length, change: typical },
            line: { items: best.items, change: best.change },
          },
        });
        if (done) filed++;
      }
    }
  }
  return filed;
}

/** Days after which an item's last numbers no longer count as today's. */
export const SIGNAL_FRESH_DAYS = 3;

/** The latest numbers (within 3 days) of item + condition pairs, by `product|bucket`. */
export async function latestSignals(
  db: Db,
  wanted: { productId: string; bucket: string | null }[],
  now = new Date(),
): Promise<Map<string, (typeof signals)['$inferSelect']>> {
  const out = new Map<string, (typeof signals)['$inferSelect']>();
  const ids = [...new Set(wanted.map((w) => w.productId))];
  if (ids.length === 0) return out;
  const from = localDate(new Date(now.getTime() - SIGNAL_FRESH_DAYS * DAY));
  const keys = new Set(wanted.map((w) => `${w.productId}|${w.bucket ?? ''}`));
  for (let i = 0; i < ids.length; i += 200) {
    const rows = await db
      .select()
      .from(signals)
      .where(and(inArray(signals.productId, ids.slice(i, i + 200)), gte(signals.day, from)))
      .orderBy(desc(signals.day));
    for (const r of rows) {
      const key = `${r.productId}|${r.bucket}`;
      if (keys.has(key) && !out.has(key)) out.set(key, r);
    }
  }
  return out;
}

/**
 * The condition with the most sales in an item's latest numbers (within 3 days): the main one of
 * an item the person neither holds nor watches. Null when none (or the item has no conditions).
 */
export async function busiestBucket(
  db: Db,
  productId: string,
  now = new Date(),
): Promise<string | null> {
  const from = localDate(new Date(now.getTime() - SIGNAL_FRESH_DAYS * DAY));
  const [row] = await db
    .select({ bucket: signals.bucket })
    .from(signals)
    .where(and(eq(signals.productId, productId), gte(signals.day, from)))
    .orderBy(desc(signals.day), desc(sql`json_extract(${signals.stats}, '$.sales30')`))
    .limit(1);
  return row?.bucket || null;
}

/** The item types a person owns (for their strategy choices). */
export async function heldItemTypes(db: Db, userId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({
      category: products.category,
      kind: products.kind,
      itemType: products.itemType,
    })
    .from(holdings)
    .innerJoin(products, eq(products.id, holdings.productId))
    .where(and(eq(holdings.userId, userId), eq(holdings.status, 'owned')));
  return [...new Set(rows.map((r) => productClass(r)))];
}

/** Saved rule tests: per group of similar items and condition (and line), per strategy. */
interface SavedRuleTests {
  day: string;
  groups: Record<string, { line: string | null; byStrategy: Record<string, RuleTestResult> }>;
}

const RULE_TESTS_KEY = 'ruleTests';

/**
 * The rule tests (S9 part 5), worked out after the collect for every group of similar items that
 * someone holds or watches an item of, on the group's whole history, for every strategy (each
 * margin someone chose apart) and saved in one setting. An item's line is tested on its own
 * when it gives enough signals (3+ items), else the whole group.
 */
export async function refreshRuleTests(db: Db, now = new Date()): Promise<number> {
  const pairs = await valuedPairs(db);
  const allProducts = await db.select().from(products);
  const lines = await productLines(db, allProducts);
  const margins = new Set([DEFAULT_MARGIN]);
  for (const u of await db.select({ preferences: users.preferences }).from(users)) {
    for (const c of Object.values(u.preferences?.buyStrategy?.byType ?? {})) {
      if (c.strategy === 'margin' && c.margin) margins.add(c.margin);
    }
  }
  const choices: StrategyChoice[] = [
    { strategy: 'steady' },
    { strategy: 'bargain' },
    { strategy: 'dip' },
    ...[...margins].map((margin): StrategyChoice => ({ strategy: 'margin', margin })),
  ];
  const today = localDate(now);
  const wanted = new Map<string, { key: string; bucket: string | null; line: string | null }>();
  for (const { product, bucket } of pairs) {
    const key = similarKey(product);
    if (!key) continue;
    const line = lines.get(product.id) ?? null;
    wanted.set(`${key}|${bucket ?? ''}|${line ?? ''}`, { key, bucket, line });
  }
  const groups: SavedRuleTests['groups'] = {};
  const keys = new Set([...wanted.values()].map((w) => w.key));
  for (const key of keys) {
    const members = allProducts.filter((p) => similarKey(p) === key);
    const history = await dailySeries(
      db,
      members.map((p) => p.id),
    );
    const done = new Map<string, RuleTestResult[]>();
    for (const [id, w] of wanted) {
      if (w.key !== key) continue;
      const seriesOf = (list: Product[]) =>
        list.flatMap((p) => {
          const s = pickSeries(history, p.id, w.bucket);
          return s ? [s.series] : [];
        });
      // The same group is asked for by several lines: each test is worked out once.
      const test = (line: string | null) => {
        const memo = `${w.bucket ?? ''}|${line ?? ''}`;
        if (!done.has(memo)) {
          const list = line ? members.filter((p) => lines.get(p.id) === line) : members;
          done.set(memo, ruleTests(seriesOf(list), choices, today));
        }
        return done.get(memo)!;
      };
      let line: string | null = null;
      let results: RuleTestResult[] | null = null;
      if (w.line) {
        const own = test(w.line);
        if (
          own[0] &&
          own[0].items >= PATTERN_MIN_ITEMS &&
          own.some((r) => r.checked >= RULE_TEST_MIN_SIGNALS)
        ) {
          line = w.line;
          results = own;
        }
      }
      results ??= test(null);
      groups[id] = {
        line,
        byStrategy: Object.fromEntries(choices.map((c, i) => [strategyKey(c), results![i]!])),
      };
    }
  }
  await saveSetting(db, RULE_TESTS_KEY, { day: today, groups } satisfies SavedRuleTests);
  return Object.keys(groups).length;
}

/** An item's rule test for a person's strategy (null before the first, or for own target only). */
export async function ruleTestFor(
  db: Db,
  product: Product,
  bucket: string | null,
  choice: StrategyChoice,
): Promise<{ result: RuleTestResult; line: string | null; day: string } | null> {
  const key = similarKey(product);
  if (!key || choice.strategy === 'target') return null;
  const [saved, lines] = await Promise.all([
    readSetting<SavedRuleTests>(db, RULE_TESTS_KEY),
    productLines(db, [product]),
  ]);
  const group = saved?.groups[`${key}|${bucket ?? ''}|${lines.get(product.id) ?? ''}`];
  const result = group?.byStrategy[strategyKey(choice)];
  return result ? { result, line: group.line, day: saved!.day } : null;
}
