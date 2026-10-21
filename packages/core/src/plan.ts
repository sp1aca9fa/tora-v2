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

/** An item's step in a plan, from its saved numbers and the person's strategy. */
export function planStep(stats: SignalStats, choice: StrategyChoice, today: string): PlanStep {
  const j = judge(stats, choice);
  const top = j.zone.top;
  if (stats.fair === null) return { when: 'none', day: null, price: null, reason: 'no_price' };
  if (j.newRelease && stats.ageDays !== null) {
    return {
      when: 'from',
      day: addDays(today, j.waitDays - stats.ageDays),
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
      reason: j.marketFalling && !j.falling ? 'market_falling' : 'falling',
    };
  }
  return top === null
    ? { when: 'none', day: null, price: null, reason: 'no_price' }
    : { when: 'under', day: null, price: top, reason: 'above_zone' };
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
