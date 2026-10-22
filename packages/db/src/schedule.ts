// When things run (Settings > Collectors > Schedule): the server's hourly check
// (scripts/collect-cron.sh) is heard from at each check; from those times, today's collect and
// the last night's collector runs, the next check, the next daily collect and each collector's
// likely start are worked out. The timers themselves are the server's.
import { localDate, localTime, median, toLocalIso } from '@tora/core';
import { desc, gte } from 'drizzle-orm';
import { lastActivity } from './activity';
import type { Db } from './client';
import { collectRequest } from './collect-request';
import { readSetting, saveSetting } from './registry';
import { collectorRuns } from './schema';

const KEY = 'collectChecks';
/** Check times kept (enough to see the interval). */
const KEEP = 6;
const MINUTE = 60_000;

/** Called at each of the server's checks (`pnpm collect:request`). */
export async function recordCheck(db: Db, now = new Date()): Promise<void> {
  const had = (await readSetting<string[]>(db, KEY)) ?? [];
  await saveSetting(db, KEY, [...had, toLocalIso(now)].slice(-KEEP));
}

export interface CollectorSlot {
  source: string;
  /** Last night's run: when it started, how long it took, how it ended. */
  lastStart: string;
  lastMs: number | null;
  status: string;
  /** Likely start in the next daily collect (its start plus last night's offset). */
  nextStart: string | null;
}

export interface CollectSchedule {
  /** The checks heard from: the last one, the interval (minutes), the next one. */
  lastCheck: string | null;
  intervalMinutes: number | null;
  nextCheck: string | null;
  /** No check heard from for over three intervals (the server or its timer stopped). */
  stale: boolean;
  /** Today's collect ran (not failed), and when the next daily collect starts. */
  doneToday: boolean;
  lastCollect: { at: string; level: string } | null;
  nextCollect: string | null;
  /** A "collect now" waiting for the next check. */
  requested: boolean;
  collectors: CollectorSlot[];
}

export async function collectSchedule(db: Db, now = new Date()): Promise<CollectSchedule> {
  const checks = ((await readSetting<string[]>(db, KEY)) ?? []).map((c) => Date.parse(c));
  const gaps = checks.slice(1).map((c, i) => c - checks[i]!);
  // Gaps of a check that ran a collect are longer; the usual one is the smallest common one.
  const interval = gaps.length ? Math.round((median(gaps) ?? 0) / MINUTE) || null : null;
  const last = checks.at(-1) ?? null;
  let next: number | null = null;
  if (last !== null && interval) {
    next = last + interval * MINUTE;
    while (next < now.getTime()) next += interval * MINUTE;
  }
  const stale = last !== null && !!interval && now.getTime() - last > 3 * interval * MINUTE;

  const collect = await lastActivity(db, 'collect');
  const today = localDate(now);
  const doneToday =
    !!collect && localDate(new Date(collect.occurredAt)) === today && collect.level !== 'failed';
  // The daily collect: the first check after midnight once today's ran, else the next check.
  let nextCollect: number | null = next;
  if (doneToday && next !== null && interval) {
    // Midnight in the app's time zone.
    const tomorrow = localTime(localDate(new Date(now.getTime() + 86_400_000))).getTime();
    nextCollect = next;
    while (nextCollect < tomorrow) nextCollect += interval * MINUTE;
  }
  const request = await collectRequest(db);

  // Last night's runs: each source's latest run within a day of the newest, in order.
  const runs = await db
    .select()
    .from(collectorRuns)
    .where(gte(collectorRuns.startedAt, toLocalIso(new Date(now.getTime() - 3 * 86_400_000))))
    .orderBy(desc(collectorRuns.startedAt));
  const newest = runs[0] ? Date.parse(runs[0].startedAt) : null;
  const latest = new Map<string, (typeof runs)[number]>();
  for (const r of runs) {
    if (newest !== null && newest - Date.parse(r.startedAt) > 20 * 3_600_000) continue;
    if (!latest.has(r.source)) latest.set(r.source, r);
  }
  const ordered = [...latest.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const first = ordered[0] ? Date.parse(ordered[0].startedAt) : null;
  return {
    lastCheck: last !== null ? toLocalIso(new Date(last)) : null,
    intervalMinutes: interval,
    nextCheck: next !== null ? toLocalIso(new Date(next)) : null,
    stale,
    doneToday,
    lastCollect: collect ? { at: collect.occurredAt, level: collect.level } : null,
    nextCollect: nextCollect !== null ? toLocalIso(new Date(nextCollect)) : null,
    requested: !!request && !request.takenAt,
    collectors: ordered.map((r) => ({
      source: r.source,
      lastStart: r.startedAt,
      lastMs:
        r.activeMs ?? (r.finishedAt ? Date.parse(r.finishedAt) - Date.parse(r.startedAt) : null),
      status: r.status,
      nextStart:
        nextCollect !== null && first !== null
          ? toLocalIso(new Date(nextCollect + (Date.parse(r.startedAt) - first)))
          : null,
    })),
  };
}
