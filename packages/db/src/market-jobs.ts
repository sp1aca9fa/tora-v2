// Daytime reads of a marketplace (requirements S36 B4): the job queue, each day's count and the
// marketplace's refusal state. The rules (numbers, order, hours) are in @tora/core market-ceiling.
// Only the collector SDK's job runner and an admin's restart write here.
import {
  type JobResult,
  MARKET_FLOOR,
  MARKET_JOB_KINDS,
  MARKET_PER_DAY,
  type MarketJobKind,
  afterRefusal,
  compareJobs,
  isGameItem,
  isMarketJobKind,
  localDate,
  toLocalIso,
} from '@tora/core';
import { and, count, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { lastActivity } from './activity';
import type { Db } from './client';
import { getItemRules } from './item-rules';
import { DomainError } from './mutations';
import {
  type MarketJobRow,
  activity,
  collectorRuns,
  marketDays,
  marketJobs,
  marketState,
  products,
} from './schema';

const ACTIVE = ['waiting', 'running'];
const isActive = inArray(marketJobs.status, ACTIVE);
/** Jobs the runner reads: a `load` (S36 A3) is a stored row only, never picked up or counted. */
const isRunKind = inArray(marketJobs.kind, [...MARKET_JOB_KINDS]);

/** Admin activity actions the refusal alert pass sends (alerts.ts). */
export const MARKET_ALERT_ACTIONS = ['marketRefused', 'marketStopped', 'marketJobsFailed'];

/**
 * Queues a job, or returns the one already waiting or running for that marketplace, item and kind.
 * Jobs are for game items only (S36 Scope rule); `productId` null: a job about no one item (a
 * monthly page).
 */
export async function queueMarketJob(
  db: Db,
  input: {
    source: string;
    productId: string | null;
    kind: MarketJobKind;
    wantedFrom?: string | null;
  },
): Promise<MarketJobRow> {
  if (!isMarketJobKind(input.kind))
    throw new DomainError('invalid_input', `job kind ${input.kind}`);
  if (input.productId !== null) {
    const [p] = await db
      .select({ category: products.category, kind: products.kind })
      .from(products)
      .where(eq(products.id, input.productId));
    if (!p) throw new DomainError('not_found');
    if (!isGameItem(p, await getItemRules(db, input.productId)))
      throw new DomainError('invalid_input', 'daytime reads are for game items only');
  }
  const [row] = await db
    .insert(marketJobs)
    .values({
      source: input.source,
      productId: input.productId,
      kind: input.kind,
      wantedFrom: input.wantedFrom ?? null,
    })
    .onConflictDoNothing()
    .returning();
  if (row) return row;
  const [have] = await db
    .select()
    .from(marketJobs)
    .where(
      and(
        eq(marketJobs.source, input.source),
        input.productId === null
          ? isNull(marketJobs.productId)
          : eq(marketJobs.productId, input.productId),
        eq(marketJobs.kind, input.kind),
        isActive,
      ),
    );
  return have!;
}

/** A marketplace's state row, made at the starting number when it has none (never overwritten). */
export async function ensureMarketState(db: Db, source: string): Promise<void> {
  await db.insert(marketState).values({ source, perDay: MARKET_PER_DAY }).onConflictDoNothing();
}

export async function readMarketState(db: Db, source: string) {
  const [row] = await db.select().from(marketState).where(eq(marketState.source, source));
  return row ?? null;
}

/** Requests counted for a marketplace on a day (the app's zone). */
export async function marketUsed(db: Db, source: string, day: string): Promise<number> {
  const [row] = await db
    .select({ used: marketDays.used })
    .from(marketDays)
    .where(and(eq(marketDays.source, source), eq(marketDays.day, day)));
  return row?.used ?? 0;
}

/** A source's latest collect run (fix 4: a refusal there keeps the daytime reads away a day). */
export async function lastCollectRun(
  db: Db,
  source: string,
): Promise<{ status: string; startedAt: string; refusedAt: string | null } | null> {
  const [row] = await db
    .select({
      status: collectorRuns.status,
      startedAt: collectorRuns.startedAt,
      refusedAt: collectorRuns.refusedAt,
    })
    .from(collectorRuns)
    .where(eq(collectorRuns.source, source))
    .orderBy(desc(collectorRuns.startedAt))
    .limit(1);
  return row ?? null;
}

/** Marketplaces with waiting or running jobs, by name. */
export async function activeJobSources(db: Db): Promise<string[]> {
  const rows = await db
    .selectDistinct({ source: marketJobs.source })
    .from(marketJobs)
    .where(and(isActive, isRunKind))
    .orderBy(marketJobs.source);
  return rows.map((r) => r.source);
}

/** A marketplace's waiting and running jobs, in run order (a `running` one was cut off: it goes on). */
export async function nextJobs(db: Db, source: string): Promise<MarketJobRow[]> {
  const rows = await db
    .select()
    .from(marketJobs)
    .where(and(eq(marketJobs.source, source), isActive, isRunKind));
  return rows.sort(compareJobs);
}

/**
 * Marks a job running, `started_at` its last attempt (a job failing 5 times in a row is tried at
 * most once a day by it). Returns the job as claimed, the one place a run reads its cursor and
 * findings from (a search saved since the run listed its jobs reset them; fix round 2, item 1).
 * Null: it is gone or finished.
 */
export async function claimJob(db: Db, jobId: string, now: Date): Promise<MarketJobRow | null> {
  const [row] = await db
    .update(marketJobs)
    .set({ status: 'running', startedAt: toLocalIso(now) })
    .where(and(eq(marketJobs.id, jobId), isActive))
    .returning();
  return row ?? null;
}

/**
 * Counts one request before it is sent (S36 B4; spec Assumed: a kill after the count spends it,
 * never more): one statement adds 1 to the day's `used` only while it is under the marketplace's
 * number and the marketplace is neither stopped nor waiting, and the job's `requests` follows it
 * in the same batch. The day's row is made at the first request with the number of that day.
 * Returns the day's count, or null when nothing was counted (do not send). A missing state row,
 * or a number under the floor, counts nothing (unknown never runs).
 */
export async function reserveRequest(
  db: Db,
  input: { source: string; jobId: string; day: string; now: Date },
): Promise<number | null> {
  const [counted] = await db.$client.batch(
    [
      {
        sql: `INSERT INTO market_days (source, day, used, limit_that_day)
          SELECT source, ?, 1, per_day FROM market_state
          WHERE source = ? AND stopped = 0 AND per_day IS NOT NULL AND per_day >= ?
            AND (wait_until IS NULL OR julianday(wait_until) <= julianday(?))
          ON CONFLICT (source, day) DO UPDATE SET used = used + 1,
            limit_that_day = excluded.limit_that_day
          WHERE market_days.used < excluded.limit_that_day
          RETURNING used`,
        args: [input.day, input.source, MARKET_FLOOR, toLocalIso(input.now)],
      },
      // changes(): rows the statement above wrote (0 when it counted nothing).
      {
        sql: 'UPDATE market_jobs SET requests = requests + 1 WHERE id = ? AND changes() > 0',
        args: [input.jobId],
      },
    ],
    'write',
  );
  const used = counted?.rows[0]?.used;
  return used == null ? null : Number(used);
}

/** A job's item now (it may have been merged or deleted mid-run); null: the job is gone. */
export async function jobTarget(
  db: Db,
  jobId: string,
): Promise<{ productId: string | null; status: string; result: JobResult | null } | null> {
  const [row] = await db
    .select({
      productId: marketJobs.productId,
      status: marketJobs.status,
      result: marketJobs.result,
    })
    .from(marketJobs)
    .where(eq(marketJobs.id, jobId));
  return row ?? null;
}

/**
 * A step's progress: its cursor, the oldest day reached so far, and done. A saved step clears the
 * error and the failures of earlier failed ones. Written only while the job still exists and runs;
 * false otherwise (merged into a job the target had, deleted, restarted). `result`: what the job
 * found so far, merged by the caller (S36 B3), replacing the stored one.
 */
export async function saveJobStep(
  db: Db,
  jobId: string,
  step: { cursor: unknown; oldestReached: string | null; done: boolean },
  now: Date,
  result?: JobResult,
): Promise<boolean> {
  const oldest = step.oldestReached;
  const rows = await db
    .update(marketJobs)
    .set({
      cursor: step.done ? null : step.cursor,
      error: null,
      failures: 0,
      oldestReached:
        oldest == null
          ? sql`${marketJobs.oldestReached}`
          : sql`CASE WHEN ${marketJobs.oldestReached} IS NULL OR ${oldest} < ${marketJobs.oldestReached}
              THEN ${oldest} ELSE ${marketJobs.oldestReached} END`,
      ...(step.done ? { status: 'done', finishedAt: toLocalIso(now) } : {}),
      ...(result ? { result } : {}),
    })
    .where(and(eq(marketJobs.id, jobId), eq(marketJobs.status, 'running')))
    .returning({ id: marketJobs.id });
  return rows.length > 0;
}

/**
 * A running job goes back to waiting, its cursor kept (the next run goes on from it). `error`: its
 * step failed (the W10 review's error rule): the error is kept and the job's failures go up by one,
 * both until a step is saved. Without it (the runner's own check or failure), neither changes.
 */
export async function releaseJob(db: Db, jobId: string, error?: string): Promise<void> {
  await db
    .update(marketJobs)
    .set({
      status: 'waiting',
      ...(error === undefined
        ? {}
        : { error: error.slice(0, 500), failures: sql`${marketJobs.failures} + 1` }),
    })
    .where(and(eq(marketJobs.id, jobId), eq(marketJobs.status, 'running')));
}

/** Stops a job for good with its error (shown on the collectors page). */
export async function stopJob(db: Db, jobId: string, error: string, now: Date): Promise<void> {
  await db
    .update(marketJobs)
    .set({ status: 'stopped', error: error.slice(0, 500), finishedAt: toLocalIso(now) })
    .where(and(eq(marketJobs.id, jobId), isActive));
}

export interface RefusalResult {
  /** False when this refusal was already recorded (a replay). */
  changed: boolean;
  perDay: number;
  waitUntil: string | null;
  stopped: boolean;
}

/**
 * A marketplace refused a request at `at` (S36 B4): wait 3 days and halve, or stop at the floor,
 * with one admin activity entry the alert pass sends. Idempotent: a refusal at or before the last
 * one recorded (compared as instants) changes nothing, and the entry is written once per
 * marketplace and refusal time, so a replay after a restore never alerts twice. The job, if
 * given, goes back to waiting. `stamp`: the state the refusal left, from its stamp file (a replay
 * after a restore); the stricter of it and the halving of the restored row applies (fix 5).
 */
export async function recordRefusal(
  db: Db,
  input: {
    source: string;
    at: Date;
    jobId?: string | null;
    now?: Date;
    stamp?: { perDay: number; stopped: boolean };
  },
): Promise<RefusalResult> {
  await ensureMarketState(db, input.source);
  const atIso = toLocalIso(input.at);
  return db.transaction(async (tx) => {
    if (input.jobId) {
      await tx
        .update(marketJobs)
        .set({ status: 'waiting' })
        .where(and(eq(marketJobs.id, input.jobId), eq(marketJobs.status, 'running')));
    }
    const [s] = await tx.select().from(marketState).where(eq(marketState.source, input.source));
    if (s!.lastRefusalAt && Date.parse(s!.lastRefusalAt) >= input.at.getTime()) {
      return { changed: false, perDay: s!.perDay, waitUntil: s!.waitUntil, stopped: s!.stopped };
    }
    const halved = afterRefusal(s!.perDay, input.at);
    // A restored row may hold a higher number than the refusal left: the stricter one applies.
    const stopped = halved.stopped || !!input.stamp?.stopped;
    const next = {
      perDay: Math.min(halved.perDay, input.stamp?.perDay ?? halved.perDay),
      waitUntil: stopped ? null : halved.waitUntil,
      stopped,
    };
    const waitUntil = next.waitUntil ? toLocalIso(next.waitUntil) : null;
    await tx
      .update(marketState)
      .set({
        perDay: next.perDay,
        waitUntil,
        stopped: next.stopped,
        lastRefusalAt: atIso,
        refusals: sql`${marketState.refusals} + 1`,
        updatedAt: toLocalIso(input.now ?? input.at),
      })
      .where(eq(marketState.source, input.source));
    const [entry] = await tx
      .select({ id: activity.id })
      .from(activity)
      .where(
        and(
          eq(activity.kind, 'admin'),
          inArray(activity.action, ['marketRefused', 'marketStopped']),
          sql`json_extract(${activity.detail}, '$.source') = ${input.source}`,
          sql`julianday(${activity.occurredAt}) = julianday(${atIso})`,
        ),
      );
    if (!entry) {
      await tx.insert(activity).values({
        kind: 'admin',
        action: next.stopped ? 'marketStopped' : 'marketRefused',
        level: next.stopped ? 'failed' : 'problem',
        detail: next.stopped
          ? { source: input.source }
          : { source: input.source, perDay: next.perDay, waitUntil },
        href: '/settings/collectors',
        occurredAt: atIso,
      });
    }
    return { changed: true, perDay: next.perDay, waitUntil, stopped: next.stopped };
  });
}

/**
 * An admin starts a waiting or stopped marketplace again at the floor, now (S36 B4: "stopped until
 * an admin restarts"). Writes only the state row (never the day's count). False: it was neither.
 */
export async function restartMarket(
  db: Db,
  source: string,
  userId: string | null,
  now = new Date(),
): Promise<boolean> {
  const at = toLocalIso(now);
  const rows = await db
    .update(marketState)
    .set({
      perDay: MARKET_FLOOR,
      waitUntil: null,
      stopped: false,
      restartedBy: userId,
      updatedAt: at,
    })
    .where(
      and(
        eq(marketState.source, source),
        sql`(${marketState.stopped} = 1 OR (${marketState.waitUntil} IS NOT NULL
          AND julianday(${marketState.waitUntil}) > julianday(${at})))`,
      ),
    )
    .returning({ source: marketState.source });
  return rows.length > 0;
}

/** The job runner could not run (exit 1): one admin entry a day at most, sent with refusals. */
export async function recordMarketJobsFailed(
  db: Db,
  error: string,
  now = new Date(),
): Promise<void> {
  const last = await lastActivity(db, 'admin', { action: 'marketJobsFailed' });
  if (last && localDate(new Date(last.occurredAt)) === localDate(now)) return;
  await db.insert(activity).values({
    kind: 'admin',
    action: 'marketJobsFailed',
    level: 'failed',
    detail: { error: error.slice(0, 300) },
    href: '/settings/collectors',
    occurredAt: toLocalIso(now),
  });
}

export interface MarketStateView {
  source: string;
  /** Null: no state row yet (jobs wait, the runner has not seen it). */
  perDay: number | null;
  /** Set only while the wait is still ahead. */
  waitUntil: string | null;
  stopped: boolean;
  lastRefusalAt: string | null;
  used: number;
  /** Waiting or running jobs, and the oldest one's creation. */
  waiting: number;
  oldestWaitingAt: string | null;
  stoppedJobs: number;
  /** The last error of a stopped job. */
  lastError: string | null;
  /**
   * Waiting or running jobs whose last step failed, their most failures in a row, and the error of
   * the one tried last.
   */
  failingJobs: number;
  mostFailures: number;
  lastFailure: string | null;
  /**
   * Jobs finished in the last 30 days that wrote no span because sales they found are stored under
   * another item or were undone by a load (S36 B3): the item and how many such sales.
   */
  blocked: { productId: string | null; name: string | null; n: number }[];
}

/** Days a job that wrote no span for sales stored elsewhere stays listed (collectors page). */
const BLOCKED_DAYS = 30;

/** Per marketplace with a state row or jobs: the day's number, use and jobs (collectors page). */
export async function marketStates(db: Db, now = new Date()): Promise<MarketStateView[]> {
  const day = localDate(now);
  const [states, days, jobs, errors, failing, blocked] = await Promise.all([
    db.select().from(marketState),
    db.select().from(marketDays).where(eq(marketDays.day, day)),
    db
      .select({
        source: marketJobs.source,
        status: marketJobs.status,
        n: count(),
        oldest: sql<string>`min(${marketJobs.createdAt})`,
      })
      .from(marketJobs)
      .where(and(inArray(marketJobs.status, [...ACTIVE, 'stopped']), isRunKind))
      .groupBy(marketJobs.source, marketJobs.status),
    db
      .select({ source: marketJobs.source, error: marketJobs.error })
      .from(marketJobs)
      .where(and(eq(marketJobs.status, 'stopped'), isRunKind))
      .orderBy(desc(marketJobs.finishedAt)),
    db
      .select({ source: marketJobs.source, failures: marketJobs.failures, error: marketJobs.error })
      .from(marketJobs)
      .where(and(isActive, isRunKind, gt(marketJobs.failures, 0)))
      .orderBy(desc(marketJobs.startedAt)),
    db
      .select({
        source: marketJobs.source,
        productId: marketJobs.productId,
        name: products.name,
        result: marketJobs.result,
      })
      .from(marketJobs)
      .leftJoin(products, eq(products.id, marketJobs.productId))
      .where(
        and(
          eq(marketJobs.status, 'done'),
          sql`json_extract(${marketJobs.result}, '$.why') = 'elsewhere'`,
          sql`julianday(${marketJobs.finishedAt}) >= julianday(${toLocalIso(now)}) - ${BLOCKED_DAYS}`,
        ),
      )
      .orderBy(desc(marketJobs.finishedAt)),
  ]);
  const sources = [...new Set([...states.map((s) => s.source), ...jobs.map((j) => j.source)])];
  return sources.sort().map((source) => {
    const s = states.find((x) => x.source === source);
    const active = jobs.filter((j) => j.source === source && ACTIVE.includes(j.status));
    const wait = s?.waitUntil && Date.parse(s.waitUntil) > now.getTime() ? s.waitUntil : null;
    const failed = failing.filter((f) => f.source === source);
    return {
      source,
      perDay: s?.perDay ?? null,
      waitUntil: wait,
      stopped: s?.stopped ?? false,
      lastRefusalAt: s?.lastRefusalAt ?? null,
      used: days.find((d) => d.source === source)?.used ?? 0,
      waiting: active.reduce((n, j) => n + j.n, 0),
      oldestWaitingAt: active.map((j) => j.oldest).sort()[0] ?? null,
      stoppedJobs: jobs.find((j) => j.source === source && j.status === 'stopped')?.n ?? 0,
      lastError: errors.find((e) => e.source === source)?.error ?? null,
      failingJobs: failed.length,
      mostFailures: Math.max(0, ...failed.map((f) => f.failures)),
      lastFailure: failed[0]?.error ?? null,
      blocked: blocked
        .filter((b) => b.source === source)
        .map(({ productId, name, result: r }) => ({
          productId,
          name,
          n: (r?.elsewhere?.length ?? 0) + (r?.undoneHere?.length ?? 0) + (r?.elsewhereMore ?? 0),
        })),
    };
  });
}
