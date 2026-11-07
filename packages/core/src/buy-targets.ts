// Buy timing targets (requirements S31): Good and Ideal prices, each with a likely date and a
// confidence, from how far similar items fell from this age to their first-year low. Works from
// what was known on the day asked: the item's own prices up to that day, and similar items whose
// whole first year had passed by then. Backtested in the private buy timing backtest before any
// card uses it.
import {
  type DayPrice,
  FULL_YEAR,
  PATTERN_MAX_AGE,
  PATTERN_MIN_ITEMS,
  quantile,
  recentPrice,
  seriesStats,
} from './signals';
import { median } from './market';

/**
 * The share of similar items that fell at least this far: Good is the fall 6 in 10 reached, Ideal
 * the deeper one 3 in 10 reached (the owner's proposal in S31). Good should be more likely than
 * not, while still under today's level; Ideal is a real stretch without being one item's extreme.
 */
export const TARGET_SHARES = { good: 0.6, ideal: 0.3 } as const;
/** Fewer similar items than this give no target: a quantile of one or two is that item's own fall. */
export const TARGET_MIN_ITEMS = PATTERN_MIN_ITEMS;
/** Fewer similar items than this read "rough" (S31); it is also what a set line needs to be used. */
export const TARGET_ROUGH_UNDER = 5;
/** A sale this long before the release date says the date is wrong, not that it sold early. */
export const WRONG_AGE_EARLY_DAYS = 30;

/** The ±7 days of the typical price: a first year's end is known 7 days after day 365. */
const WINDOW = 7;

const DAY = 86_400_000;
const dayNumber = (day: string) => Math.floor(Date.parse(`${day.slice(0, 10)}T00:00:00Z`) / DAY);
const dayText = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);

/** One item's condition: its daily prices per source. A release date is real, never a first sale. */
export interface TargetItem {
  id: string;
  release: string;
  line: string | null;
  sources: DayPrice[][];
}

export interface TargetRow {
  /** The share of similar items it stands for (`TARGET_SHARES`). */
  share: number;
  /** The fall from today's price: negative, or 0 when similar items did not fall that far. */
  fall: number;
  price: number;
  /** Median days the similar items that reached this fall took to reach it. */
  days: number;
  date: string;
  /** Of the similar items, how many reached it by that many days. */
  confidence: number;
  /** Of the similar items, how many reached it within their first year. */
  reachedInYear: number;
}

export interface TargetStudy {
  items: number;
  /** The item's set line when it has enough items at this age, else null (the whole group). */
  line: string | null;
  good: Omit<TargetRow, 'price' | 'date'> | null;
  ideal: Omit<TargetRow, 'price' | 'date'> | null;
}

export interface Targets {
  ageDays: number;
  /** The typical price of the last week; null with fewer than 2 days of sales in it. */
  price: number | null;
  /** Today's level as Buy timing reads it from the series (30-day median, else 90). */
  fair: number | null;
  items: number;
  line: string | null;
  rough: boolean;
  good: TargetRow | null;
  ideal: TargetRow | null;
}

/** A sale well before the release date, in any source: the date cannot be right. */
export function ageLooksWrong(release: string, sources: DayPrice[][]): boolean {
  const limit = dayNumber(release) - WRONG_AGE_EARLY_DAYS;
  return sources.some((s) => s.some((p) => dayNumber(p.day) < limit));
}

/** The index of the source with the most days up to `lastDay` (a day number); -1 with no days. */
function sourceUpTo(sources: DayPrice[][], lastDay: number): number {
  let best = -1;
  let most = 0;
  sources.forEach((s, i) => {
    const days = s.filter((p) => dayNumber(p.day) <= lastDay).length;
    if (days > most) {
      best = i;
      most = days;
    }
  });
  return best;
}

/** The source an item's price is read from on a day: chosen only from what was known by then. */
export const sourceAsOf = (sources: DayPrice[][], asOf: string): number =>
  sourceUpTo(sources, dayNumber(asOf));

/** That source's days up to `lastDay`. */
function pickUpTo(sources: DayPrice[][], lastDay: number): DayPrice[] {
  const best = sourceUpTo(sources, lastDay);
  return best < 0 ? [] : sources[best]!.filter((p) => dayNumber(p.day) <= lastDay);
}

// An item's typical price per age in its first year, worked out once per item (the first year is
// fixed once it has passed, so this reads nothing later than day 372).
const firstYears = new WeakMap<TargetItem, (number | null)[] | 'none'>();

/**
 * An item's typical price (median of ±7 days, 2+ days with sales, as `typicalLowDrop`) per age 0-365,
 * or null when it cannot serve as a similar item: the date looks wrong, or its prices stop before day
 * 300. Unlike `typicalLowAge` a first month of prices is not needed: only the fall from the age asked
 * counts, and collecting began after many items came out.
 */
export function firstYearPrices(item: TargetItem): (number | null)[] | null {
  const saved = firstYears.get(item);
  if (saved) return saved === 'none' ? null : saved;
  const release = dayNumber(item.release);
  const series = pickUpTo(item.sources, release + PATTERN_MAX_AGE + WINDOW);
  const days = series.map((p) => ({ age: dayNumber(p.day) - release, price: p.price }));
  const lastAge = days.at(-1)?.age ?? -1;
  if (ageLooksWrong(item.release, item.sources) || lastAge < FULL_YEAR.to) {
    firstYears.set(item, 'none');
    return null;
  }
  const out: (number | null)[] = [];
  for (let age = 0; age <= PATTERN_MAX_AGE; age++) {
    const near = days.filter((d) => Math.abs(d.age - age) <= WINDOW).map((d) => d.price);
    out.push(near.length >= 2 ? median(near) : null);
  }
  firstYears.set(item, out);
  return out;
}

/** What similar items did from this age on, from those whose first year had passed by `asOf`. */
function studyOf(age: number, members: TargetItem[], asOf: string): Omit<TargetStudy, 'line'> {
  const today = dayNumber(asOf);
  const paths: { start: number; year: (number | null)[]; fall: number }[] = [];
  for (const m of members) {
    if (dayNumber(m.release) + PATTERN_MAX_AGE + WINDOW > today) continue;
    const year = firstYearPrices(m);
    const start = year?.[age];
    if (!year || !start) continue;
    const later = year.slice(age).filter((p) => p !== null);
    paths.push({ start, year, fall: Math.min(...later) / start - 1 });
  }
  if (paths.length < TARGET_MIN_ITEMS) return { items: paths.length, good: null, ideal: null };
  const falls = paths.map((p) => p.fall);
  const row = (share: number): Omit<TargetRow, 'price' | 'date'> => {
    const fall = quantile(falls, share)!;
    const reach: number[] = [];
    for (const { start, year } of paths) {
      const limit = start * (1 + fall) + 1e-6;
      const at = year.findIndex((p, a) => a >= age && p !== null && p <= limit);
      if (at >= 0) reach.push(at - age);
    }
    const days = Math.round(median(reach)!);
    return {
      share,
      fall,
      days,
      confidence: reach.filter((d) => d <= days).length / paths.length,
      reachedInYear: reach.length / paths.length,
    };
  };
  return {
    items: paths.length,
    good: row(TARGET_SHARES.good),
    ideal: row(TARGET_SHARES.ideal),
  };
}

/** The study for an item: its set line when that has enough items at this age, else its whole group. */
export function targetStudy(
  age: number,
  item: Pick<TargetItem, 'id' | 'line'>,
  group: TargetItem[],
  asOf: string,
): TargetStudy {
  const others = group.filter((m) => m.id !== item.id);
  if (item.line) {
    const own = studyOf(
      age,
      others.filter((m) => m.line === item.line),
      asOf,
    );
    if (own.items >= TARGET_ROUGH_UNDER) return { ...own, line: item.line };
  }
  return { ...studyOf(age, others, asOf), line: null };
}

/**
 * Fair, Good and Ideal for an item on a day, or null when the rule has no answer: before its
 * release, or past its first year, or a release date that looks wrong. Prices with no recent sales
 * stay unknown, and then so do the rows; `items` still says what the group holds.
 */
export function buyTargets(item: TargetItem, group: TargetItem[], asOf: string): Targets | null {
  const today = dayNumber(asOf);
  const ageDays = today - dayNumber(item.release);
  if (ageDays < 0 || ageDays > PATTERN_MAX_AGE) return null;
  const known = pickUpTo(item.sources, today);
  const before = item.sources.map((s) => s.filter((p) => dayNumber(p.day) <= today));
  if (ageLooksWrong(item.release, before)) return null;
  const price = recentPrice(known, asOf);
  const fair = known.length ? seriesStats(known, asOf).fair : null;
  const study = targetStudy(ageDays, item, group, asOf);
  const row = (r: TargetStudy['good']): TargetRow | null =>
    r && price !== null
      ? { ...r, price: Math.round(price * (1 + r.fall)), date: dayText(today + r.days) }
      : null;
  return {
    ageDays,
    price,
    fair,
    items: study.items,
    line: study.line,
    rough: study.items < TARGET_ROUGH_UNDER,
    good: row(study.good),
    ideal: row(study.ideal),
  };
}
