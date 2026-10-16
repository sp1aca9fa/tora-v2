// The activity log (requirements S17): what happened in the app and on the home PC, newest first
// on Settings > Activity. Admins see everything; members see their own entries (their imports).
import { toLocalIso } from '@tora/core';
import { and, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import type { Db } from './client';
import {
  type Activity,
  type ActivityKind,
  type ActivityLevel,
  activity,
  importRows,
  importRuns,
  users,
} from './schema';

export { ACTIVITY_KINDS } from './schema';

export interface ActivityInput {
  kind: ActivityKind;
  action?: string | null;
  level?: ActivityLevel;
  /** Whose entry it is; omitted for the whole app. */
  userId?: string | null;
  /** Who did it; omitted for the home PC and the terminal. */
  actorId?: string | null;
  detail?: Record<string, unknown>;
  href?: string | null;
  occurredAt?: string;
}

export async function recordActivity(db: Db, input: ActivityInput): Promise<string> {
  const [row] = await db
    .insert(activity)
    .values({
      kind: input.kind,
      action: input.action ?? null,
      level: input.level ?? 'ok',
      userId: input.userId ?? null,
      actorId: input.actorId ?? null,
      detail: input.detail ?? {},
      href: input.href ?? null,
      occurredAt: input.occurredAt ?? toLocalIso(),
    })
    .returning({ id: activity.id });
  return row!.id;
}

/**
 * Records an admin's change to a whole-app setting (the audit log). Never fails the change it
 * describes.
 */
export async function recordAdminChange(
  db: Db,
  actorId: string | null,
  action: string,
  detail: Record<string, unknown> = {},
  href: string | null = null,
): Promise<void> {
  try {
    await recordActivity(db, { kind: 'admin', action, actorId, detail, href });
  } catch (error) {
    console.error(`activity: ${action} not recorded`, error);
  }
}

/** An import's entry, once it finished: what happened to its rows (from the import log). */
export async function recordImport(db: Db, runId: string): Promise<void> {
  const [run] = await db.select().from(importRuns).where(eq(importRuns.id, runId));
  if (!run) return;
  const rows = await db
    .select({ outcome: importRows.outcome, n: sql<number>`count(*)` })
    .from(importRows)
    .where(eq(importRows.importRunId, runId))
    .groupBy(importRows.outcome);
  const outcomes = Object.fromEntries(rows.map((r) => [r.outcome, Number(r.n)]));
  await recordActivity(db, {
    kind: 'import',
    action: run.method,
    level: outcomes.problem ? 'problem' : 'ok',
    userId: run.userId,
    actorId: run.userId,
    detail: { runId, source: run.source, outcomes, counts: run.counts },
    href: `/imports/runs/${runId}`,
    occurredAt: run.finishedAt ?? undefined,
  });
}

export type ActivityEntry = Activity & { actor: string | null };

/**
 * A page of the log for `viewer`, newest first; `before` continues from the last entry shown.
 */
export async function listActivity(
  db: Db,
  viewer: { id: string; admin: boolean },
  options: { before?: string | null; limit?: number; kind?: ActivityKind | null } = {},
): Promise<ActivityEntry[]> {
  const limit = options.limit ?? 50;
  const rows = await db
    .select({ entry: activity, actor: users.username })
    .from(activity)
    .leftJoin(users, eq(users.id, activity.actorId))
    .where(
      and(
        viewer.admin ? undefined : eq(activity.userId, viewer.id),
        options.kind ? eq(activity.kind, options.kind) : undefined,
        options.before ? lt(activity.occurredAt, options.before) : undefined,
      ),
    )
    .orderBy(desc(activity.occurredAt))
    .limit(limit);
  return rows.map((r) => ({ ...r.entry, actor: r.actor }));
}

/** The newest entry of a kind (the whole app's), e.g. the last collect. */
export async function lastActivity(
  db: Db,
  kind: ActivityKind,
  filter: { level?: ActivityLevel; action?: string } = {},
): Promise<Activity | null> {
  const [row] = await db
    .select()
    .from(activity)
    .where(
      and(
        eq(activity.kind, kind),
        filter.level ? eq(activity.level, filter.level) : undefined,
        filter.action ? eq(activity.action, filter.action) : undefined,
      ),
    )
    .orderBy(desc(activity.occurredAt))
    .limit(1);
  return row ?? null;
}

/** Entries not alerted yet, of the whole app or of one person, since `since`. */
export async function unalerted(
  db: Db,
  filter: { kind: ActivityKind; userId?: string | null; since: string },
): Promise<Activity[]> {
  return db
    .select()
    .from(activity)
    .where(
      and(
        eq(activity.kind, filter.kind),
        filter.userId === undefined
          ? undefined
          : filter.userId === null
            ? isNull(activity.userId)
            : eq(activity.userId, filter.userId),
        isNull(activity.alertedAt),
        gte(activity.occurredAt, filter.since),
      ),
    )
    .orderBy(activity.occurredAt);
}

export async function markAlerted(db: Db, ids: string[], at = toLocalIso()): Promise<void> {
  for (const id of ids) {
    await db.update(activity).set({ alertedAt: at, updatedAt: at }).where(eq(activity.id, id));
  }
}
