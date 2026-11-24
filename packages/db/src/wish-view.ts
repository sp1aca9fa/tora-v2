// One game wish as its page and the Wishlist read it (requirements S36 C2; plan W15): the copies
// buyable from the last nightly read, the level and (when shown) the record, the bounds, the
// person's estimates and the item's dated facts. One loader for the page and the list, batched by
// item (S19). Nothing here is a verdict: every number keeps its basis (count, window, date), and
// what is not known stays not known (null), never 0. The levels are W14's stored ones, never
// recomputed here.
import {
  type Condition,
  type DayLevel,
  type ItemFactKind,
  type LevelChange,
  type LevelDay,
  type Paid,
  type PaidRule,
  type SaleSpanHow,
  type SpanWhy,
  type WishEstimateBasis,
  type WishRecord,
  type WishRisk,
  ITEM_FACT_KINDS,
  WISH_ESTIMATE_BASES,
  WISH_CONDITIONS,
  WISH_RISKS,
  addDays,
  asPaid,
  atOrBetter,
  baseCurrency,
  changeOver,
  conditionBucket,
  effectiveRules,
  failsRules,
  identitySources,
  localDate,
  sourceInfo,
  toLocalIso,
  youngGame,
} from '@tora/core';
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import type { Db } from './client';
import { type AskStatus, askChecks } from './ask-check';
import { listConsoles } from './consoles';
import { DomainError } from './mutations';
import { loadSourceRegistry } from './registry';
import { type DayRange, coveredOf, coversDay, mergeRanges } from './sale-coverage';
import {
  type Product,
  type User,
  type Watch,
  collectorRuns,
  itemFacts,
  marketJobs,
  notItemMarks,
  priceObservations,
  productSources,
  products,
  saleCoverage,
  saleSpans,
  supply,
  users,
  watches,
  wishEstimates,
} from './schema';
import { type StoredListPrice, sourceFacts } from './source-facts';
import { type SupplyOffer, isShopOffers, supplyOffers } from './supply';
import { updateWatch } from './watches';
import { type WishLevel, wishLevelsOf, wishRecordShown } from './wish-levels';
import { type WishState, wishStates } from './wishes';

/** Copies listed per search-based source (spec W15: "the cheapest 3 to 5 ... (to start: 5)"). */
export const WISH_COPIES = 5;
/** "Near the low so far": the level within this share of the record (spec W15: "3 %, to start"). */
export const NEAR_RECORD_SHARE = 0.03;
/** Facts about stock: this many read nights running (spec W15: "5 or more nights running"). */
export const FACT_NIGHTS = 5;
/** The days of stored rows read: the 4-week changes need 28 days back, plus a week of slack. */
export const WISH_VIEW_DAYS = 35;
/** How far back the last nightly read is looked for: none in these days, nothing is last night's. */
export const LAST_NIGHT_DAYS = 7;
/**
 * The run of yesterday still reads as "last night" until this local hour (fix round 2, item 1: "to
 * start"); from it on, a night not run today is shown by its date.
 */
export const NIGHT_CUTOFF_HOUR = 6;

/**
 * How a listing's price as paid is read (S36 Terms "As paid", C1). The plug-ins' `addedCost`
 * declarations are not reachable from the app, so a listing counts as paid only when its own row
 * says the seller pays shipping; a buyer-paid or unstated shipping is not known ("plus shipping").
 */
const LISTING_RULE: PaidRule = { rule: 'per_row', unstated: 'unknown' };

const paidOf = (price: number, shipping: SupplyOffer['shipping'] | null | undefined): Paid =>
  asPaid({ price, shipping: shipping ?? 'unknown' }, LISTING_RULE);

/** One listing buyable now, as a wish shows it. */
export interface WishCopy {
  ref: string;
  title: string;
  url: string | null;
  seller: string | null;
  bucket: string;
  /** The stored price, in the base currency. */
  price: number;
  /** As paid; not known: shown as the price "plus shipping". */
  paid: Paid;
}

/**
 * One search-based source's copies (fix round 2, items 2 and 3). Listed only when it stores asks
 * for the item (a supply row in the page's window). Read on N (`WishView.lastRun`): its copies are
 * N's rows; not read on N: its newest earlier day's, shown under `day`.
 */
export interface WishSourceView {
  source: string;
  /** The day of the read the copies come from: N when `current`. */
  day: string;
  /**
   * Read on N for the item: the item's stored nights at the source hold N (as stamped, the day the
   * collect ran, like the rows' day), or it has a row dated N.
   */
  current: boolean;
  /** Read on N and nothing in the wish's condition or a better one: no copies, never older ones. */
  none: boolean;
  /** `unverified`: the search is not checked for the game: no copies, only a muted note. */
  status: Exclude<AskStatus, 'not_game'>;
  /** Checked only: the cheapest copies in the wish's condition or a better one. */
  copies: WishCopy[];
  /**
   * Listings in the wish's condition or a better one (the stored count, less the stored listings
   * marked "not the item" or failing the item's rules).
   */
  count: number;
  /** The source caps its count: "at least `count`". */
  capped: boolean;
  /** Unverified only: the cheapest such listing, shown muted and labeled, never to act on. */
  unverifiedPrice: number | null;
  /** Checked only: copies of no stated grade (`cond:used`) or no condition, shown apart. */
  apart: WishCopy[];
}

/** One of the identity shop's entries (S36 A6, B2). */
export interface WishShopEntry {
  bucket: string;
  /** `own`: the shop's own copy; `outside`: an outside seller on its site; null: not said. */
  kind: 'own' | 'outside' | null;
  price: number;
  paid: Paid;
  stock: number | null;
  count: number | null;
  condition: string | null;
  /** An outside seller's name, when stored. */
  seller: string | null;
  url: string | null;
}

export interface WishShopView {
  source: string;
  day: string;
  /** Read on N (see `WishSourceView.current`). */
  current: boolean;
  /** Read on N and no row in the wish's condition or a better one (see `WishSourceView.none`). */
  none: boolean;
  entries: WishShopEntry[];
  /** No own copy in the wish's condition or a better one that read; null: the read does not tell. */
  outOfStock: boolean | null;
}

/**
 * The cheapest checked copy (the facts line and the Wishlist's card), from copies dated N only
 * (fix round 2, item 4): never an older read's.
 */
export interface WishCheapest {
  source: string;
  /** N, the last run's day. */
  day: string;
  price: number;
  paid: Paid;
  /**
   * The price it counts at (fix round 2, item 5; S36 C3 "counts on its stored price"): as paid when
   * known, else the stored price, said "plus shipping". The cheapest, "at or under your price" and
   * the sort use it.
   */
  counted: number;
}

export interface WishLevelView {
  /** The last day of the stored series (yesterday at best: a night covers the day before). */
  current: LevelDay;
  /** Over 28 days, when both days have a level (W14 `changeOver`). */
  change: LevelChange | null;
  /** Only while the owner shows records (`wishRecordShown`); else null. */
  record: WishRecord | null;
  /** The level within `NEAR_RECORD_SHARE` of the shown record; false while records are hidden. */
  nearLow: boolean;
  /** The game's age on the level's day (Terms "Young game"); null: not known. */
  young: { young: boolean; ageDays: number } | null;
  /** The series for the chart (days with a level only). */
  series: { day: string; level: number; n: number }[];
}

export interface WishBounds {
  /** The shop's buyback price (under). */
  buyback: { source: string; day: string; price: number; change: LevelChange | null } | null;
  /** The cheapest new copy (over), naming its source. */
  newCopy: { source: string; day: string; price: number; paid: Paid } | null;
  /** The list price at the shop as its page showed it, in its own currency (no share yet: A5). */
  listPrice: (StoredListPrice & { source: string }) | null;
}

/**
 * `other_condition`: entered for another condition than the wish's now (or before conditions were
 * stored on estimates): never scored against this condition's level.
 */
export type EstimateOutcome =
  'pending' | 'inside' | 'under' | 'over' | 'unknown' | 'other_condition';

export interface WishEstimateView {
  id: string;
  low: number;
  high: number;
  currency: string;
  settleBy: string | null;
  risks: { kind: WishRisk; text?: string }[];
  basis: WishEstimateBasis | null;
  sources: string[];
  enteredAt: string;
  author: string | null;
  /** The wish's bucket when entered; null: not stored (entered before migration 0074). */
  bucket: string | null;
  /**
   * What happened since: the level on the last day of the "when" month. `pending`: that day is
   * yesterday or later (a night covers the day before); `unknown`: no "when" (`no_month`), another
   * currency (`currency`), or no level on that day (`no_level`). Null when the wish reads check
   * needed (no score then).
   */
  outcome: {
    is: EstimateOutcome;
    day: string | null;
    level: number | null;
    why?: 'no_month' | 'no_level' | 'currency';
  } | null;
}

// The level's 4-week change is shown once, in the level (fix round 1, item 15): not a fact here.
export type WishComputedFact =
  | { kind: 'buyback_change'; source: string; change: LevelChange }
  | { kind: 'shop_out'; source: string; nights: number; since: string }
  | { kind: 'no_new_copy'; nights: number; since: string };

export interface WishRecordedFact {
  id: string;
  day: string;
  kind: ItemFactKind;
  text: string | null;
  sourceUrl: string | null;
  recordedBy: string | null;
  recordedByName: string | null;
  recordedAt: string;
  /** The signed-in person may take it back (its author or an admin). */
  mayDelete: boolean;
}

/**
 * A job's state in plain words (fix round 1, item 3): `several_days`, a waiting job that has made
 * requests or holds a cursor (stopped by a day's number, it goes on another day); `asked_again`,
 * only when the earlier job of its kind lost its span for a reason that asks it again
 * (`result.why`: search edited, narrower search, load undone).
 */
export type WishJobState = 'running' | 'several_days' | 'waiting' | 'asked_again' | 'stopped';

export interface WishHistoryLine {
  source: string;
  /** The first covered day; null: none yet. */
  first: string | null;
  days: number;
  ranges: DayRange[];
  /** Covered days by how they were read (nights as covered days, a night D covering D-1). */
  by: { how: 'night' | SaleSpanHow; ranges: DayRange[] }[];
  /** A read-back, deep read or load not finished (or stopped), in plain words; null: none. */
  job: { state: WishJobState; kind: 'readback' | 'deep' | 'load' } | null;
}

export interface WishView {
  watch: Watch;
  product: Product;
  state: WishState;
  /** N when it reads as last night (`freshNight`); null: N is shown by its date, or there is none. */
  night: string | null;
  /** N: the day of the last collect run in the last `LAST_NIGHT_DAYS` days; null: none. */
  lastRun: string | null;
  /** The wish has no condition (bucket ''): a level needs one (fix round 1, item 8). */
  needsCondition: boolean;
  shop: WishShopView[];
  /** Search-based sources; empty while check needed. */
  sources: WishSourceView[];
  cheapest: WishCheapest | null;
  /** Null while check needed, or before the first nightly level. */
  level: WishLevelView | null;
  /** Whether a stored level row exists (none: "computed after the next nightly read"). */
  levelStored: boolean;
  bounds: WishBounds | null;
  /** Credit lines of the sources whose prices show. */
  credits: { source: string; text: string; url: string }[];
  // Detail only (the page): empty on the list.
  estimates: WishEstimateView[];
  facts: WishComputedFact[];
  recorded: WishRecordedFact[];
  history: WishHistoryLine[];
}

export interface WishViewOptions {
  now?: Date;
  /** The page's parts (estimates, facts, history); the list leaves them out. */
  detail?: boolean;
  /** The signed-in person's role, for `mayDelete` (admins may take back any fact). */
  role?: User['role'];
}

const IDS_PER_READ = 500;
const SPAN_HOWS = ['readback', 'deep', 'load'] as const;
const JOB_KINDS = ['readback', 'deep', 'load'];
type JobKind = 'readback' | 'deep' | 'load';
/** A job's `result.why` that asks the read again (fix round 1, item 3). */
const ASKED_AGAIN: readonly SpanWhy[] = ['search_edited', 'narrower_search', 'load_undone'];

/** Reads `ids` in parts of 500 (S19). */
async function inParts<T>(ids: readonly string[], read: (part: string[]) => Promise<T[]>) {
  const out: T[] = [];
  const all = [...new Set(ids)];
  for (let i = 0; i < all.length; i += IDS_PER_READ)
    out.push(...(await read(all.slice(i, i + IDS_PER_READ))));
  return out;
}

/**
 * The day of the last nightly read: the latest collect run's day in the last `LAST_NIGHT_DAYS`
 * days (a bounded read, newest first), never after today; null: none in those days.
 */
export async function lastNight(db: Pick<Db, 'select'>, now: Date): Promise<string | null> {
  const [row] = await db
    .select({ at: collectorRuns.startedAt })
    .from(collectorRuns)
    .where(
      gte(
        collectorRuns.startedAt,
        toLocalIso(new Date(now.getTime() - LAST_NIGHT_DAYS * 86_400_000)),
      ),
    )
    .orderBy(desc(collectorRuns.startedAt))
    .limit(1);
  if (!row?.at) return null;
  const day = localDate(new Date(row.at));
  const today = localDate(now);
  return day > today ? today : day;
}

/**
 * Whether the last run's day N reads as "last night" (fix round 2, item 1): N when it is today, or
 * yesterday while the local time is before `NIGHT_CUTOFF_HOUR`; else null, and N is shown by its
 * date ("as of <date>"), never as last night's.
 */
export function freshNight(lastRun: string | null, now: Date): string | null {
  if (lastRun === null) return null;
  const today = localDate(now);
  if (lastRun === today) return lastRun;
  const hour = Number(toLocalIso(now).slice(11, 13));
  return lastRun === addDays(today, -1) && hour < NIGHT_CUTOFF_HOUR ? lastRun : null;
}

/** The last day of a `YYYY-MM` month. */
const monthEnd = (month: string) => addDays(`${addDays(`${month}-28`, 4).slice(0, 7)}-01`, -1);

/** Whether a stored `day` (YYYY-MM-DD) is the series' level, and its value. */
const dayLevels = (series: readonly LevelDay[]): DayLevel[] =>
  series.map((d) => ({ day: d.day, level: d.level, window: d.window }));

/** A row's stock on one read day: in, out, or the row does not tell. */
type DayStock = 'in' | 'out' | 'unknown';

interface SupplyRead {
  productId: string;
  source: string;
  bucket: string | null;
  day: string;
  lowestAskBase: number | null;
  listings: number | null;
  listingsCapped: boolean | number | null;
  offers: unknown;
  url: string | null;
  /** When its run started: every row one run stored for an item and source carries the same. */
  fetchedAt: string;
}

function shopEntries(row: SupplyRead): WishShopEntry[] {
  const bucket = row.bucket ?? '';
  const offers = supplyOffers(row);
  if (offers && offers.length)
    return offers.map((o) => ({
      bucket,
      kind: o.own ?? null,
      price: o.priceBase,
      paid: paidOf(o.priceBase, o.shipping),
      stock: o.stock ?? null,
      count: o.count ?? null,
      condition: o.condition ?? null,
      seller: o.seller ?? null,
      url: o.url,
    }));
  if (row.lowestAskBase === null) return [];
  // An ask stored without its entries (before S36): whose copy it is is not said.
  return [
    {
      bucket,
      kind: null,
      price: row.lowestAskBase,
      paid: paidOf(row.lowestAskBase, null),
      stock: null,
      count: null,
      condition: null,
      seller: null,
      url: row.url,
    },
  ];
}

/**
 * The shop's own copy on one read day, over its rows in the wish's condition or a better one: in
 * when one has an own entry; out when none does and each is either the stated "out of stock" (no
 * ask, no entries) or lists only outside sellers; not told when a row has an ask with no entries.
 */
function shopStock(rows: readonly SupplyRead[]): DayStock {
  if (!rows.length) return 'unknown';
  let told = true;
  for (const r of rows) {
    const offers = supplyOffers(r);
    if (offers?.some((o) => o.own === 'own')) return 'in';
    if (!offers && r.lowestAskBase !== null) told = false;
  }
  return told ? 'out' : 'unknown';
}

/** The run of `out` days ending at the latest read day (days not read are not in the list). */
function outRun(days: readonly { day: string; is: DayStock }[]): { nights: number; since: string } {
  let nights = 0;
  let since = '';
  for (const d of days.toSorted((a, b) => (a.day < b.day ? 1 : -1))) {
    if (d.is !== 'out') break;
    nights++;
    since = d.day;
  }
  return { nights, since };
}

/** The latest value per day, then changeOver (exact day 28 before: W14's rule). */
function seriesChange(points: readonly { day: string; value: number }[]): LevelChange | null {
  const byDay = new Map<string, number>();
  for (const p of points.toSorted((a, b) => (a.day < b.day ? -1 : 1))) byDay.set(p.day, p.value);
  const days = [...byDay].map(([day, level]): DayLevel => ({ day, level, window: 30 }));
  return changeOver(days, 28);
}

/**
 * The wishes of `userId` (all of them, or `watchIds`), each as its page or card reads it, by watch
 * id. Another person's wish is not read (it is not in the result). Batched by item (S19).
 */
export async function wishViews(
  db: Db,
  userId: string,
  watchIds: readonly string[] | null,
  options: WishViewOptions = {},
): Promise<Map<string, WishView>> {
  const now = options.now ?? new Date();
  const today = localDate(now);
  const out = new Map<string, WishView>();
  const rows = watchIds
    ? await inParts(watchIds, (part) =>
        db
          .select({ watch: watches, product: products })
          .from(watches)
          .innerJoin(products, eq(products.id, watches.productId))
          .where(and(eq(watches.userId, userId), inArray(watches.id, part))),
      )
    : await db
        .select({ watch: watches, product: products })
        .from(watches)
        .innerJoin(products, eq(products.id, watches.productId))
        .where(eq(watches.userId, userId));
  if (!rows.length) return out;

  const states = await wishStates(
    db,
    rows.map((r) => r.product),
  );
  const games = rows.filter((r) => states.get(r.product.id)?.state !== 'not_game');
  for (const r of rows)
    if (!games.includes(r))
      out.set(r.watch.id, {
        ...r,
        state: 'not_game',
        night: null,
        lastRun: null,
        needsCondition: false,
        shop: [],
        sources: [],
        cheapest: null,
        level: null,
        levelStored: false,
        bounds: null,
        credits: [],
        estimates: [],
        facts: [],
        recorded: [],
        history: [],
      });
  if (!games.length) return out;

  // A boxed item reads its plain item's rows, kept by its own rules (S36 B1; `rowsItemOf`).
  const boxed = games.filter((r) => {
    const rules = states.get(r.product.id)!.rules;
    return !!rules?.boxed && !!rules.boxedOf;
  });
  const consoles = boxed.length ? await listConsoles(db) : [];
  const rowsOf = new Map(
    games.map((r) => {
      const rules = states.get(r.product.id)!.rules;
      const from = rules?.boxed && rules.boxedOf ? rules.boxedOf : r.product.id;
      return [
        r.product.id,
        { from, rules: from === r.product.id ? null : effectiveRules(r.product, rules, consoles) },
      ];
    }),
  );
  const ids = [...new Set(games.map((r) => r.product.id))];
  const readIds = [...new Set([...ids, ...[...rowsOf.values()].map((v) => v.from)])];

  // N, the last run's day, first: the list reads only N's supply rows (its cards show the cheapest
  // copy of N, never older ones; fix round 2, item 4), the page the 4 weeks its facts need.
  const lastRun = await lastNight(db, now);
  const night = freshNight(lastRun, now);
  const since = options.detail ? addDays(today, -WISH_VIEW_DAYS) : lastRun;
  // Levels per bucket: a wish with no condition (bucket '') has none (fix round 1, item 8).
  const leveled = games.filter((r) => r.watch.bucket !== '');

  const [registry, checks, levels, shown, supplyRows, marks, buyRows, links, coverage] =
    await Promise.all([
      loadSourceRegistry(db),
      askChecks(
        db,
        games.map((r) => r.product),
      ),
      wishLevelsOf(
        db,
        leveled.map((r) => ({ productId: r.product.id, bucket: r.watch.bucket })),
      ),
      wishRecordShown(db),
      // No run in the last days: the list has no copy of N to show, and reads none.
      since === null
        ? []
        : inParts(readIds, (part) =>
            db
              .select({
                productId: supply.productId,
                source: supply.source,
                bucket: supply.bucket,
                day: supply.day,
                lowestAskBase: supply.lowestAskBase,
                listings: supply.listings,
                listingsCapped: supply.listingsCapped,
                offers: supply.offers,
                url: supply.url,
                fetchedAt: supply.fetchedAt,
              })
              .from(supply)
              .where(and(inArray(supply.productId, part), gte(supply.day, since))),
          ),
      inParts(readIds, (part) =>
        db
          .select({
            productId: notItemMarks.productId,
            source: notItemMarks.source,
            ref: notItemMarks.externalRef,
          })
          .from(notItemMarks)
          .where(inArray(notItemMarks.productId, part)),
      ),
      // The buyback bound (the page only): kept rows only, never one marked excluded (item 5).
      options.detail
        ? inParts(ids, (part) =>
            db
              .select({
                productId: priceObservations.productId,
                source: priceObservations.source,
                price: priceObservations.priceBase,
                at: priceObservations.observedAt,
              })
              .from(priceObservations)
              .where(
                and(
                  inArray(priceObservations.productId, part),
                  eq(priceObservations.observationType, 'buylist'),
                  eq(priceObservations.excluded, false),
                  gte(priceObservations.observedAt, addDays(today, -WISH_VIEW_DAYS)),
                ),
              ),
          )
        : [],
      // Every link of the items: their facts (list price, product code).
      inParts(readIds, (part) =>
        db
          .select({
            productId: productSources.productId,
            source: productSources.source,
            externalId: productSources.externalId,
            facts: productSources.facts,
            active: productSources.active,
          })
          .from(productSources)
          .where(inArray(productSources.productId, part)),
      ),
      // The nights each source read each item (the page only: "read on N" and the history).
      options.detail
        ? inParts(readIds, (part) =>
            db
              .select({
                productId: saleCoverage.productId,
                source: saleCoverage.source,
                nights: saleCoverage.nights,
              })
              .from(saleCoverage)
              .where(inArray(saleCoverage.productId, part)),
          )
        : [],
    ]);
  const base = baseCurrency(registry);
  const shopKeys = new Set(identitySources(registry, 'game'));
  const isShop = (r: SupplyRead) => shopKeys.has(r.source) || isShopOffers(r.offers);
  const rowsByItem = new Map<string, SupplyRead[]>();
  for (const r of supplyRows)
    rowsByItem.set(r.productId, [...(rowsByItem.get(r.productId) ?? []), r]);
  const marked = new Set(marks.map((m) => `${m.productId}|${m.source}|${m.ref}`));
  const linksByItem = new Map<string, typeof links>();
  for (const l of links)
    if (l.active) linksByItem.set(l.productId, [...(linksByItem.get(l.productId) ?? []), l]);
  const nightsOf = new Map(coverage.map((c) => [`${c.productId}|${c.source}`, c.nights ?? []]));

  let detail: Awaited<ReturnType<typeof detailOf>> | null = null;
  if (options.detail) {
    const fromIds = new Set([...rowsOf.values()].map((v) => v.from));
    detail = await detailOf(
      db,
      games.map((r) => r.watch.id),
      ids,
      [...fromIds],
      coverage.filter((c) => fromIds.has(c.productId)),
    );
  }

  for (const { watch, product } of games) {
    const state = states.get(product.id)!.state;
    const wanted = watch.bucket;
    const { from, rules } = rowsOf.get(product.id)!;
    const better = (bucket: string | null) => atOrBetter(bucket, wanted);
    const isMarked = (source: string, ref: string) =>
      marked.has(`${product.id}|${source}|${ref}`) || marked.has(`${from}|${source}|${ref}`);
    const ownLinks = linksByItem.get(product.id) ?? [];
    const fromLinks = from === product.id ? [] : (linksByItem.get(from) ?? []);
    const wishLinks = [...ownLinks, ...fromLinks];

    // The shop's rows are the wished item's own (its identity link); a boxed item with no link at
    // the shop reads its plain item's, as its listings. Decided by the link, never by which rows
    // the window loaded: the list reads one day, the page 35, and both must pick the same item.
    const shopItem = ownLinks.some((l) => shopKeys.has(l.source)) ? product.id : from;
    const shopRows = (rowsByItem.get(shopItem) ?? []).filter(isShop);
    const searchRows = (rowsByItem.get(from) ?? []).filter((r) => !isShop(r));

    const latest = (list: SupplyRead[]) => {
      const bySource = new Map<string, SupplyRead[]>();
      for (const r of list) bySource.set(r.source, [...(bySource.get(r.source) ?? []), r]);
      return [...bySource].map(([source, all]) => {
        const day = all.reduce((d, r) => (r.day > d ? r.day : d), '');
        return { source, day, rows: all.filter((r) => r.day === day), all };
      });
    };
    // The read per source (fix round 2, items 2 and 3): a source is listed only when it stores
    // asks for the item (a row in the window), so a sales-only source never is. Read on N (its
    // stored nights for the rows' item hold N, as stamped, or a row is dated N): N's rows, and with
    // nothing in the condition "none found", never older copies. Not read on N: its newest earlier
    // day's rows, shown under that date.
    const reads = (list: SupplyRead[], item: string) => {
      const bySource = new Map<string, SupplyRead[]>();
      for (const r of list) bySource.set(r.source, [...(bySource.get(r.source) ?? []), r]);
      return [...bySource].flatMap(([source, all]) => {
        const n = lastRun;
        if (
          n !== null &&
          (all.some((r) => r.day === n) || coversDay(nightsOf.get(`${item}|${source}`) ?? [], n))
        ) {
          // Two reads the same day (the nightly, then a "collect now"): only the newer one's rows.
          // A read rewrites only the conditions it found, so an older row of the day can hold a
          // copy the newer read no longer saw.
          const ofN = all.filter((r) => r.day === n);
          const newest = ofN.reduce((at, r) => (r.fetchedAt > at ? r.fetchedAt : at), '');
          return [
            { source, day: n, rows: ofN.filter((r) => r.fetchedAt === newest), current: true },
          ];
        }
        const earlier = all.filter((r) => n === null || r.day < n);
        const day = earlier.reduce((d, r) => (r.day > d ? r.day : d), '');
        return earlier.length
          ? [{ source, day, rows: earlier.filter((r) => r.day === day), current: false }]
          : [];
      });
    };
    const counted = (price: number, paid: Paid) => (paid.known ? paid.amount : price);
    // The cheapest checked copy: from the reads dated N only (fix round 2, item 4).
    const pool: WishCheapest[] = [];
    const offer = (source: string, price: number, paid: Paid) =>
      pool.push({ source, day: lastRun!, price, paid, counted: counted(price, paid) });

    const shop: WishShopView[] = reads(shopRows, shopItem).map(
      ({ source, day, rows: dayRows, current }) => {
        const inCondition = dayRows.filter((r) => better(r.bucket));
        const stock = shopStock(inCondition);
        const entries = inCondition
          .flatMap(shopEntries)
          .toSorted((a, b) => a.price - b.price || (a.kind === 'own' ? -1 : 1));
        if (current) for (const e of entries) offer(source, e.price, e.paid);
        return {
          source,
          day,
          current,
          none: current && !inCondition.length,
          entries,
          outOfStock: inCondition.length ? stock === 'out' : null,
        };
      },
    );

    // The shop is listed once: a source of its block is not listed again as a search.
    const inShop = new Set(shop.map((s) => s.source));
    const sources: WishSourceView[] =
      state === 'check_needed'
        ? []
        : reads(
            searchRows.filter((r) => !inShop.has(r.source)),
            from,
          ).map(({ source, day, rows: dayRows, current }) => {
            const status = checks.status({ productId: product.id, source });
            const pass = (o: SupplyOffer) =>
              !isMarked(source, o.ref) &&
              !(rules && failsRules({ title: o.title, category: null }, rules, source));
            const copiesOf = (list: SupplyRead[]) => {
              const seen = new Set<string>();
              return list
                .flatMap((r) =>
                  (supplyOffers(r) ?? [])
                    .filter((o) => !o.own && pass(o))
                    .map((o): WishCopy => ({
                      ref: o.ref,
                      title: o.title,
                      url: o.url,
                      seller: o.seller,
                      bucket: r.bucket ?? '',
                      price: o.priceBase,
                      paid: paidOf(o.priceBase, o.shipping),
                    })),
                )
                .filter((c) => !seen.has(c.ref) && !!seen.add(c.ref))
                .toSorted((a, b) => a.price - b.price);
            };
            const inCondition = dayRows.filter((r) => better(r.bucket));
            const all = copiesOf(inCondition);
            // A row stores its cheapest listings only; its count may be larger. The stored
            // listings marked "not the item" (or failing the item's rules) are not counted (item 4).
            const count = Math.max(
              inCondition.reduce((n, r) => {
                const offers = supplyOffers(r) ?? [];
                const dropped = offers.filter((o) => !o.own && !pass(o)).length;
                return n + Math.max(Math.max(r.listings ?? 0, offers.length) - dropped, 0);
              }, 0),
              all.length,
            );
            const checked = status === 'checked';
            // Every stored copy counts for the cheapest, not only the ones listed.
            if (current && checked) for (const c of all) offer(source, c.price, c.paid);
            return {
              source,
              day,
              current,
              none: current && count === 0,
              status: checked ? 'checked' : 'unverified',
              copies: checked ? all.slice(0, WISH_COPIES) : [],
              count,
              capped: inCondition.some((r) => !!r.listingsCapped),
              unverifiedPrice: checked ? null : (all[0]?.price ?? null),
              apart: checked
                ? copiesOf(
                    dayRows.filter((r) => !better(r.bucket) && !atOrBetter(r.bucket, 'cond:fair')),
                  ).slice(0, WISH_COPIES)
                : [],
            };
          });

    // The lowest counted price; on a tie the known one as paid first.
    const cheapest =
      pool.toSorted(
        (a, b) => a.counted - b.counted || Number(b.paid.known) - Number(a.paid.known),
      )[0] ?? null;

    const stored: WishLevel | undefined = wanted
      ? levels.get(`${product.id}|${wanted}`)
      : undefined;
    let level: WishLevelView | null = null;
    if (state === 'confirmed' && stored?.series.length) {
      const current = stored.series.at(-1)!;
      const record = shown ? stored.record : null;
      level = {
        current,
        change: changeOver(dayLevels(stored.series), 28),
        record,
        nearLow:
          !!record &&
          current.level !== null &&
          current.level <= record.level * (1 + NEAR_RECORD_SHARE),
        young: youngGame(stored.bornOn, current.day),
        series: stored.series.flatMap((d) =>
          d.level === null ? [] : [{ day: d.day, level: d.level, n: d.n }],
        ),
      };
    }

    // The cheapest new copy (S36 C1 bounds; fix round 1, item 10): the identity shop's own new
    // copy, or the new-copy row of a source linked by the item's product code (the identity
    // shop's JAN is the link's id), never a marketplace listing.
    const jans = new Set(
      wishLinks
        .filter((l) => shopKeys.has(l.source))
        .flatMap((l) => {
          const jan = sourceFacts(l.facts)?.jan;
          return jan ? [jan] : [];
        }),
    );
    const codeLinked = new Set(
      wishLinks
        .filter((l) => !shopKeys.has(l.source) && !!l.externalId && jans.has(l.externalId))
        .map((l) => l.source),
    );
    const newReader = (source: string) =>
      shopKeys.has(source) ||
      (codeLinked.has(source) && checks.status({ productId: product.id, source }) === 'checked');

    let bounds: WishBounds | null = null;
    const facts: WishComputedFact[] = [];
    if (state === 'confirmed') {
      const buys = buyRows
        .filter((b) => b.productId === product.id && shopKeys.has(b.source))
        .map((b) => ({ ...b, day: localDate(new Date(b.at)) }))
        .toSorted((a, b) => (a.at < b.at ? 1 : -1));
      const lastBuy = buys[0];
      const buyChange = lastBuy
        ? seriesChange(
            buys
              .filter((b) => b.source === lastBuy.source)
              .map((b) => ({ day: b.day, value: b.price })),
          )
        : null;
      const newRows = latest(
        [...shopRows, ...searchRows].filter((r) => r.bucket === 'cond:new' && newReader(r.source)),
      )
        .flatMap(({ source, day, rows: dayRows }) =>
          dayRows.flatMap((r) => {
            if (shopKeys.has(source))
              return shopEntries(r)
                .filter((e) => e.kind !== 'outside')
                .map((e) => ({ source, day, price: e.price, paid: e.paid }));
            const first = (supplyOffers(r) ?? [])
              .filter((o) => !isMarked(source, o.ref))
              .toSorted((a, b) => a.priceBase - b.priceBase)[0];
            if (first)
              return [
                {
                  source,
                  day,
                  price: first.priceBase,
                  paid: paidOf(first.priceBase, first.shipping),
                },
              ];
            return r.lowestAskBase === null
              ? []
              : [{ source, day, price: r.lowestAskBase, paid: paidOf(r.lowestAskBase, null) }];
          }),
        )
        .toSorted((a, b) => a.price - b.price);
      const listed = ownLinks
        .filter((l) => shopKeys.has(l.source))
        .flatMap((l) => {
          const lp = sourceFacts(l.facts)?.listPrice;
          return lp ? [{ ...lp, source: l.source }] : [];
        })
        .toSorted((a, b) => ((a.seenAt ?? '') < (b.seenAt ?? '') ? 1 : -1));
      bounds = {
        buyback: lastBuy
          ? { source: lastBuy.source, day: lastBuy.day, price: lastBuy.price, change: buyChange }
          : null,
        newCopy: newRows[0] ?? null,
        listPrice: listed[0] ?? null,
      };

      if (options.detail) {
        if (lastBuy && buyChange)
          facts.push({ kind: 'buyback_change', source: lastBuy.source, change: buyChange });
        for (const s of latest(shopRows)) {
          const days = [...new Set(s.all.map((r) => r.day))].map((day) => ({
            day,
            is: shopStock(s.all.filter((r) => r.day === day && better(r.bucket))),
          }));
          const run = outRun(days);
          if (run.nights >= FACT_NIGHTS) facts.push({ kind: 'shop_out', source: s.source, ...run });
        }
        // No new copy found: a day some new-copy reader (the shop, or the code-linked source)
        // read; found when one of its rows has an ask.
        const newReads = [...shopRows, ...searchRows].filter(
          (r) => r.bucket === 'cond:new' && newReader(r.source),
        );
        const newDays = [...new Set(newReads.map((r) => r.day))].map((day) => ({
          day,
          is: newReads.some((r) => r.day === day && r.lowestAskBase !== null)
            ? ('in' as const)
            : ('out' as const),
        }));
        const run = outRun(newDays);
        if (run.nights >= FACT_NIGHTS) facts.push({ kind: 'no_new_copy', ...run });
      }
    }

    const shownSources = new Set([
      ...shop.filter((s) => s.entries.length).map((s) => s.source),
      ...sources.filter((s) => s.copies.length || s.apart.length).map((s) => s.source),
      ...(bounds?.newCopy ? [bounds.newCopy.source] : []),
    ]);
    const credits = [...shownSources].flatMap((source) => {
      const credit = sourceInfo(registry, source)?.credit;
      return credit ? [{ source, ...credit }] : [];
    });

    // What happened since an estimate (fix round 1, items 6 and 9): the level of the estimate's
    // own bucket on the last day of its month; pending only while that day is yesterday or later
    // (a night covers the day before); after it, no level that day is unknown, never pending.
    const levelDays = stored ? dayLevels(stored.series) : [];
    const yesterday = addDays(today, -1);
    const estimates: WishEstimateView[] = (detail?.estimates.get(watch.id) ?? []).map((e) => {
      let outcome: WishEstimateView['outcome'] = null;
      if (state === 'confirmed') {
        const day = e.settleBy ? monthEnd(e.settleBy) : null;
        if (e.bucket !== wanted) outcome = { is: 'other_condition', day, level: null };
        else if (!day) outcome = { is: 'unknown', day, level: null, why: 'no_month' };
        else if (e.currency !== base)
          outcome = { is: 'unknown', day, level: null, why: 'currency' };
        else if (day >= yesterday) outcome = { is: 'pending', day, level: null };
        else {
          const at = levelDays.find((d) => d.day === day)?.level ?? null;
          outcome =
            at === null
              ? { is: 'unknown', day, level: null, why: 'no_level' }
              : { is: at < e.low ? 'under' : at > e.high ? 'over' : 'inside', day, level: at };
        }
      }
      return { ...e, risks: e.risks ?? [], sources: e.sources ?? [], outcome };
    });
    const recorded: WishRecordedFact[] = (detail?.facts.get(product.id) ?? []).map((f) => ({
      ...f,
      mayDelete: f.recordedBy === userId || options.role === 'admin',
    }));
    const history = state === 'check_needed' ? [] : (detail?.history.get(from) ?? []);

    out.set(watch.id, {
      watch,
      product,
      state,
      night,
      lastRun,
      needsCondition: wanted === '',
      shop,
      sources,
      cheapest,
      level,
      levelStored: !!stored,
      bounds,
      credits,
      estimates,
      facts,
      recorded,
      history,
    });
  }
  return out;
}

/** One wish of `userId`; null when it is not theirs (or does not exist). */
export async function wishView(
  db: Db,
  userId: string,
  watchId: string,
  options: WishViewOptions = {},
): Promise<WishView | null> {
  const id = typeof watchId === 'string' ? watchId.slice(0, 40) : '';
  if (!id) return null;
  return (await wishViews(db, userId, [id], { detail: true, ...options })).get(id) ?? null;
}

/**
 * The page's parts: estimates by watch, recorded facts by item, covered days by rows item
 * (`coverage`: the rows items' stored nights, read with the page's other reads).
 */
async function detailOf(
  db: Db,
  watchIds: readonly string[],
  productIds: readonly string[],
  fromIds: readonly string[],
  coverage: readonly { productId: string; source: string; nights: DayRange[] | null }[],
) {
  const [estimateRows, factRows, spans, jobs] = await Promise.all([
    inParts(watchIds, (part) =>
      db
        .select({ estimate: wishEstimates, author: users.username })
        .from(wishEstimates)
        .leftJoin(users, eq(users.id, wishEstimates.userId))
        .where(inArray(wishEstimates.watchId, part))
        .orderBy(desc(wishEstimates.enteredAt)),
    ),
    inParts(productIds, (part) =>
      db
        .select({ fact: itemFacts, by: users.username })
        .from(itemFacts)
        .leftJoin(users, eq(users.id, itemFacts.recordedBy))
        .where(inArray(itemFacts.productId, part)),
    ),
    inParts(fromIds, (part) =>
      db
        .select({
          productId: saleSpans.productId,
          source: saleSpans.source,
          from: saleSpans.fromDay,
          to: saleSpans.toDay,
          how: saleSpans.how,
        })
        .from(saleSpans)
        .where(inArray(saleSpans.productId, part)),
    ),
    inParts(fromIds, (part) =>
      db
        .select({
          productId: marketJobs.productId,
          source: marketJobs.source,
          kind: marketJobs.kind,
          status: marketJobs.status,
          createdAt: marketJobs.createdAt,
          requests: marketJobs.requests,
          cursor: marketJobs.cursor,
          result: marketJobs.result,
        })
        .from(marketJobs)
        .where(and(inArray(marketJobs.productId, part), inArray(marketJobs.kind, JOB_KINDS))),
    ),
  ]);

  const estimates = new Map<
    string,
    (typeof wishEstimates.$inferSelect & { author: string | null })[]
  >();
  for (const { estimate, author } of estimateRows)
    estimates.set(estimate.watchId, [
      ...(estimates.get(estimate.watchId) ?? []),
      { ...estimate, author },
    ]);

  // A fact taken back is a later row naming it (append-only): neither is shown.
  const withdrawn = new Set(
    factRows.flatMap((r) => (r.fact.withdrawsId ? [r.fact.withdrawsId] : [])),
  );
  const facts = new Map<string, Omit<WishRecordedFact, 'mayDelete'>[]>();
  for (const { fact, by } of factRows.toSorted((a, b) =>
    a.fact.day === b.fact.day
      ? a.fact.recordedAt < b.fact.recordedAt
        ? 1
        : -1
      : a.fact.day < b.fact.day
        ? 1
        : -1,
  )) {
    if (fact.withdrawsId || withdrawn.has(fact.id)) continue;
    facts.set(fact.productId, [
      ...(facts.get(fact.productId) ?? []),
      {
        id: fact.id,
        day: fact.day,
        kind: fact.kind,
        text: fact.text,
        sourceUrl: fact.sourceUrl,
        recordedBy: fact.recordedBy,
        recordedByName: by ?? null,
        recordedAt: fact.recordedAt,
      },
    ]);
  }

  const key = (productId: string, source: string) => `${productId}|${source}`;
  const nights = new Map(coverage.map((c) => [key(c.productId, c.source), c.nights ?? []]));
  const spansOf = new Map<string, typeof spans>();
  for (const s of spans)
    spansOf.set(key(s.productId, s.source), [
      ...(spansOf.get(key(s.productId, s.source)) ?? []),
      s,
    ]);
  const jobsOf = new Map<string, typeof jobs>();
  for (const j of jobs)
    if (j.productId)
      jobsOf.set(key(j.productId, j.source), [
        ...(jobsOf.get(key(j.productId, j.source)) ?? []),
        j,
      ]);

  const history = new Map<string, WishHistoryLine[]>();
  for (const k of new Set([...nights.keys(), ...spansOf.keys(), ...jobsOf.keys()])) {
    const at = k.indexOf('|');
    const productId = k.slice(0, at);
    const source = k.slice(at + 1);
    const ownSpans = spansOf.get(k) ?? [];
    const ranges = coveredOf(
      nights.get(k) ?? [],
      ownSpans.map((s): DayRange => [s.from, s.to]),
    );
    const by: WishHistoryLine['by'] = [];
    const nightRanges = coveredOf(nights.get(k) ?? []);
    if (nightRanges.length) by.push({ how: 'night', ranges: nightRanges });
    for (const how of SPAN_HOWS) {
      const r = mergeRanges(
        ownSpans.filter((s) => s.how === how).map((s): DayRange => [s.from, s.to]),
      );
      if (r.length) by.push({ how, ranges: r });
    }
    const own = (jobsOf.get(k) ?? []).toSorted((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const open = own.find((j) => j.status === 'running' || j.status === 'waiting');
    let job: WishHistoryLine['job'] = null;
    if (open) {
      let state: WishJobState;
      if (open.status === 'running') state = 'running';
      // A waiting job that has made requests or holds a cursor goes on another day.
      else if (open.requests > 0 || open.cursor != null) state = 'several_days';
      else {
        // Asked for again only when the earlier job of its kind says so (`result.why`); a
        // weekly read-back's next job is not a repeat.
        const before = own.find(
          (j) => j !== open && j.kind === open.kind && j.createdAt < open.createdAt,
        );
        const why = before?.result?.why;
        state = why && ASKED_AGAIN.includes(why) ? 'asked_again' : 'waiting';
      }
      job = { state, kind: open.kind as JobKind };
    } else if (own[0]?.status === 'stopped')
      job = { state: 'stopped', kind: own[0].kind as JobKind };
    const days = ranges.reduce(
      (n, [a, b]) => n + Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000) + 1,
      0,
    );
    history.set(productId, [
      ...(history.get(productId) ?? []),
      { source, first: ranges[0]?.[0] ?? null, days, ranges, by, job },
    ]);
  }
  for (const lines of history.values()) lines.sort((a, b) => a.source.localeCompare(b.source));
  return { estimates, facts, history };
}

// ---------------------------------------------------------------------------------------------
// What the page records (owner only: every function reads the wish as the person's own)

type Who = Pick<User, 'id' | 'role'>;

/** The person's own game wish, or not found (another person's wish, a card or sealed one). */
async function ownGameWish(db: Db, userId: string, wishId: string) {
  const id = typeof wishId === 'string' ? wishId.slice(0, 40) : '';
  const [row] = await db
    .select({ watch: watches, product: products })
    .from(watches)
    .innerJoin(products, eq(products.id, watches.productId))
    .where(and(eq(watches.id, id), eq(watches.userId, userId)));
  if (!row) throw new DomainError('not_found');
  const state = (await wishStates(db, [row.product])).get(row.product.id)?.state;
  if (!state || state === 'not_game') throw new DomainError('not_found');
  return row;
}

export interface WishEstimateInput {
  low: number;
  high: number;
  /** `YYYY-MM`; null: not said. */
  settleBy?: string | null;
  risks?: { kind: string; text?: string | null }[];
  basis?: string | null;
  sources?: string[];
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const clip = (s: unknown, n: number) => (typeof s === 'string' ? s.trim().slice(0, n) : '');

/**
 * Adds an estimate to the person's own game wish (append-only: an earlier one stays and is listed
 * with what happened since). In the base currency; low and high whole and positive, low <= high.
 */
export async function saveWishEstimate(
  db: Db,
  userId: string,
  wishId: string,
  input: WishEstimateInput,
): Promise<typeof wishEstimates.$inferSelect> {
  const { watch } = await ownGameWish(db, userId, wishId);
  const { low, high } = input;
  if (!Number.isSafeInteger(low) || !Number.isSafeInteger(high) || low <= 0 || high < low)
    throw new DomainError('invalid_input');
  const settleBy = input.settleBy?.trim() || null;
  if (settleBy !== null && !MONTH.test(settleBy)) throw new DomainError('invalid_input');
  const basis = input.basis?.trim() || null;
  if (basis !== null && !(WISH_ESTIMATE_BASES as readonly string[]).includes(basis))
    throw new DomainError('invalid_input');
  const risks = (input.risks ?? []).flatMap((r) => {
    if (!(WISH_RISKS as readonly string[]).includes(r.kind)) throw new DomainError('invalid_input');
    const text = clip(r.text, 200);
    if (r.kind === 'other' && !text) return [];
    return [{ kind: r.kind as WishRisk, ...(text && { text }) }];
  });
  const sources = [
    ...new Set((input.sources ?? []).map((s) => clip(s, 300)).filter(Boolean)),
  ].slice(0, 10);
  const registry = await loadSourceRegistry(db);
  const [row] = await db
    .insert(wishEstimates)
    .values({
      watchId: watch.id,
      userId,
      low,
      high,
      currency: baseCurrency(registry),
      settleBy,
      risks,
      basis: basis as WishEstimateBasis | null,
      sources,
      // Scored only against this bucket's level (fix round 1, item 9).
      bucket: watch.bucket,
    })
    .returning();
  return row!;
}

export interface ItemFactInput {
  day: string;
  kind: string;
  text?: string | null;
  sourceUrl?: string | null;
}

/** A link a fact may carry: http or https only. */
function factUrl(input: string | null | undefined): string | null {
  const s = input?.trim();
  if (!s) return null;
  try {
    const url = new URL(s);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('scheme');
    return url.toString().slice(0, 500);
  } catch {
    throw new DomainError('invalid_input');
  }
}

/** Records a dated fact on the item of the person's own game wish (shared per item). */
export async function recordItemFact(
  db: Db,
  userId: string,
  wishId: string,
  input: ItemFactInput,
): Promise<typeof itemFacts.$inferSelect> {
  const { product } = await ownGameWish(db, userId, wishId);
  if (!(ITEM_FACT_KINDS as readonly string[]).includes(input.kind))
    throw new DomainError('invalid_input');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.day ?? '') || addDays(input.day, 0) !== input.day)
    throw new DomainError('invalid_input');
  const text = clip(input.text, 500) || null;
  if (input.kind === 'other' && !text) throw new DomainError('invalid_input');
  const [row] = await db
    .insert(itemFacts)
    .values({
      productId: product.id,
      day: input.day,
      kind: input.kind as ItemFactKind,
      text,
      sourceUrl: factUrl(input.sourceUrl),
      recordedBy: userId,
    })
    .returning();
  return row!;
}

/**
 * Takes back a recorded fact of the wish's item: only its author or an admin. Facts are
 * append-only: a later row naming it (`withdraws_id`) hides it; nothing is deleted.
 */
export async function withdrawItemFact(
  db: Db,
  user: Who,
  wishId: string,
  factId: string,
): Promise<void> {
  const { product } = await ownGameWish(db, user.id, wishId);
  const [fact] = await db
    .select()
    .from(itemFacts)
    .where(
      and(eq(itemFacts.id, String(factId ?? '').slice(0, 40)), eq(itemFacts.productId, product.id)),
    );
  if (!fact || fact.withdrawsId) throw new DomainError('not_found');
  if (fact.recordedBy !== user.id && user.role !== 'admin') throw new DomainError('forbidden');
  const [taken] = await db
    .select({ id: itemFacts.id })
    .from(itemFacts)
    .where(eq(itemFacts.withdrawsId, fact.id));
  if (taken) return;
  await db.insert(itemFacts).values({
    productId: product.id,
    day: fact.day,
    kind: fact.kind,
    withdrawsId: fact.id,
    recordedBy: user.id,
  });
}

/**
 * Changes the condition of the person's own game wish: its bucket follows, so the level, copies
 * and price then read the new bucket; its target, note and alert choice are kept. A change onto
 * another wish of the person on the same item and bucket is refused (`duplicate_watch`).
 */
export async function setWishCondition(
  db: Db,
  userId: string,
  wishId: string,
  condition: string,
): Promise<Watch> {
  const { watch } = await ownGameWish(db, userId, wishId);
  if (!WISH_CONDITIONS.includes(condition as Condition)) throw new DomainError('invalid_input');
  // The page shows a stored fair condition (damaged, poor) as the fair option: saving it unchanged
  // keeps the stored one (fix round 1, item 8).
  if (conditionBucket(condition as Condition) === watch.bucket && watch.condition) return watch;
  return updateWatch(db, userId, watch.id, {
    condition: condition as Condition,
    targetPriceBase: watch.targetPriceBase,
    note: watch.note,
    alertLimited: watch.alertLimited,
  });
}

/** Sets (or clears, null) the price of the person's own game wish; the condition and note stay. */
export async function setWishTarget(
  db: Db,
  userId: string,
  wishId: string,
  targetPriceBase: number | null,
): Promise<Watch> {
  const { watch } = await ownGameWish(db, userId, wishId);
  return updateWatch(db, userId, watch.id, {
    condition: watch.condition,
    targetPriceBase,
    note: watch.note,
    alertLimited: watch.alertLimited,
  });
}
