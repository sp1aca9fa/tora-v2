// The spread check (requirements S27 step 6): how a collection's value is spread over item types,
// franchises, sets, eras and price levels, which groups hold too much of it, and which hold little.

export const SPREAD_DIMENSIONS = ['type', 'franchise', 'set', 'era', 'price'] as const;
export type SpreadDimension = (typeof SPREAD_DIMENSIONS)[number];

/** A group holding this share of the value or more is heavy (not franchises: one is normal). */
export const SPREAD_HEAVY_SHARE = 0.5;
/** One item holding this share or more is heavy. */
export const SPREAD_HEAVY_ITEM = 0.2;
/** A group under this share is held little. */
export const SPREAD_LITTLE_SHARE = 0.05;

export interface SpreadLot {
  productId: string;
  /** The lot's value (market, or cost when it has none) and its units. */
  value: number;
  units: number;
  /** Its groups; null for unknown. */
  type: string;
  franchise: string | null;
  set: string | null;
  /** Release day (`YYYY-MM-DD` or a year), for the era. */
  released: string | null;
}

export interface SpreadGroup {
  key: string;
  value: number;
  share: number;
  heavy: boolean;
}

export interface Spread {
  total: number;
  dimensions: Record<SpreadDimension, SpreadGroup[]>;
  /** Items holding a heavy share on their own, biggest first. */
  heavyItems: { productId: string; value: number; share: number }[];
}

/** A release year's era: before 2016, 2016-2019, 2020-2022, then each year; '' unknown. */
export function eraOf(released: string | null): string {
  const year = Number(released?.slice(0, 4));
  if (!Number.isInteger(year) || year < 1900) return '';
  if (year < 2016) return 'before2016';
  if (year < 2020) return '2016-2019';
  if (year < 2023) return '2020-2022';
  return String(year);
}

/**
 * A unit's price level, in the base currency's smallest unit (a yen, a cent): under 1,000, under
 * 10,000, under 100,000, more. Powers of ten keep the bands alike across currencies.
 */
export function priceLevelOf(unitValue: number): string {
  if (unitValue < 1_000) return 'lt1k';
  if (unitValue < 10_000) return 'lt10k';
  if (unitValue < 100_000) return 'lt100k';
  return 'gte100k';
}

function keyOf(lot: SpreadLot, dimension: SpreadDimension): string {
  switch (dimension) {
    case 'type':
      return lot.type;
    case 'franchise':
      return lot.franchise ?? '';
    case 'set':
      return lot.set ?? '';
    case 'era':
      return eraOf(lot.released);
    case 'price':
      return priceLevelOf(lot.units > 0 ? lot.value / lot.units : lot.value);
  }
}

/** The collection's spread: each dimension's groups, biggest first; heavy groups and items. */
export function spreadOf(lots: readonly SpreadLot[]): Spread {
  const counted = lots.filter((l) => l.value > 0);
  const total = counted.reduce((sum, l) => sum + l.value, 0);
  const share = (value: number) => (total > 0 ? value / total : 0);
  const sum = (key: (l: SpreadLot) => string) => {
    const by = new Map<string, number>();
    for (const l of counted) by.set(key(l), (by.get(key(l)) ?? 0) + l.value);
    return [...by].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  };
  const dimensions = Object.fromEntries(
    SPREAD_DIMENSIONS.map((d) => [
      d,
      sum((l) => keyOf(l, d)).map(([key, value]) => ({
        key,
        value,
        share: share(value),
        // An unknown group is not a concentration of anything.
        heavy: d !== 'franchise' && key !== '' && share(value) >= SPREAD_HEAVY_SHARE,
      })),
    ]),
  ) as Record<SpreadDimension, SpreadGroup[]>;
  const heavyItems = sum((l) => l.productId)
    .map(([productId, value]) => ({ productId, value, share: share(value) }))
    // One item alone is not a spread to judge.
    .filter((i) => i.share >= SPREAD_HEAVY_ITEM && i.share < 1);
  return { total, dimensions, heavyItems };
}

/**
 * Groups held little (under 5 % of the value, or none) with items worth a look in them, most
 * worth a look first.
 */
export function heldLittle(
  groups: readonly SpreadGroup[],
  worth: ReadonlyMap<string, number>,
): { key: string; share: number; worth: number }[] {
  const share = new Map(groups.map((g) => [g.key, g.share]));
  return [...worth]
    .filter(([key, n]) => key !== '' && n > 0 && (share.get(key) ?? 0) < SPREAD_LITTLE_SHARE)
    .map(([key, n]) => ({ key, share: share.get(key) ?? 0, worth: n }))
    .sort((a, b) => b.worth - a.worth || a.key.localeCompare(b.key));
}
