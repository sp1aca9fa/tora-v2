import { localDate, toLocalIso } from './time';

/*
 * Daytime reads of a marketplace beyond the nightly collect (read-backs, deep reads, tracked games,
 * monthly pages) run as jobs under one daily ceiling per marketplace (requirements S36 B4).
 * Every number here is a starting value of that rule ("to start"); the number per day never rises
 * on its own: only a refusal (halves it) and an admin's restart (sets the floor) change it.
 */

/** Requests a marketplace may get per day from jobs, to start (S36 B4: "at most 200 a day"). */
export const MARKET_PER_DAY = 200;
/** The lowest number a refusal halves to; a refusal at it stops the marketplace (S36 B4). */
export const MARKET_FLOOR = 25;
/** Pause between two job requests, to start (S36 B4: "one request every 10 to 20 seconds"). */
export const MARKET_PACE = { minDelayMs: 10_000, maxDelayMs: 20_000 } as const;
/** Hours jobs may run, in the install's time zone, end excluded (S36 B4: "05:00 to 22:00"). */
export const MARKET_HOURS = { from: 5, to: 22 } as const;
/** Wait after a refusal before the halved number applies, to start (S36 B4: "wait 3 days"). */
export const MARKET_WAIT_MS = 72 * 3_600_000;

/** Job kinds in the order they run (S36 B4): read-backs and deep reads of wishes, tracked games, monthly. */
export const MARKET_JOB_KINDS = [
  'readback',
  'deep',
  'tracked_weekly',
  'tracked_deep',
  'monthly',
] as const;
export type MarketJobKind = (typeof MARKET_JOB_KINDS)[number];
export const MARKET_JOB_STATUSES = ['waiting', 'running', 'done', 'stopped'] as const;
export type MarketJobStatus = (typeof MARKET_JOB_STATUSES)[number];

export const isMarketJobKind = (kind: string): kind is MarketJobKind =>
  (MARKET_JOB_KINDS as readonly string[]).includes(kind);

/** Whether `now` is inside the jobs' hours in the zone (the app's, as the collect uses it). */
export function insideHours(now: Date, zone: string): boolean {
  const hour = Number(toLocalIso(now, zone).slice(11, 13));
  return hour >= MARKET_HOURS.from && hour < MARKET_HOURS.to;
}

/**
 * A marketplace's state after a refusal at `at` (S36 B4): wait 3 days, then half the number,
 * never under the floor; refused at the floor (or with no known number): stopped until an admin
 * restarts it.
 */
export function afterRefusal(
  perDay: number | null,
  at: Date,
): { perDay: number; waitUntil: Date | null; stopped: boolean } {
  if (perDay == null || perDay <= MARKET_FLOOR)
    return {
      perDay: Math.min(perDay ?? MARKET_FLOOR, MARKET_FLOOR),
      waitUntil: null,
      stopped: true,
    };
  return {
    perDay: Math.max(MARKET_FLOOR, Math.floor(perDay / 2)),
    waitUntil: new Date(at.getTime() + MARKET_WAIT_MS),
    stopped: false,
  };
}

type QueuedJob = { kind: string; createdAt: string; id: string; failures: number };

/**
 * Run order within a marketplace (S36 B4, and the error rule of the W10 review): jobs that did not
 * fail first, by kind, then oldest first (by instant), then id; then the failing ones (`failures`:
 * failed steps since the last saved one), fewer failures first, then oldest, then id. So a job
 * that keeps failing never holds the queue.
 */
export function compareJobs(a: QueuedJob, b: QueuedJob): number {
  const rank = (k: string) => {
    const i = (MARKET_JOB_KINDS as readonly string[]).indexOf(k);
    return i < 0 ? MARKET_JOB_KINDS.length : i;
  };
  const failing = Number(a.failures > 0) - Number(b.failures > 0);
  if (failing) return failing;
  return (
    (a.failures > 0 ? a.failures - b.failures : rank(a.kind) - rank(b.kind)) ||
    Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/** Failed steps in a row after which a job is tried at most once a day (W10 review's error rule). */
export const MARKET_FAILURES_DAILY = 5;

/**
 * Whether a job waits for tomorrow: after `MARKET_FAILURES_DAILY` failures in a row it is tried at
 * most once a day in the zone, so it is skipped when its last attempt (`startedAt`) was today. An
 * unreadable or missing last attempt is not today: the job is tried (and its attempt written).
 */
export function skippedToday(
  job: { failures: number; startedAt: string | null },
  now: Date,
  zone: string,
): boolean {
  if (job.failures < MARKET_FAILURES_DAILY || !job.startedAt) return false;
  const last = new Date(job.startedAt);
  return !Number.isNaN(last.getTime()) && localDate(last, zone) === localDate(now, zone);
}

export type MarketStopReason = 'hours' | 'waiting' | 'stopped' | 'unknown' | 'ceiling';

/**
 * Why a marketplace may not get a request now, or null when it may. No state, or a number under
 * the floor (never written by Tora), is 'unknown': it never runs (unknown stays unknown).
 * `waitUntil` is compared as an instant (a time zone change rewrites stored times' text).
 */
export function whyNotRun(
  state: { perDay: number | null; waitUntil: string | null; stopped: boolean } | null,
  used: number,
  now: Date,
  zone: string,
): MarketStopReason | null {
  if (!insideHours(now, zone)) return 'hours';
  if (state?.stopped) return 'stopped';
  if (state?.waitUntil && Date.parse(state.waitUntil) > now.getTime()) return 'waiting';
  if (!state || state.perDay == null || state.perDay < MARKET_FLOOR) return 'unknown';
  if (used >= state.perDay) return 'ceiling';
  return null;
}

/** A job's pace: a plug-in's own pace may only slow it (S36 B4, Core 7). */
export function jobPace(plugin?: { minDelayMs?: number; maxDelayMs?: number }): {
  minDelayMs: number;
  maxDelayMs: number;
} {
  const min = Math.max(MARKET_PACE.minDelayMs, plugin?.minDelayMs ?? 0);
  return {
    minDelayMs: min,
    maxDelayMs: Math.max(MARKET_PACE.maxDelayMs, plugin?.maxDelayMs ?? 0, min),
  };
}
