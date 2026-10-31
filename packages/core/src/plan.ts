// A budget and a date (requirements S13 part 4): for each item, when to buy and at what price,
// from its buy timing (S9) and the person's strategy; the person ticks items and the plan says
// whether they fit the budget and the date.
import { type SignalStats, type StrategyChoice, judge } from './signals';

/** When to buy: now, from a day on (a new release's wait), or once the price comes down. */
export type PlanWhen = 'now' | 'from' | 'under' | 'none';

export interface PlanStep {
  when: PlanWhen;
  /** From this day (a new release's wait ends), for `from`. */
  day: string | null;
  /** The price to pay: today's (or a listing in the zone) for `now`, else the zone's top. */
  price: number | null;
  /** Why: a good price, a new release, falling (the item or its market), above the zone. */
  reason: 'good' | 'new_release' | 'falling' | 'market_falling' | 'above_zone' | 'no_price';
}

const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * An item's step in a plan, from its saved numbers and the person's strategy. `statsDay`: the day
 * the numbers were worked out (up to a few days before `today`), the day their age is on.
 */
export function planStep(
  stats: SignalStats,
  choice: StrategyChoice,
  today: string,
  statsDay = today,
): PlanStep {
  const j = judge(stats, choice);
  const top = j.zone.top;
  if (stats.fair === null) return { when: 'none', day: null, price: null, reason: 'no_price' };
  if (j.newRelease && stats.ageDays !== null) {
    const from = addDays(statsDay, j.waitDays - stats.ageDays);
    return {
      when: 'from',
      // Numbers a few days old may put the day in the past: from today then.
      day: from < today ? today : from,
      price: top,
      reason: 'new_release',
    };
  }
  if (j.verdict === 'good') {
    const price = j.askInZone && stats.ask !== null ? Math.min(stats.ask, stats.fair) : stats.fair;
    return { when: 'now', day: today, price, reason: 'good' };
  }
  if (j.verdict === 'wait') {
    return {
      when: 'under',
      day: null,
      price: top,
      reason: j.marketFalling && !j.cheapSteady && !j.falling ? 'market_falling' : 'falling',
    };
  }
  return top === null
    ? { when: 'none', day: null, price: null, reason: 'no_price' }
    : { when: 'under', day: null, price: top, reason: 'above_zone' };
}

/** A day's month's last day (S27, a monthly plan runs to it). */
export function monthEnd(day: string): string {
  const [y, m] = day.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/**
 * A monthly plan (S27): what is left of the month's amount once its purchases are counted, and
 * the ticked keys still to buy. Keys bought this month (`productId|bucket`, and `productId|` for
 * any condition) are in what was spent: not counted again, nor offered to a mix or a swap.
 */
export function monthlyRoom(
  amount: number,
  spent: number,
  bought: ReadonlySet<string>,
  ticked: Iterable<string>,
): { room: number; toBuy: string[] } {
  return { room: amount - spent, toBuy: [...ticked].filter((k) => !bought.has(k)) };
}

/** The ticked items against the budget and the date. */
export interface PlanCheck {
  total: number;
  /** Budget left (negative: over). */
  left: number;
  /** Items whose day is after the date, and items with no day (a price to wait for). */
  late: number;
  undated: number;
  /** Items without a price (left out of the total). */
  unpriced: number;
}

export function checkPlan(
  steps: (PlanStep & { units?: number })[],
  budget: number,
  until: string,
): PlanCheck {
  let total = 0;
  let late = 0;
  let undated = 0;
  let unpriced = 0;
  for (const s of steps) {
    if (s.price === null) unpriced++;
    else total += s.price * (s.units ?? 1);
    if (s.when === 'from' && s.day !== null && s.day > until) late++;
    if (s.when === 'under' || s.when === 'none') undated++;
  }
  return { total, left: budget - total, late, undated, unpriced };
}

/** An item a suggested mix can pick (S27): its step, what it is, how good an opportunity. */
export interface MixOption {
  key: string;
  step: PlanStep;
  /** Its item type and set (or group): a mix spreads over both. */
  type: string;
  set: string;
  /** Worth a look (proven signals outweighing warnings), its score, and a watch of the person's. */
  worth: boolean;
  score: number;
  watched: boolean;
}

/** A balanced mix (S27): no item over this share of the budget, one item per set. */
export const MIX_MAX_SHARE = 0.4;

/** Best first: worth a look, buyable now (then from a day), then by score, then watched. */
function mixRank(a: MixOption, b: MixOption): number {
  const when = { now: 0, from: 1, under: 2, none: 3 };
  return (
    Number(b.worth) - Number(a.worth) ||
    when[a.step.when] - when[b.step.when] ||
    b.score - a.score ||
    Number(b.watched) - Number(a.watched) ||
    a.key.localeCompare(b.key)
  );
}

/**
 * Whether an option can go in a mix at all: a reason to buy it (worth a look, or watched; a good
 * price alone is not one), a price within the share, a day by the date. An item to wait for comes
 * in at its buy zone's top.
 */
function mixable(o: MixOption, budget: number, until: string | null): boolean {
  if (!o.worth && !o.watched) return false;
  if (o.step.price === null || o.step.when === 'none') return false;
  if (o.step.price > budget * MIX_MAX_SHARE) return false;
  return !(until && o.step.when === 'from' && o.step.day !== null && o.step.day > until);
}

/**
 * A varied mix within a budget (S27, "spend a budget well"): first the best option of each item
 * type (so more than one type when the budget allows), then the next best of any type, never two
 * of one set nor one item over 40 % of the budget. Only items with a reason to buy (worth a look,
 * watched) come in; those to wait for at their buy zone's top. Returns the keys picked, best
 * first.
 */
export function suggestMix(options: MixOption[], budget: number, until: string | null): string[] {
  const ranked = options.filter((o) => mixable(o, budget, until)).sort(mixRank);
  const picked: MixOption[] = [];
  let left = budget;
  const fits = (o: MixOption) =>
    o.step.price! <= left && !picked.some((p) => p.set === o.set || p.key === o.key);
  const take = (o: MixOption) => {
    picked.push(o);
    left -= o.step.price!;
  };
  for (const type of [...new Set(ranked.map((o) => o.type))]) {
    const best = ranked.find((o) => o.type === type && fits(o));
    if (best) take(best);
  }
  for (const o of ranked) if (fits(o)) take(o);
  return picked.sort(mixRank).map((o) => o.key);
}

/**
 * The next best option for a pick of a mix (S27): one that fits the budget once the pick is out,
 * keeps one item per set, and is not in the mix already; null when none.
 */
export function swapInMix(
  options: MixOption[],
  mix: string[],
  out: string,
  budget: number,
  until: string | null,
): string | null {
  const byKey = new Map(options.map((o) => [o.key, o]));
  const rest = mix.filter((k) => k !== out).flatMap((k) => byKey.get(k) ?? []);
  const left = budget - rest.reduce((sum, o) => sum + (o.step.price ?? 0), 0);
  const gone = byKey.get(out);
  const next = options
    .filter((o) => mixable(o, budget, until) && !mix.includes(o.key))
    .filter((o) => o.step.price! <= left && !rest.some((p) => p.set === o.set))
    .sort(mixRank);
  // Rather another item of the same type, so the mix keeps its spread.
  return (next.find((o) => o.type === gone?.type) ?? next[0])?.key ?? null;
}
