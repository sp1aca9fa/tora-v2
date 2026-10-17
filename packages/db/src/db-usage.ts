// The hosted database's month so far (requirements S19): rows read and written as counted by
// `UsageMeter`, the admin's budget, and the daily check that alerts admins when the month heads
// past it.
import { and, desc, gte, lt } from 'drizzle-orm';
import { lastActivity, recordActivity } from './activity';
import type { Db } from './client';
import { readSetting, saveSetting } from './registry';
import { dbUsage } from './schema';

/** Turso's free plan per month. */
export const FREE_ROWS_READ = 500_000_000;
export const FREE_ROWS_WRITTEN = 10_000_000;
/** Rows read a month before admins are alerted, unless they set another (well under the plan). */
export const DEFAULT_ROWS_READ_BUDGET = 150_000_000;
const BUDGET_KEY = 'dbBudget';
/** Before this day of the month the pace says little: only the total so far is checked. */
const PACE_FROM_DAY = 5;

export interface MonthUsage {
  /** UTC month, like Turso's. */
  month: string;
  read: number;
  written: number;
  /** The month at this month's pace so far. */
  projectedRead: number;
  budget: number;
  byOrigin: { origin: string; read: number; written: number }[];
  days: { day: string; read: number; written: number }[];
}

export async function rowsReadBudget(db: Db): Promise<number> {
  const saved = await readSetting<{ rowsRead?: number }>(db, BUDGET_KEY);
  return saved?.rowsRead ?? DEFAULT_ROWS_READ_BUDGET;
}

export async function setRowsReadBudget(db: Db, rowsRead: number): Promise<void> {
  await saveSetting(db, BUDGET_KEY, { rowsRead: Math.max(1, Math.round(rowsRead)) });
}

export async function monthUsage(db: Db, now = new Date()): Promise<MonthUsage> {
  const month = now.toISOString().slice(0, 7);
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const rows = await db
    .select()
    .from(dbUsage)
    .where(and(gte(dbUsage.day, `${month}-01`), lt(dbUsage.day, next.toISOString().slice(0, 10))))
    .orderBy(desc(dbUsage.day));
  const byOrigin = new Map<string, { origin: string; read: number; written: number }>();
  const byDay = new Map<string, { day: string; read: number; written: number }>();
  let read = 0;
  let written = 0;
  for (const r of rows) {
    read += r.rowsRead;
    written += r.rowsWritten;
    const o = byOrigin.get(r.origin) ?? { origin: r.origin, read: 0, written: 0 };
    o.read += r.rowsRead;
    o.written += r.rowsWritten;
    byOrigin.set(r.origin, o);
    const d = byDay.get(r.day) ?? { day: r.day, read: 0, written: 0 };
    d.read += r.rowsRead;
    d.written += r.rowsWritten;
    byDay.set(r.day, d);
  }
  const daysInMonth = new Date(next.getTime() - 86_400_000).getUTCDate();
  const elapsed = (now.getTime() - Date.parse(`${month}-01T00:00:00Z`)) / 86_400_000;
  return {
    month,
    read,
    written,
    projectedRead: elapsed > 0 ? Math.round((read / elapsed) * daysInMonth) : read,
    budget: await rowsReadBudget(db),
    byOrigin: [...byOrigin.values()].sort((a, b) => b.read - a.read),
    days: [...byDay.values()],
  };
}

/**
 * The daily check's part (S17): when the month's rows read are past the budget, or heading past
 * it at this pace (from day 5), records it for admins (once a day). Returns the usage when so.
 */
export async function checkDbBudget(db: Db, now = new Date()): Promise<MonthUsage | null> {
  const usage = await monthUsage(db, now);
  const over =
    usage.read > usage.budget ||
    (now.getUTCDate() >= PACE_FROM_DAY && usage.projectedRead > usage.budget);
  if (!over) return null;
  const said = await lastActivity(db, 'check', { action: 'db_budget' });
  if (said && now.getTime() - Date.parse(said.occurredAt) < 20 * 3_600_000) return null;
  await recordActivity(db, {
    kind: 'check',
    action: 'db_budget',
    level: 'failed',
    detail: { read: usage.read, projected: usage.projectedRead, budget: usage.budget },
    href: '/settings/admin/database',
  });
  return usage;
}
