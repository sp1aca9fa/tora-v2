// A game wish's level, record and the price as paid (requirements S36 Terms "As paid", "Level",
// "Covered day", "Record", "Young game", step C1; plan W14). Pure: the database side is in @tora/db
// `wish-levels.ts`, the nightly step in @tora/collector-sdk `wish-levels.ts`.
import { addDays } from './deep-read';
import { quantile } from './signals';

// ---------------------------------------------------------------------------------------------
// As paid (C1)

/**
 * What a plug-in says a buyer adds to its prices (S36 C1): `included` (the price is what the buyer
 * pays), `per_row` (each row says: shipping included, the buyer pays a stated amount, or it does not
 * tell) or `unknown`. A source with no declaration is `unknown`.
 */
export const ADDED_COST_RULES = ['included', 'per_row', 'unknown'] as const;
export type AddedCostRule = (typeof ADDED_COST_RULES)[number];

/** A plug-in's declaration, for its sales and for its listings apart (S36 Terms "As paid"). */
export interface AddedCost {
  sales: AddedCostRule;
  listings: AddedCostRule;
}

/**
 * A source's shipping sample (setting `addedCostSampled`, S36 C1): of `counted` sales, `included`
 * had the shipping in the price. Recorded by the owner (`collectors/scripts/shipping-sample.ts`):
 * from stored sales carrying the payer per row, counted by hand, or from the marketplace's found
 * counts with and without its payer filter.
 */
export interface AddedCostSample {
  counted: number;
  included: number;
  how: 'stored' | 'hand' | 'search';
  /** The payer filter value the owner read as "the seller pays" (search and stored samples). */
  sellerPays?: string | null;
  /** How many games the sample read (search samples). */
  games?: number;
  at: string;
}

/** C1: "a sample of 100 of its sales shows 95 % or more do (to start)". */
export const SHIPPING_SAMPLE_SIZE = 100;
export const SHIPPING_SAMPLE_SHARE = 0.95;

/**
 * Whether a sample lets a source's prices count as including shipping (S36 C1: "a plug-in may say its
 * prices include shipping as a rule when a sample of 100 of its sales shows 95 % or more do"). A
 * sample under 100 sales, or with counts that cannot be right, never does.
 */
export function sampleIncludes(sample: AddedCostSample | null | undefined): boolean {
  if (!sample) return false;
  const { counted, included } = sample;
  if (!Number.isInteger(counted) || !Number.isInteger(included)) return false;
  if (counted < SHIPPING_SAMPLE_SIZE || included < 0 || included > counted) return false;
  return included >= SHIPPING_SAMPLE_SHARE * counted;
}

/** The rule a source's sales are read under: its declaration, and what a row that does not tell is. */
export interface PaidRule {
  rule: AddedCostRule;
  /** A row that does not say who pays: included only once a sample showed it (C1). */
  unstated: 'included' | 'unknown';
}

/**
 * A source's sales rule (S36 C1). The declaration as given; with a sample of 100 or more at 95 % or
 * more, "the sales a source does not tell this about" count as included, while a row that does tell
 * still counts as it says: a source declared unknown (or not declared) with a passing sample is read
 * `per_row` with the unstated rows included, so a row whose raw says the buyer pays, with no amount,
 * stays out ("a sale the buyer paid shipping on stays out of the level unless the amount is known").
 * No declaration and no passing sample: unknown.
 */
export function salesRule(
  declared: AddedCost | null | undefined,
  sample: AddedCostSample | null | undefined,
): PaidRule {
  const rule = declared?.sales ?? 'unknown';
  const sampled = sampleIncludes(sample);
  if (rule === 'included') return { rule, unstated: 'included' };
  if (rule === 'per_row') return { rule, unstated: sampled ? 'included' : 'unknown' };
  return sampled
    ? { rule: 'per_row', unstated: 'included' }
    : { rule: 'unknown', unstated: 'unknown' };
}

/** Whether a source's sales rule tells the added cost of its sales at all (Terms "Level": "whose sales' added cost is known"). */
export const costKnown = (rule: PaidRule | AddedCostRule) =>
  (typeof rule === 'string' ? rule : rule.rule) !== 'unknown';

/** Who paid a row's shipping, as its plug-in stored it. */
export type RowShipping = 'included' | 'buyer' | 'unknown';

export interface PaidRow {
  /** The stored price, in the base currency. */
  price: number;
  shipping?: RowShipping | null;
  /** The buyer's shipping, in the base currency; null: not known. */
  shippingAmount?: number | null;
}

/** A price as paid: the amount, or not known (never zero, never the bare price). */
export type Paid = { known: true; amount: number } | { known: false; amount: null };

const UNKNOWN: Paid = { known: false, amount: null };

/**
 * The price as paid (S36 Terms "As paid": "the stored price, in the base currency, plus what the buyer
 * adds: shipping when the buyer pays it ... Not known is never taken as zero"). C1: "a sale the buyer
 * paid shipping on stays out of the level unless the amount is known".
 */
export function asPaid(row: PaidRow, declared: AddedCostRule | PaidRule): Paid {
  const { rule, unstated } =
    typeof declared === 'string'
      ? { rule: declared, unstated: declared === 'included' ? 'included' : 'unknown' }
      : declared;
  if (!Number.isFinite(row.price) || row.price <= 0) return UNKNOWN;
  if (rule === 'included') return { known: true, amount: row.price };
  if (rule === 'unknown') return UNKNOWN;
  if (row.shipping === 'included') return { known: true, amount: row.price };
  if (row.shipping === 'buyer') {
    const add = row.shippingAmount;
    if (typeof add !== 'number' || !Number.isFinite(add) || add < 0) return UNKNOWN;
    return { known: true, amount: row.price + add };
  }
  return unstated === 'included' ? { known: true, amount: row.price } : UNKNOWN;
}

/**
 * A stored row's shipping as its plug-in wrote it in `raw`: `raw.shipping` (`included`, `buyer` or
 * `unknown`; the one payer field, read by the level and by the stored shipping sample) and
 * `raw.shippingAmount` in the row's currency. An amount counts only in the base currency (no
 * conversion is guessed).
 */
export function rowShipping(
  raw: unknown,
  currency: string | null,
  base: string,
): Pick<PaidRow, 'shipping' | 'shippingAmount'> {
  if (!raw || typeof raw !== 'object') return { shipping: null, shippingAmount: null };
  const r = raw as Record<string, unknown>;
  const shipping =
    r.shipping === 'included' || r.shipping === 'buyer' || r.shipping === 'unknown'
      ? r.shipping
      : null;
  const amount = r.shippingAmount;
  const shippingAmount =
    typeof amount === 'number' && Number.isInteger(amount) && amount >= 0 && currency === base
      ? amount
      : null;
  return { shipping, shippingAmount };
}

// ---------------------------------------------------------------------------------------------
// Level

/** Terms "Level": "the 0.25 quantile ... over the 30 days ending that day ... only with 10 or more". */
export const LEVEL_Q = 0.25;
export const LEVEL_MIN = 10;
/** Terms "Level": 30 days; "With fewer than 10 the window is 90 days, on the same conditions". */
export const LEVEL_WINDOWS = [30, 90] as const;
export type LevelWindow = (typeof LEVEL_WINDOWS)[number];
/** Terms "Young game": "released under 90 days ago". */
export const YOUNG_DAYS = 90;

/** Days covered, `[from, to]` inclusive, `YYYY-MM-DD` (nights and spans, S36 Terms "Covered day"). */
export type CoveredRange = readonly [from: string, to: string];

/** One clean sale as the level reads it. */
export interface LevelSale {
  /** Its sale day in the install's time zone. */
  day: string;
  source: string;
  /** Its condition bucket ('' when none). */
  bucket: string;
  /** As paid (`asPaid`); null: not known. */
  paid: number | null;
}

export interface LevelOptions {
  /** The home market's sources whose sales the rules judge, as candidates to count. */
  sources: readonly string[];
  /**
   * Candidates whose sales' added cost is not known (`costKnown` false): never counted, their sales
   * read as unknown whatever `paid` says (Terms "Level": "whose sales' added cost is known").
   */
  costUnknown?: readonly string[];
  /** The wish's bucket: only sales in exactly this bucket count (better ones are not pooled). */
  bucket: string;
}

export type NoLevelReason = 'not_covered' | 'cost_unknown' | 'too_few';

/** Why a candidate source was not counted on a day: a hole in its window, or its added cost unknown. */
export type LeftOutReason = 'hole' | 'cost_unknown';

/**
 * What a day's level rests on, per source (stored compact: a member is left out when empty). Read
 * over the window counted, or the 90-day window on a day with no level.
 */
interface LevelSources {
  /**
   * The sources counted (Terms "Level": "the page names the sources counted"): whole over the window
   * and with a known added-cost rule; a counted source may have sold nothing in it. Sorted.
   */
  sources: string[];
  /** The candidates left out, each with its reason. */
  left?: Record<string, LeftOutReason>;
  /** A counted `per_row` source's sales left out because their own row does not tell the cost. */
  rowsUnknown?: Record<string, number>;
}

export type LevelDay =
  | ({
      day: string;
      level: number;
      /** Sales counted. */
      n: number;
      window: LevelWindow;
    } & LevelSources)
  | ({
      day: string;
      level: null;
      /** Known as-paid sales of the last 90 days. */
      n: number;
      window: null;
      /** Lowest and highest of those (null: none). */
      low: number | null;
      high: number | null;
      /** Sales of the last 90 days whose added cost is not known (left out). */
      unknownCost: number;
      reason: NoLevelReason;
      /** From which day the sales are whole: the earliest start of a covered run reaching this day. */
      wholeFrom: string | null;
      /** The first day a 30-day window would be whole (`wholeFrom` + 29). */
      wholeOn: string | null;
    } & LevelSources);

const DAY_MS = 86_400_000;
const dayNum = (day: string) => Math.floor(Date.parse(`${day}T00:00:00Z`) / DAY_MS);
const fromNum = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);
const isDay = (d: unknown): d is string =>
  typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && fromNum(dayNum(d)) === d;

/** Ranges sorted and joined where they touch or overlap (invalid ones dropped). */
export function joinRanges(ranges: readonly CoveredRange[]): [string, string][] {
  const valid = ranges
    .filter(([a, b]) => isDay(a) && isDay(b) && a <= b)
    .map(([a, b]): [string, string] => [a, b])
    .toSorted((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  const out: [string, string][] = [];
  for (const r of valid) {
    const last = out.at(-1);
    if (last && dayNum(r[0]) <= dayNum(last[1]) + 1) {
      if (r[1] > last[1]) last[1] = r[1];
    } else out.push(r);
  }
  return out;
}

/** The joined range holding `day`, or null. */
const runOf = (ranges: readonly CoveredRange[], day: string) =>
  ranges.find(([a, b]) => a <= day && day <= b) ?? null;

/** Terms "Level": a source counts only when "its days in the window are all covered". */
const wholeOver = (ranges: readonly CoveredRange[] | undefined, from: string, to: string) => {
  const run = ranges ? runOf(ranges, to) : null;
  return !!run && run[0] <= from;
};

/** Sales sorted by day, per source, for windows read by binary search. */
interface Indexed {
  bySource: Map<string, { days: number[]; paid: (number | null)[] }>;
}

function indexSales(sales: readonly LevelSale[], options: LevelOptions): Indexed {
  const wanted = new Set(options.sources);
  const unknownRule = new Set(options.costUnknown ?? []);
  const bySource = new Map<string, { days: number[]; paid: (number | null)[] }>();
  const rows = sales
    .filter((s) => wanted.has(s.source) && s.bucket === options.bucket && isDay(s.day))
    .toSorted((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  for (const s of rows) {
    const list = bySource.get(s.source) ?? { days: [], paid: [] };
    list.days.push(dayNum(s.day));
    const known = !unknownRule.has(s.source) && s.paid !== null && Number.isFinite(s.paid);
    list.paid.push(known && s.paid! > 0 ? s.paid : null);
    bySource.set(s.source, list);
  }
  return { bySource };
}

/** First index with `days[i] >= n`. */
function lowerBound(days: readonly number[], n: number): number {
  let lo = 0;
  let hi = days.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (days[mid]! < n) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * The sales of `sources` sold in `[from, to]`: known as-paid amounts, how many were not known, and
 * that count per source.
 */
function windowSales(index: Indexed, sources: Iterable<string>, from: number, to: number) {
  const known: number[] = [];
  let unknown = 0;
  const unknownBy: Record<string, number> = {};
  for (const s of sources) {
    const list = index.bySource.get(s);
    if (!list) continue;
    // No look-ahead: only sales of `to` or earlier are read.
    for (let i = lowerBound(list.days, from); i < list.days.length && list.days[i]! <= to; i++) {
      const p = list.paid[i]!;
      if (p === null) {
        unknown++;
        unknownBy[s] = (unknownBy[s] ?? 0) + 1;
      } else known.push(p);
    }
  }
  return { known, unknown, unknownBy };
}

/**
 * The candidates over one window (Terms "Level": "from every source of the home market whose sales'
 * added cost is known and whose days in the window are all covered"): counted, left out with the
 * reason (an unknown added cost first: such a source never counts), and the covered ones whatever
 * their cost (what a known cost would have counted).
 */
function windowSources(
  sources: readonly string[],
  costUnknown: ReadonlySet<string>,
  covered: ReadonlyMap<string, readonly CoveredRange[]>,
  from: string,
  to: string,
) {
  const counted: string[] = [];
  const whole: string[] = [];
  const left: Record<string, LeftOutReason> = {};
  for (const s of sources) {
    const isWhole = wholeOver(covered.get(s), from, to);
    if (isWhole) whole.push(s);
    if (costUnknown.has(s)) left[s] = 'cost_unknown';
    else if (!isWhole) left[s] = 'hole';
    else counted.push(s);
  }
  return { counted, whole, left };
}

/** The stored members of `LevelSources`, empty ones left out (the series stays compact). */
function sourcesPart(
  counted: string[],
  left: Record<string, LeftOutReason>,
  unknownBy: Record<string, number>,
): LevelSources {
  return {
    sources: counted,
    ...(Object.keys(left).length && { left }),
    ...(Object.keys(unknownBy).length && { rowsUnknown: unknownBy }),
  };
}

function levelFrom(
  day: string,
  index: Indexed,
  covered: ReadonlyMap<string, readonly CoveredRange[]>,
  options: LevelOptions,
): LevelDay {
  const d = dayNum(day);
  const sources = [...new Set(options.sources)].toSorted();
  const costUnknown = new Set(options.costUnknown ?? []);
  let anyCovered = false;
  let costStops = false;
  for (const window of LEVEL_WINDOWS) {
    // Terms "Level": "over the 30 days ending that day, from every source of the home market whose
    // sales' added cost is known and whose days in the window are all covered ... only with 10 or
    // more such sales. With fewer than 10 the window is 90 days, on the same conditions".
    const from = addDays(day, -(window - 1));
    const { counted, whole, left } = windowSources(sources, costUnknown, covered, from, day);
    if (!whole.length) continue;
    anyCovered = true;
    const { known, unknownBy } = windowSales(index, counted, dayNum(from), d);
    if (known.length >= LEVEL_MIN) {
      // Terms "Level": "the 0.25 quantile (of single sales, interpolated as Core's quantile is)".
      return {
        day,
        level: quantile(known, LEVEL_Q)!,
        n: known.length,
        window,
        ...sourcesPart(counted, left, unknownBy),
      };
    }
    // Enough sales were there had their added cost been known.
    const all = windowSales(index, whole, dayNum(from), d);
    if (all.known.length + all.unknown >= LEVEL_MIN) costStops = true;
  }
  // Terms "Level": "Otherwise there is no level: the page shows the lowest, the highest and the count
  // of the clean sales of the last 90 days, and from which day they are whole."
  const from90 = addDays(day, -(LEVEL_WINDOWS[1] - 1));
  const { known, unknown } = windowSales(index, sources, dayNum(from90), d);
  const at90 = windowSources(sources, costUnknown, covered, from90, day);
  const starts = sources
    .map((s) => (covered.get(s) ? runOf(covered.get(s)!, day) : null))
    .filter((r): r is CoveredRange => r !== null)
    .map((r) => r[0])
    .toSorted();
  const wholeFrom = starts[0] ?? null;
  return {
    day,
    level: null,
    n: known.length,
    window: null,
    low: known.length ? Math.min(...known) : null,
    high: known.length ? Math.max(...known) : null,
    unknownCost: unknown,
    reason: !anyCovered ? 'not_covered' : costStops ? 'cost_unknown' : 'too_few',
    wholeFrom,
    wholeOn: wholeFrom ? addDays(wholeFrom, LEVEL_WINDOWS[0] - 1) : null,
    ...sourcesPart(
      at90.counted,
      at90.left,
      windowSales(index, at90.counted, dayNum(from90), d).unknownBy,
    ),
  };
}

/** Covered ranges joined per source (`levelOn` and `levelSeries` read them so). */
function joinedCover(covered: ReadonlyMap<string, readonly CoveredRange[]>) {
  return new Map([...covered].map(([s, r]) => [s, joinRanges(r)]));
}

/**
 * The level of `day` (S36 Terms "Level"). `sales`: the item's clean sales (Terms "Clean sale": kept, of
 * one unit, passing the item's rules and the re-check), each by its sale day with its price as paid;
 * `covered`: each source's covered days (Terms "Covered day": nights and spans). A source with a hole
 * in the window is not counted ("whose days in the window are all covered"); a sale counts by its sale
 * day, and only sales of `day` or earlier are read.
 */
export function levelOn(
  day: string,
  sales: readonly LevelSale[],
  covered: ReadonlyMap<string, readonly CoveredRange[]>,
  options: LevelOptions,
): LevelDay {
  return levelFrom(day, indexSales(sales, options), joinedCover(covered), options);
}

/** The level of every day in `[from, to]`, oldest first (`levelOn` for each). */
export function levelSeries(
  from: string,
  to: string,
  sales: readonly LevelSale[],
  covered: ReadonlyMap<string, readonly CoveredRange[]>,
  options: LevelOptions,
): LevelDay[] {
  if (!isDay(from) || !isDay(to) || from > to) return [];
  const index = indexSales(sales, options);
  const cover = joinedCover(covered);
  const out: LevelDay[] = [];
  for (let d = dayNum(from); d <= dayNum(to); d++)
    out.push(levelFrom(fromNum(d), index, cover, options));
  return out;
}

// ---------------------------------------------------------------------------------------------
// Record, young game, change

/** A day's level as the record and the change read it. */
export interface DayLevel {
  day: string;
  level: number | null;
  window: LevelWindow | null;
}

export interface WishRecord {
  level: number;
  day: string;
  window: LevelWindow;
}

/**
 * The day a game's age runs from (Terms "Young game": "released under 90 days ago (from its first
 * clean sale when the release date is unknown)"). A release date that is not a whole day (a month or
 * a year only) is not known to the day: the first clean sale is used.
 */
export function bornOn(
  releaseDate: string | null | undefined,
  firstSaleDay: string | null,
): string | null {
  if (isDay(releaseDate)) return releaseDate;
  return isDay(firstSaleDay) ? firstSaleDay : null;
}

/** A game's age on `day` in days, and whether it is young (Terms "Young game"); null: not known. */
export function youngGame(
  born: string | null,
  day: string,
): { young: boolean; ageDays: number } | null {
  if (!isDay(born) || !isDay(day)) return null;
  const ageDays = dayNum(day) - dayNum(born);
  return { young: ageDays < YOUNG_DAYS, ageDays };
}

/**
 * The record (Terms "Record": "the lowest level of any day, with its date and window. It is computed
 * from the clean sales as they are now, never kept as a running minimum"): the lowest level of the
 * days given (the levels recomputed from today's sales), earliest day on a tie. Days before the game
 * is 90 days old do not count (Terms "Young game"; age unknown: no day counts). Null: no such day.
 */
export function recordOf(days: readonly DayLevel[], born: string | null): WishRecord | null {
  if (!isDay(born)) return null;
  const grown = addDays(born, YOUNG_DAYS);
  let best: WishRecord | null = null;
  for (const d of days) {
    if (d.level === null || d.window === null || d.day < grown) continue;
    if (!best || d.level < best.level || (d.level === best.level && d.day < best.day))
      best = { level: d.level, day: d.day, window: d.window };
  }
  return best;
}

export interface LevelChange {
  from: { day: string; level: number };
  to: { day: string; level: number };
  /** `to` minus `from`, in the base currency. */
  amount: number;
  /** The change as a share of `from`. */
  share: number;
}

/**
 * The level's change over `span` days, ending at the last day given: only when both days have a level
 * (spec W14: "when both days have a level, else null").
 */
export function changeOver(days: readonly DayLevel[], span: number): LevelChange | null {
  const last = days.at(-1);
  if (!last || last.level === null || !isDay(last.day)) return null;
  const then = addDays(last.day, -span);
  const before = days.find((d) => d.day === then);
  if (!before || before.level === null || before.level <= 0) return null;
  const amount = last.level - before.level;
  return {
    from: { day: before.day, level: before.level },
    to: { day: last.day, level: last.level },
    amount,
    share: amount / before.level,
  };
}

// ---------------------------------------------------------------------------------------------
// What W15's page records (tables `wish_estimates`, `item_facts`)

/** An estimate's named risks (spec W15: re-release likely, no longer sold new, limited edition, other). */
export const WISH_RISKS = ['rerelease', 'not_sold_new', 'limited', 'other'] as const;
export type WishRisk = (typeof WISH_RISKS)[number];
/** What an estimate rests on (spec W15). */
export const WISH_ESTIMATE_BASES = ['own_history', 'kind', 'outside', 'research'] as const;
export type WishEstimateBasis = (typeof WISH_ESTIMATE_BASES)[number];
/** A dated fact a person recorded about an item (plan W14). */
export const ITEM_FACT_KINDS = [
  'rerelease',
  'port',
  'price_cut',
  'not_sold_new',
  'digital_sale',
  'other',
] as const;
export type ItemFactKind = (typeof ITEM_FACT_KINDS)[number];
