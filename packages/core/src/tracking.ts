// The board tracker's working hours (S25, user 2026-10-26): a store feed reads its boards within
// hours an admin sets, not around the clock. Each day starts a little after the start and stops a
// little before the end, by a delay drawn per day within the admin's range, so it never starts or
// stops on the minute. An admin may track outside the hours once: for an hour, or until the next
// start.
import { localDate, localTime, toLocalIso } from './time';

export interface TrackingHours {
  /** Local times ("09:00", "21:00"); `to` before `from` passes midnight. */
  from: string;
  to: string;
  /** The delay range, in seconds: the start comes this much later, the stop this much earlier. */
  minDelay: number;
  maxDelay: number;
}

/** Tracking outside the hours, once, as an admin asked. */
export interface TrackingOverride {
  kind: 'hour' | 'untilStart';
  /** When it was asked, and until when it tracks (ISO times). */
  at: string;
  until: string;
}

export interface TrackingSettings {
  /** null: no hours, the feed tracks around the clock. */
  hours: TrackingHours | null;
  override?: TrackingOverride | null;
}

export const DEFAULT_TRACKING_HOURS: TrackingHours = {
  from: '09:00',
  to: '21:00',
  minDelay: 60,
  maxDelay: 300,
};

/** The longest delay an admin can set (an hour). */
export const MAX_TRACKING_DELAY = 3600;

export interface TrackingState {
  on: boolean;
  /** Why: no hours set, within the hours, or an admin's hour or tracking until the start. */
  why: 'always' | 'hours' | 'hour' | 'untilStart' | 'outside';
  /** While on: when it stops (null: never). */
  until: string | null;
  /** While off: when it starts again (null: never, e.g. hours that leave no time). */
  resumeAt: string | null;
  /** When the present stretch (on or off) began, when known. Times are the app's (local ISO). */
  since: string | null;
}

/** A local time as minutes ("21:30" = 1290), or null. */
const minutes = (time: string): number | null => {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** Whether hours are usable: two different local times and a delay range within an hour. */
export function validTrackingHours(h: TrackingHours): boolean {
  const from = minutes(h.from);
  const to = minutes(h.to);
  return (
    from !== null &&
    to !== null &&
    from !== to &&
    Number.isInteger(h.minDelay) &&
    Number.isInteger(h.maxDelay) &&
    h.minDelay >= 0 &&
    h.minDelay <= h.maxDelay &&
    h.maxDelay <= MAX_TRACKING_DELAY
  );
}

/** A number in [0, 1) from a text, the same every time (FNV-1a). */
function unit(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 2 ** 32;
}

/** A day's delay in seconds for its start or stop, drawn once per day within the range. */
function delay(h: TrackingHours, day: string, end: 'start' | 'stop'): number {
  const r = unit(`${day}|${h.from}|${h.to}|${end}`);
  return h.minDelay + Math.floor(r * (h.maxDelay - h.minDelay + 1));
}

const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** A day's tracking stretch (ms), from its start to its stop (the next day when past midnight). */
function dayWindow(h: TrackingHours, day: string): [number, number] | null {
  const start = localTime(day, `${h.from}:00.000`).getTime() + delay(h, day, 'start') * 1000;
  const stopDay = h.to <= h.from ? addDays(day, 1) : day;
  const stop = localTime(stopDay, `${h.to}:00.000`).getTime() - delay(h, day, 'stop') * 1000;
  return stop > start ? [start, stop] : null;
}

/** Whether the feed tracks at a time, until when, or when it starts again. */
export function trackingState(settings: TrackingSettings, now: Date = new Date()): TrackingState {
  const { hours, override } = settings;
  if (!hours) return { on: true, why: 'always', until: null, resumeAt: null, since: null };
  const t = now.getTime();
  const today = localDate(now);
  const stretches: { start: number; stop: number; why: TrackingState['why'] }[] = [];
  for (let n = -1; n <= 2; n++) {
    const w = dayWindow(hours, addDays(today, n));
    if (w) stretches.push({ start: w[0], stop: w[1], why: 'hours' });
  }
  if (override) {
    const start = Date.parse(override.at);
    const stop = Date.parse(override.until);
    if (stop > start) stretches.push({ start, stop, why: override.kind });
  }
  stretches.sort((a, b) => a.start - b.start);
  // Stretches that touch or overlap run as one (an hour asked just before the start runs on).
  const merged: typeof stretches = [];
  for (const s of stretches) {
    const last = merged.at(-1);
    if (last && s.start <= last.stop) last.stop = Math.max(last.stop, s.stop);
    else merged.push({ ...s });
  }
  const iso = (ms: number) => toLocalIso(new Date(ms));
  const current = merged.find((s) => s.start <= t && t < s.stop);
  if (current) {
    // Named by what holds it on now: the hours, else the admin's choice.
    const inHours = stretches.some((s) => s.why === 'hours' && s.start <= t && t < s.stop);
    const why = inHours ? 'hours' : (override?.kind ?? 'hours');
    return { on: true, why, until: iso(current.stop), resumeAt: null, since: iso(current.start) };
  }
  const next = merged.find((s) => s.start > t);
  const before = merged.filter((s) => s.stop <= t).at(-1);
  return {
    on: false,
    why: 'outside',
    until: null,
    resumeAt: next ? iso(next.start) : null,
    since: before ? iso(before.stop) : null,
  };
}

/**
 * What an admin's button asks for, while the feed is off: an hour from now, or until the next
 * start of the hours (then the hours go on as usual). Null when it would change nothing.
 */
export function trackingOverride(
  settings: TrackingSettings,
  kind: TrackingOverride['kind'],
  now: Date = new Date(),
): TrackingOverride | null {
  const state = trackingState(settings, now);
  if (state.on) return null;
  const until = kind === 'hour' ? toLocalIso(new Date(now.getTime() + 3_600_000)) : state.resumeAt;
  if (!until) return null;
  return { kind, at: toLocalIso(now), until };
}
