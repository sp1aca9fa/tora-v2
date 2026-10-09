import { ulid } from 'ulid';

export const USER_TIME_ZONE = 'Asia/Tokyo';
const TOKYO_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * ISO 8601 timestamp in Asia/Tokyo with an explicit offset, e.g. `2026-10-09T20:15:00.000+09:00`.
 * Japan has no DST, so a fixed +09:00 is exact. A fixed offset also keeps text sorting chronological.
 */
export function toTokyoIso(date: Date = new Date()): string {
  const shifted = new Date(date.getTime() + TOKYO_OFFSET_MS);
  return shifted.toISOString().replace('Z', '+09:00');
}

/** Calendar date (YYYY-MM-DD) in Asia/Tokyo. */
export function tokyoDate(date: Date = new Date()): string {
  return toTokyoIso(date).slice(0, 10);
}

export function newId(): string {
  return ulid();
}

/**
 * Timestamp for a `YYYY-MM-DD` date picked in the UI: the current time when it is today,
 * else the start of that day in Tokyo (keeps same-day events in entry order).
 */
export function tokyoDateToIso(date: string, now: Date = new Date()): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new RangeError(`invalid date: ${date}`);
  return date === tokyoDate(now) ? toTokyoIso(now) : `${date}T00:00:00.000+09:00`;
}
