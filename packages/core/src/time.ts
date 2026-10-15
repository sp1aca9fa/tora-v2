import { ulid } from 'ulid';

/**
 * The app's time zone (S16 part 5): the admin's, set in Settings > Admin preferences > Time zone.
 * It decides what a day is (daily snapshots, value windows, charts, the collect's "today") and
 * the offset stored times carry. Tora before the setting: Tokyo.
 */
export const DEFAULT_TIME_ZONE = 'Asia/Tokyo';
let zone = DEFAULT_TIME_ZONE;

/** Whether the runtime knows this IANA time zone name. */
export function isTimeZone(name: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name });
    return /\//.test(name) || name === 'UTC';
  } catch {
    return false;
  }
}

/** The app's time zone, as loaded from the settings (`setAppTimeZone`). */
export const appTimeZone = () => zone;

/** Makes `name` the app's time zone (an unknown or missing one: the default). */
export function setAppTimeZone(name: string | null | undefined): void {
  zone = name && isTimeZone(name) ? name : DEFAULT_TIME_ZONE;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
const formatter = (tz: string) => {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(tz, f);
  }
  return f;
};

/** Minutes the zone is ahead of UTC at an instant (negative west of Greenwich). */
export function zoneOffset(date: Date, tz: string = zone): number {
  const t = date.getTime();
  const parts = Object.fromEntries(
    formatter(tz)
      .formatToParts(date)
      .map((p) => [p.type, Number(p.value)]),
  );
  const wall = Date.UTC(
    parts.year!,
    parts.month! - 1,
    parts.day!,
    parts.hour!,
    parts.minute!,
    parts.second!,
  );
  return Math.round((wall - (t - (((t % 1000) + 1000) % 1000))) / 60_000);
}

/** An offset in minutes as ISO text, e.g. `+09:00`, `-04:00`. */
export function offsetText(minutes: number): string {
  const a = Math.abs(minutes);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${minutes < 0 ? '-' : '+'}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

/**
 * ISO 8601 timestamp in the app's time zone with its offset at that instant, e.g.
 * `2026-10-09T20:15:00.000+09:00`. Every stored time uses it, so its first 10 characters are the
 * app's day, and text sorting is chronological (except the hour a summer time ends).
 */
export function toLocalIso(date: Date = new Date(), tz: string = zone): string {
  const offset = zoneOffset(date, tz);
  return new Date(date.getTime() + offset * 60_000).toISOString().replace('Z', offsetText(offset));
}

/** Calendar date (YYYY-MM-DD) in the app's time zone. */
export function localDate(date: Date = new Date(), tz: string = zone): string {
  return toLocalIso(date, tz).slice(0, 10);
}

/** The same instant as an ISO time with any offset, in the app's time zone. */
export const inAppZone = (iso: string): string => toLocalIso(new Date(iso));

/** The instant a wall time (`HH:MM:SS.mmm`) of a day happens in the app's time zone. */
export function localTime(day: string, time = '00:00:00.000', tz: string = zone): Date {
  const wall = Date.parse(`${day}T${time}Z`);
  if (Number.isNaN(wall)) throw new RangeError(`invalid time: ${day} ${time}`);
  let t = wall - zoneOffset(new Date(wall), tz) * 60_000;
  // Across a summer time change the offset at the guess differs: correct once.
  const offset = zoneOffset(new Date(t), tz);
  t = wall - offset * 60_000;
  return new Date(t);
}

/**
 * Each offset the zone used between two instants, as periods ending at `until` (ms; the last
 * period has none), for converting stored times in SQL.
 */
export function offsetPeriods(
  tz: string,
  from: Date,
  to: Date,
): { until: number | null; offset: number }[] {
  const HOUR = 3_600_000;
  const periods: { until: number | null; offset: number }[] = [];
  let at = from.getTime();
  let offset = zoneOffset(new Date(at), tz);
  for (let t = at + 24 * HOUR; t <= to.getTime() + 24 * HOUR; t += 24 * HOUR) {
    const next = zoneOffset(new Date(t), tz);
    if (next === offset) continue;
    // Find the change within the day, to the minute.
    let lo = t - 24 * HOUR;
    let hi = t;
    while (hi - lo > 60_000) {
      const mid = lo + Math.floor((hi - lo) / 120_000) * 60_000;
      if (zoneOffset(new Date(mid), tz) === offset) lo = mid;
      else hi = mid;
    }
    periods.push({ until: hi, offset });
    offset = next;
    at = hi;
  }
  periods.push({ until: null, offset });
  return periods;
}

export function newId(): string {
  return ulid();
}

/**
 * Timestamp for a `YYYY-MM-DD` date picked in the UI: the current time when it is today,
 * else the start of that day in the app's time zone (keeps same-day events in entry order).
 */
export function localDateToIso(date: string, now: Date = new Date()): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new RangeError(`invalid date: ${date}`);
  return date === localDate(now) ? toLocalIso(now) : toLocalIso(localTime(date));
}
