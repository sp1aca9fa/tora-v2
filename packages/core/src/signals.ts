// Buy timing (requirements S9 part 4): fixed rules on an item's daily prices, every number
// explained in the app. The numbers are saved daily per item and condition (`SignalStats`); each
// person's strategy turns them into a buy zone and a verdict when a page opens.
import { median } from './market';

/** One day's typical price of an item in one condition (the median of that day's sales). */
export interface DayPrice {
  day: string;
  price: number;
  /** Sales that day. */
  count: number;
}

export const STRATEGIES = ['steady', 'bargain', 'margin', 'dip', 'target'] as const;
export type StrategyKey = (typeof STRATEGIES)[number];

export interface StrategyChoice {
  strategy: StrategyKey;
  /** Margin: percent under the usual price (1-50). */
  margin?: number;
}

export const DEFAULT_MARGIN = 10;

/** Tora's suggestion per item type: range zones where prices move, a margin where they barely do. */
export function suggestedStrategy(itemType: string): StrategyChoice {
  return itemType === 'sealed' || itemType === 'card'
    ? { strategy: 'steady' }
    : { strategy: 'margin', margin: DEFAULT_MARGIN };
}

/** Days with sales needed in 180 days for a 180-day range, and in 365 days for a year's. */
export const RANGE_MIN_DAYS = { 180: 10, 365: 20 } as const;
/** A fall this fast over 2 weeks (and still down over 4) means "wait". */
export const FALLING_2W = -0.05;
/** The new-set pattern: how far ahead it looks and how many similar items it needs. */
export const PATTERN_HORIZON = 90;
export const PATTERN_MIN_ITEMS = 3;
/** Similar items needed for the market trend, and the 12-week fall that means "wait". */
export const MARKET_MIN_ITEMS = 5;
export const MARKET_FALLING_12W = -0.15;
/** Items older than this (days since release) are past the new-set pattern. */
export const PATTERN_MAX_AGE = 365;
/**
 * A new release (a real release date) waits until the age at which similar items usually hit
 * their first-year low; this many days when too few similar items have a full first year.
 */
export const NEW_RELEASE_DAYS = 90;
/** A full first year: prices from within this many days of release to at least this age. */
export const FULL_YEAR = { from: 30, to: 300 } as const;

/** What is saved each day per item and condition. Fractions, not percents. */
export interface SignalStats {
  /** Today's fair value (the item's market value); null without one. */
  fair: number | null;
  /** Sales in the last 30 days, days with sales in the last 180 / 365. */
  sales30: number;
  days180: number;
  days365: number;
  /** The usual price: the median of the last 180 days' daily prices (3+ days), else null. */
  usual180: number | null;
  /** Quantiles of the daily prices (null when the range has too few days). */
  q25d180: number | null;
  q75d180: number | null;
  q10d365: number | null;
  /** Share of the last 180 days' daily prices at or above fair value (1: cheapest seen). */
  cheaperThan180: number | null;
  /** Fitted change over the last 2 / 4 / 12 weeks. */
  trend14: number | null;
  trend28: number | null;
  trend84: number | null;
  /** The lowest ask now in this condition, per unit. */
  ask: number | null;
  /** Days since release (S9 part 3's release date), and where that date came from. */
  ageDays: number | null;
  releaseFrom: 'set' | 'item' | 'first_sale' | null;
  /** The item's set line (main expansion, high class pack, ...); missing on older rows. */
  line?: string | null;
  /**
   * The market: the median 12-week change of similar items (5+), e.g. a broad fall. `line`: the
   * study used the item's line only (null or missing: the whole group).
   */
  market: { items: number; change84: number; line?: string | null } | null;
  /** Similar items at this age: their typical change over the next 90 days. */
  pattern: { items: number; change: number; horizonDays: number; line?: string | null } | null;
  /** The age at which similar items usually hit their first-year low (3+ with a full year). */
  lowAge?: { age: number; items: number; line: string | null } | null;
}

const DAY = 86_400_000;
const dayNumber = (day: string) => Math.floor(Date.parse(`${day.slice(0, 10)}T00:00:00Z`) / DAY);

/** Daily medians from sales (`price` per unit), oldest first. */
export function dailyPrices(sales: { day: string; price: number }[]): DayPrice[] {
  const byDay = new Map<string, number[]>();
  for (const s of sales) {
    const d = s.day.slice(0, 10);
    const list = byDay.get(d);
    if (list) list.push(s.price);
    else byDay.set(d, [s.price]);
  }
  return [...byDay]
    .map(([day, prices]) => ({ day, price: median(prices)!, count: prices.length }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

/** The q-quantile (0-1) of a list, interpolated. */
export function quantile(values: readonly number[], q: number): number | null {
  if (values.length === 0) return null;
  const s = values.toSorted((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}

/** The fitted change of log prices over the last `days` (at least 4 days with sales, spread). */
export function fittedChange(series: DayPrice[], end: number, days: number): number | null {
  const pts = series
    .map((p) => ({ x: dayNumber(p.day) - end, y: Math.log(p.price) }))
    .filter((p) => p.x > -days && p.x <= 0);
  if (pts.length < 4) return null;
  const xs = pts.map((p) => p.x);
  if (Math.max(...xs) - Math.min(...xs) < days / 2) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / pts.length;
  const my = pts.reduce((a, p) => a + p.y, 0) / pts.length;
  let num = 0;
  let den = 0;
  for (const p of pts) {
    num += (p.x - mx) * (p.y - my);
    den += (p.x - mx) ** 2;
  }
  if (den === 0) return null;
  return Math.exp((num / den) * days) - 1;
}

/**
 * The numbers of one day (`asOf`) from the daily prices up to it: fair value (given, else the
 * median of the last 30 days' daily prices, else 90), the ranges, where fair value sits, trends.
 */
export function seriesStats(
  series: DayPrice[],
  asOf: string,
  fair?: number | null,
): Omit<SignalStats, 'ask' | 'ageDays' | 'releaseFrom' | 'market' | 'pattern' | 'lowAge'> {
  const end = dayNumber(asOf);
  const within = (days: number) =>
    series.filter((p) => {
      const d = dayNumber(p.day);
      return d <= end && d > end - days;
    });
  const d30 = within(30);
  const d180 = within(180);
  const d365 = within(365);
  const value =
    fair ?? median(d30.map((p) => p.price)) ?? median(within(90).map((p) => p.price)) ?? null;
  const p180 = d180.map((p) => p.price);
  const p365 = d365.map((p) => p.price);
  const enough180 = d180.length >= RANGE_MIN_DAYS[180];
  return {
    fair: value === null ? null : Math.round(value),
    sales30: d30.reduce((n, p) => n + p.count, 0),
    days180: d180.length,
    days365: d365.length,
    usual180: d180.length >= 3 ? Math.round(median(p180)!) : null,
    q25d180: enough180 ? Math.round(quantile(p180, 0.25)!) : null,
    q75d180: enough180 ? Math.round(quantile(p180, 0.75)!) : null,
    q10d365: d365.length >= RANGE_MIN_DAYS[365] ? Math.round(quantile(p365, 0.1)!) : null,
    cheaperThan180:
      value !== null && enough180 ? p180.filter((p) => p >= value).length / p180.length : null,
    trend14: fittedChange(series, end, 14),
    trend28: fittedChange(series, end, 28),
    trend84: fittedChange(series, end, 84),
  };
}

/** The typical price around a day (±7 days), from at least 2 days with sales. */
function priceAround(series: DayPrice[], day: number): number | null {
  const near = series.filter((p) => Math.abs(dayNumber(p.day) - day) <= 7);
  return near.length >= 2 ? median(near.map((p) => p.price)) : null;
}

/**
 * The new-set pattern: how similar items' prices moved from this age (days since their release)
 * to 90 days later. Only items with prices around both ages count, whenever their history starts.
 */
export function newSetPattern(
  ageDays: number,
  others: { release: string; series: DayPrice[] }[],
  asOf: string,
): SignalStats['pattern'] {
  if (ageDays < 0 || ageDays > PATTERN_MAX_AGE) return null;
  const today = dayNumber(asOf);
  const changes: number[] = [];
  for (const o of others) {
    const start = dayNumber(o.release) + ageDays;
    const later = start + PATTERN_HORIZON;
    // Only what had already happened by today.
    if (later + 7 > today) continue;
    const a = priceAround(o.series, start);
    const b = priceAround(o.series, later);
    if (a && b) changes.push(b / a - 1);
  }
  if (changes.length < PATTERN_MIN_ITEMS) return null;
  return { items: changes.length, change: median(changes)!, horizonDays: PATTERN_HORIZON };
}

/**
 * The age (days since release) at which similar items usually hit their first-year low: per item
 * with a full first year (prices from its first month to past day 300, a year ago or more), the
 * age of its lowest typical price (±7 days); the median of 3 or more items.
 */
export function typicalLowAge(
  others: { release: string; series: DayPrice[] }[],
  asOf: string,
): { age: number; items: number } | null {
  const today = dayNumber(asOf);
  const ages: number[] = [];
  for (const o of others) {
    const release = dayNumber(o.release);
    if (release + PATTERN_MAX_AGE + 7 > today) continue;
    const year = o.series
      .map((p) => dayNumber(p.day) - release)
      .filter((age) => age >= 0 && age <= PATTERN_MAX_AGE);
    if (!year.length || year[0]! > FULL_YEAR.from || year.at(-1)! < FULL_YEAR.to) continue;
    let low: { age: number; price: number } | null = null;
    for (const age of year) {
      const price = priceAround(o.series, release + age);
      if (price !== null && (!low || price < low.price)) low = { age, price };
    }
    if (low) ages.push(low.age);
  }
  if (ages.length < PATTERN_MIN_ITEMS) return null;
  return { age: Math.round(median(ages)!), items: ages.length };
}

/** How an item's price moved in its first months: from day 7 to day 97 after release. */
export function earlyChange(release: string, series: DayPrice[]): number | null {
  const start = dayNumber(release) + 7;
  const a = priceAround(series, start);
  const b = priceAround(series, start + PATTERN_HORIZON);
  return a && b ? b / a - 1 : null;
}

export type ZoneBasis = 'quarter180' | 'tenth365' | 'margin' | 'thin_margin';

export interface BuyZone {
  /** At or under this is a good price; null without one (own target only, no fair value). */
  top: number | null;
  basis: ZoneBasis | null;
  /** Lowered by the new-set pattern. */
  pattern: boolean;
}

/** The buy zone of a strategy on a day's numbers. */
export function buyZone(stats: SignalStats, choice: StrategyChoice): BuyZone {
  const none: BuyZone = { top: null, basis: null, pattern: false };
  if (choice.strategy === 'target' || stats.fair === null) return none;
  // Under the usual price (with little data, today's fair value: then only a listing can be in
  // the zone).
  const margin = (pct: number, basis: ZoneBasis): BuyZone => ({
    top: Math.round((stats.usual180 ?? stats.fair!) * (1 - pct / 100)),
    basis,
    pattern: false,
  });
  let zone: BuyZone;
  if (choice.strategy === 'margin') zone = margin(choice.margin ?? DEFAULT_MARGIN, 'margin');
  else if (choice.strategy === 'bargain') {
    zone =
      stats.q10d365 !== null
        ? { top: stats.q10d365, basis: 'tenth365', pattern: false }
        : margin(DEFAULT_MARGIN, 'thin_margin');
  } else {
    zone =
      stats.q25d180 !== null
        ? { top: stats.q25d180, basis: 'quarter180', pattern: false }
        : margin(DEFAULT_MARGIN, 'thin_margin');
  }
  if (stats.pattern && stats.pattern.change < 0 && zone.top !== null) {
    const expected = Math.round(stats.fair * (1 + stats.pattern.change));
    if (expected < zone.top) zone = { ...zone, top: expected, pattern: true };
  }
  return zone;
}

export type Verdict = 'good' | 'wait' | 'fair' | 'high' | 'none';

export interface Judgement {
  verdict: Verdict;
  zone: BuyZone;
  /** Falling fast (2 weeks down over 5 % and 4 weeks down). */
  falling: boolean;
  /** Similar items as a group are down over 15 % in 12 weeks. */
  marketFalling: boolean;
  /**
   * A new release (a real release date) younger than the age similar items usually hit their
   * low at (else 90 days): wait, new releases often drop in their first months.
   */
  newRelease: boolean;
  /** The days that wait lasts (from release). */
  waitDays: number;
  /** Little data: the reasons (shown as a warning). */
  limited: ('few_sales' | 'short_range')[];
  /** The lowest ask is in the zone now. */
  askInZone: boolean;
}

export const isFalling = (s: Pick<SignalStats, 'trend14' | 'trend28'>) =>
  s.trend14 !== null && s.trend14 < FALLING_2W && (s.trend28 === null || s.trend28 < 0);

/** A strategy's verdict on a day's numbers: good price, falling (wait), fair, high. */
export function judge(stats: SignalStats, choice: StrategyChoice): Judgement {
  const zone = buyZone(stats, choice);
  const falling = isFalling(stats);
  const marketFalling = !!stats.market && stats.market.change84 < MARKET_FALLING_12W;
  const limited: Judgement['limited'] = [];
  if (stats.sales30 < 3) limited.push('few_sales');
  if (stats.q25d180 === null) limited.push('short_range');
  const askInZone = zone.top !== null && stats.ask !== null && stats.ask <= zone.top;
  const waitDays = stats.lowAge?.age ?? NEW_RELEASE_DAYS;
  const newRelease =
    stats.ageDays !== null &&
    (stats.releaseFrom === 'set' || stats.releaseFrom === 'item') &&
    stats.ageDays < waitDays;
  const base = { zone, falling, marketFalling, newRelease, waitDays, limited, askInZone };
  if (stats.fair === null) return { verdict: 'none', ...base };
  if (zone.top !== null && stats.fair <= zone.top) {
    // A fall of the item or of its whole market waits, and so does a new release, except for
    // Catch the dip (it warns).
    const wait = (falling || marketFalling || newRelease) && choice.strategy !== 'dip';
    return { verdict: wait ? 'wait' : 'good', ...base };
  }
  if (stats.q75d180 !== null && stats.fair > stats.q75d180) return { verdict: 'high', ...base };
  return { verdict: 'fair', ...base };
}

export interface ReplayResult {
  /** Days the strategy said "good price". */
  calls: string[];
  /** Average fair value on those days, and over every day of the period. */
  avgPaid: number | null;
  avgAll: number | null;
  /** Calls with a price 90 days later, and how many of those were higher then. */
  checked: number;
  higher: number;
}

/**
 * What a strategy would have said each day of the last `days` (rule tests and the "try a
 * strategy" view): each day judged only on the prices up to it (no new-set pattern; with a
 * `release` date, the new-release wait of `waitDays`), and each call checked against the price
 * 90 days later.
 */
export function replay(
  series: DayPrice[],
  choice: StrategyChoice,
  asOf: string,
  days = 365,
  release?: { day: string; waitDays: number },
): ReplayResult {
  const end = dayNumber(asOf);
  const period = series.filter((p) => {
    const d = dayNumber(p.day);
    return d <= end && d > end - days;
  });
  const calls: string[] = [];
  const paid: number[] = [];
  const all: number[] = [];
  let checked = 0;
  let higher = 0;
  for (const p of period) {
    const stats: SignalStats = {
      ...seriesStats(series, p.day),
      ask: null,
      ageDays: release ? dayNumber(p.day) - dayNumber(release.day) : null,
      releaseFrom: release ? 'item' : null,
      market: null,
      pattern: null,
      lowAge: release ? { age: release.waitDays, items: 0, line: null } : null,
    };
    if (stats.fair === null) continue;
    all.push(stats.fair);
    if (judge(stats, choice).verdict !== 'good') continue;
    calls.push(p.day);
    paid.push(stats.fair);
    const later = priceAround(series, dayNumber(p.day) + PATTERN_HORIZON);
    if (later !== null && dayNumber(p.day) + PATTERN_HORIZON + 7 <= end) {
      checked++;
      if (later > stats.fair) higher++;
    }
  }
  const avg = (l: number[]) =>
    l.length ? Math.round(l.reduce((a, b) => a + b, 0) / l.length) : null;
  return { calls, avgPaid: avg(paid), avgAll: avg(all), checked, higher };
}

/** A person's strategy for an item type: their choice, else Tora's suggestion. */
export function strategyOf(
  prefs: { buyStrategy?: { byType: Record<string, StrategyChoice> } } | null | undefined,
  itemType: string,
): StrategyChoice {
  return prefs?.buyStrategy?.byType[itemType] ?? suggestedStrategy(itemType);
}

/** The market trend of a group: the median 12-week change of its items' daily prices. */
export function marketTrend(series: DayPrice[][], asOf: string): SignalStats['market'] {
  const end = dayNumber(asOf);
  const changes = series
    .map((s) => fittedChange(s, end, 84))
    .filter((c): c is number => c !== null);
  if (changes.length < MARKET_MIN_ITEMS) return null;
  return { items: changes.length, change84: median(changes)! };
}
