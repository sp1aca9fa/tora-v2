/*
 * Tracked games (requirements S36 step D; spec wishlist-tracked W17): console games read before
 * anyone wishes for them. The chosen set is read a seventh each night by its slot (the identity
 * shop's prices) and weekly at the marketplaces (a read back 2 weeks); the rest at one page a month
 * once an admin turns it on. Every number here is a starting value ("to start").
 */

/** A tracked game's tier: the chosen set (weekly) or the rest (one page a month). */
export const TRACKED_TIERS = ['chosen', 'rest'] as const;
export type TrackedTier = (typeof TRACKED_TIERS)[number];
/**
 * A tracked row's stored tier: a tier, or `removed` (fix round 1, F1): no longer tracked, kept as a
 * mark so the nightly collect keeps leaving the game out while no one holds or wishes it (its auto
 * searches stay; an inactive link would never be made again for a later wish).
 */
export const TRACKED_STORED_TIERS = [...TRACKED_TIERS, 'removed'] as const;
export type TrackedStoredTier = (typeof TRACKED_STORED_TIERS)[number];

/** Nights a chosen game's slot cycles through: a seventh of the set each night (S36 step D). */
export const TRACKED_SLOTS = 7;
/** Lines one paste may add at most (spec wishlist-tracked, Page). */
export const TRACKED_PASTE_MAX = 100;
/** Days between two weekly reads of a chosen game at a marketplace (S36 step D: "weekly"). */
export const TRACKED_WEEKLY_EVERY_DAYS = 7;
/** Days between two monthly pages of a game of the rest (S36 step D: "one page a month"). */
export const TRACKED_MONTHLY_EVERY_DAYS = 30;
/** Requests the identity shop's read of one item takes (S36 A0: "two an item"). */
export const SHOP_REQUESTS_PER_ITEM = 2;
/** Months after release a case's level is read at (spec wishlist-tracked, Cases). */
export const KIND_CASE_MONTHS = [3, 6, 12] as const;

/** The slot whose games are read on `day` (`YYYY-MM-DD`, the app's zone): days since 1970-01-01, mod 7. */
export function slotOfDay(day: string): number {
  const days = Math.floor(Date.parse(`${day.slice(0, 10)}T00:00:00Z`) / 86_400_000);
  return ((days % TRACKED_SLOTS) + TRACKED_SLOTS) % TRACKED_SLOTS;
}

/**
 * The slot a new chosen game takes: the one with the fewest chosen games (ties: the lowest), so
 * the set stays spread evenly. `counts[i]` is slot i's count; a missing count is 0.
 */
export function pickSlot(counts: readonly number[]): number {
  let best = 0;
  for (let i = 1; i < TRACKED_SLOTS; i++) if ((counts[i] ?? 0) < (counts[best] ?? 0)) best = i;
  return best;
}

/**
 * Minutes the nightly collect grows by for `games` chosen games read only on their slot night (S36
 * step D: the count times the shop's pace): a seventh of them a night (rounded up), two requests
 * each, at `msPerRequest` (measured). Null when the pace is unknown; 0 games is 0.
 */
export function nightlyMinutes(games: number, msPerRequest: number | null): number | null {
  if (games <= 0) return 0;
  if (msPerRequest == null || !Number.isFinite(msPerRequest) || msPerRequest <= 0) return null;
  const items = Math.ceil(games / TRACKED_SLOTS);
  return Math.ceil((items * SHOP_REQUESTS_PER_ITEM * msPerRequest) / 60_000);
}

/** `day` moved by whole calendar months (end of month kept: 31 January + 1 month is 28 February). */
export function addMonths(day: string, months: number): string {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7)) - 1 + months;
  const year = y + Math.floor(m / 12);
  const month = ((m % 12) + 12) % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const d = Math.min(Number(day.slice(8, 10)), last);
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
