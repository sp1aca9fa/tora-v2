// Ways of spotting a deal (requirements S32): six views of Worth a look, from an item's saved
// numbers. Each way is on, off or unknown; unknown is neither, so such an item is in no list and
// not counted as off. A way is not a proven signal: it does not rank, and feeds no alert, plan or
// score. collectors/scripts/deal-ways-score.ts reads ways 1, 2, 3 and 6 from here, so the page and
// the measure share the rule.
import {
  type OpportunityNumbers,
  ASK_FLOOR,
  ASK_UNDER,
  QUICK_RISE,
  signalsOn,
} from './opportunities';

export const DEAL_WAYS = [
  'falling_hard',
  'cheap_paused',
  'sales_up',
  'listings_drying',
  'under_market',
  'rising_fast',
] as const;
export type DealWay = (typeof DEAL_WAYS)[number];

/** A way from the address or a client; anything else is no way. */
export const cleanDealWay = (way: unknown): DealWay | null =>
  (DEAL_WAYS as readonly unknown[]).includes(way) ? (way as DealWay) : null;

/** Listings drying up: the count this share or more under its count this many days ago, from 5+. */
export const LISTINGS_DRYING = 0.3;
export const LISTINGS_MIN = 5;
export const LISTINGS_BACK_DAYS = 14;
/** The report nearest that day counts if at most this many days from it. */
export const LISTINGS_GAP_DAYS = 3;

/** An item's listings on its price source and condition: now, and about 14 days ago. */
export interface ListingsThen {
  now: number | null;
  before: number | null;
}

const dayNumber = (day: string) => Date.parse(`${day.slice(0, 10)}T00:00:00Z`) / 86_400_000;

/** The day a report's listings are compared with: `LISTINGS_BACK_DAYS` before the report's own day. */
export const listingsBackFrom = (day: string) =>
  new Date(dayNumber(day) * 86_400_000 - LISTINGS_BACK_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);

/**
 * The count reported nearest `day`, at most `LISTINGS_GAP_DAYS` from it (equally near: the earlier,
 * which never shortens the 14 days); null without one. Rows without a count say nothing.
 */
export function listingsNear(
  rows: readonly { day: string; listings: number | null }[],
  day: string,
): number | null {
  const target = dayNumber(day);
  let best: { gap: number; day: string; listings: number } | null = null;
  for (const r of rows) {
    if (r.listings === null) continue;
    const gap = Math.abs(dayNumber(r.day) - target);
    if (gap > LISTINGS_GAP_DAYS) continue;
    if (!best || gap < best.gap || (gap === best.gap && r.day < best.day)) {
      best = { gap, day: r.day, listings: r.listings };
    }
  }
  return best?.listings ?? null;
}

/** The lowest ask is 15 % to 50 % under the recent price (more is likely something else). */
export const askIsUnder = (ask: { price: number } | null | undefined, price: number | null) =>
  !!ask && !!price && ask.price <= price * ASK_UNDER && ask.price >= price * ASK_FLOOR;

export interface DealWayItem {
  numbers: OpportunityNumbers;
  ask?: { price: number } | null;
  /** Saved from S32 on; data saved before reads unknown. */
  listings?: ListingsThen | null;
}

/** Whether each way is on; null when its numbers are not known. */
export function dealWayStates(item: DealWayItem): Record<DealWay, boolean | null> {
  const n = item.numbers;
  const on = signalsOn(n);
  const l = item.listings;
  return {
    // quick_rise's mirror: the last 14 days 20 %+ under the 60 before.
    falling_hard: n.jump14 == null ? null : n.jump14 <= -QUICK_RISE,
    cheap_paused: n.year == null || n.hold14 == null ? null : on.includes('cheap_steady'),
    sales_up: n.salesBefore == null ? null : on.includes('sales_up'),
    // A known count under 5 cannot dry up: off, not unknown. Compared as a share, so exactly 30 %
    // is not lost to rounding.
    listings_drying:
      l?.now == null || l.before == null
        ? null
        : l.before >= LISTINGS_MIN && (l.before - l.now) / l.before >= LISTINGS_DRYING,
    under_market: !item.ask || !n.price ? null : askIsUnder(item.ask, n.price),
    rising_fast: n.jump14 == null ? null : on.includes('quick_rise'),
  };
}

/** A way's plain record: none has one (collectors' measure), so no value says it does. */
export type DealWayRecord = 'weak_or_mixed' | 'cannot_be_tested';
/** The day of the measure below; nothing here updates it but rerunning that measure. */
export const DEAL_WAYS_TESTED = '2026-11-07';
const WEAK_OR_MIXED: Partial<Record<DealWay, readonly string[]>> = {
  falling_hard: ['card'],
  cheap_paused: ['card'],
  sales_up: ['card', 'sealed'],
  rising_fast: ['card', 'sealed'],
};

/** The record of a way on an item type; a type or way the measure did not read cannot be tested. */
export const dealWayRecord = (way: DealWay, itemType: string): DealWayRecord =>
  WEAK_OR_MIXED[way]?.includes(itemType) ? 'weak_or_mixed' : 'cannot_be_tested';
