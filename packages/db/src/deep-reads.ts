// A game wish's marketplace history (requirements S36 A3, B3; plan-deep-read.md): which
// marketplaces have deep reads, the queue of deep reads and weekly read-backs, a finished job's
// span, and a load of saved search files with its undo. The rules (days, frontier, span) are in
// @tora/core deep-read; the runner (collector SDK) and the loader script call these.
import {
  ELSEWHERE_LIST,
  JOB_UNDONE,
  type JobResult,
  LOAD_JOB_KIND,
  MARKET_FAILURES_DAILY,
  type MarketJobKind,
  READBACK_EVERY_DAYS,
  type SpanJobKind,
  type SpanWhy,
  addDays,
  isGameItem,
  isSpanJobKind,
  jobSpan,
  localDate,
  newId,
  spanHowOf,
  toLocalIso,
  wantedFromOf,
} from '@tora/core';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from './client';
import { refreshItemSales } from './item-sales';
import { getItemRules } from './item-rules';
import type { Tx } from './mutations';
import { readSetting, saveSetting } from './registry';
import { addSpan, dropSpans, removeSpan } from './sale-coverage';
import {
  type MarketJobRow,
  marketJobs,
  priceObservations,
  productSources,
  products,
  saleCoverage,
  watches,
} from './schema';
import { QUERY_SOURCE_ID } from './sources';
import { clearBucketValues } from './valuation';
import { rowsItemOf } from './wishes';

const SETTING = 'marketJobKinds';
/** Refs per read (SQLite's bound values). */
const REFS_PER_READ = 400;
/** A kind stopped within this many days is not queued again (no nightly retry loop; plan 9.6). */
const STOPPED_WAIT_DAYS = 7;
/**
 * A deep read done without a span is not queued again within this many days, so one that keeps
 * ending 'elsewhere', 'too_recent' or 'nothing_read' costs at most one read a game a month (fix
 * round 2, item 3). Not when its span went because the search changed: queued again at once.
 */
const NO_SPAN_WAIT_DAYS = 30;
/** Whys that queue a done deep read again at once: its span went because the search changed. */
const SEARCH_CHANGED: readonly SpanWhy[] = ['search_edited', 'narrower_search'];

/**
 * The item's done deep reads at a source get why `why` and lose `span` (fix round 2, item 3);
 * `spanned`: only those whose span still exists. Run before their spans are dropped.
 */
async function markDoneDeep(
  tx: Tx,
  productId: string,
  source: string,
  why: SpanWhy,
  spanned: boolean,
): Promise<void> {
  await tx.run(sql`
    UPDATE market_jobs SET result = json_set(json_remove(coalesce(result, '{}'), '$.span'), '$.why', ${why})
    WHERE product_id = ${productId} AND source = ${source} AND kind = 'deep' AND status = 'done'
      ${spanned ? sql`AND EXISTS (SELECT 1 FROM sale_spans s WHERE s.job_id = market_jobs.id)` : sql``}`);
}

/**
 * The job kinds each marketplace's plug-in reads, as the server's plug-ins say (written by the
 * collect and the job runner at start, only when it changed). The web reads it to know which
 * marketplaces have deep reads (S36 B3: a source without them starts at its first nightly read).
 */
export async function saveJobKinds(
  db: Db,
  kinds: Record<string, readonly MarketJobKind[]>,
): Promise<boolean> {
  const value = Object.fromEntries(
    Object.entries(kinds)
      .filter(([, k]) => k.length)
      .map(([s, k]) => [s, [...k].sort()] as const)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  if (JSON.stringify(await jobKindsBySource(db)) === JSON.stringify(value)) return false;
  await saveSetting(db, SETTING, value);
  return true;
}

/** The kinds each marketplace reads; unknown (never written): none. */
export async function jobKindsBySource(
  db: Pick<Db, 'select'>,
): Promise<Record<string, MarketJobKind[]>> {
  return (await readSetting<Record<string, MarketJobKind[]>>(db, SETTING)) ?? {};
}

/** The item's active search at a marketplace, or null (S36 B3: jobs read searches only). */
export async function searchLink(db: Pick<Db, 'select'>, productId: string, source: string) {
  const [link] = await db
    .select()
    .from(productSources)
    .where(
      and(
        eq(productSources.productId, productId),
        eq(productSources.source, source),
        eq(productSources.externalId, QUERY_SOURCE_ID),
        eq(productSources.active, true),
      ),
    );
  return link ?? null;
}

/** The item a game wish reads its rows from (boxed: the plain item), when it is a game item. */
async function wishRowsItem(db: Pick<Db, 'select'>, productId: string): Promise<string | null> {
  const { from } = await rowsItemOf(db, productId);
  const [p] = await db
    .select({ category: products.category, kind: products.kind })
    .from(products)
    .where(eq(products.id, from));
  return p && isGameItem(p, await getItemRules(db, from)) ? from : null;
}

/** SQL: the item has an active search at the source. */
export const activeLink = (source: string, productId: string) =>
  sql`EXISTS (SELECT 1 FROM product_sources WHERE product_id = ${productId} AND source = ${source}
    AND external_id = ${QUERY_SOURCE_ID} AND active = 1)`;

/**
 * The item's rows at a source were deleted (its search saved, `updateSourceQuery`), so what rested
 * on them goes in the same transaction (fix round 1, rule a): its spans and its nights there; its
 * waiting and running deep reads and read-backs start again from page 0 (a step in flight then
 * finds its job no longer running and saves nothing); a running or done load stops ('search edited'; its
 * undo stays possible). Its done deep reads get why 'search_edited', so the closing step queues
 * the deep read again at once (`queueDeep`; fix round 2, item 3).
 */
export async function forgetReads(tx: Tx, productId: string, source: string): Promise<void> {
  await markDoneDeep(tx, productId, source, 'search_edited', false);
  await dropSpans(tx, productId, source);
  await tx
    .delete(saleCoverage)
    .where(and(eq(saleCoverage.productId, productId), eq(saleCoverage.source, source)));
  await tx
    .update(marketJobs)
    .set({
      status: 'waiting',
      cursor: null,
      result: null,
      oldestReached: null,
      failures: 0,
      error: null,
    })
    .where(
      and(
        eq(marketJobs.productId, productId),
        eq(marketJobs.source, source),
        // A tracked game's reads read the same search (S36 step D, W17).
        inArray(marketJobs.kind, ['deep', 'readback', 'tracked_weekly', 'monthly']),
        inArray(marketJobs.status, ['waiting', 'running']),
      ),
    );
  await tx
    .update(marketJobs)
    .set({ status: 'stopped', error: 'search edited', finishedAt: toLocalIso() })
    .where(
      and(
        eq(marketJobs.productId, productId),
        eq(marketJobs.source, source),
        eq(marketJobs.kind, LOAD_JOB_KIND),
        // A done load too: its rows went with the save, so its files may be loaded again.
        inArray(marketJobs.status, ['running', 'done']),
      ),
    );
}

/**
 * Queues a deep read (S36 B3) unless the item has one waiting or running; one done within 12 months
 * whose span still exists (only a span blocks for 12 months: fix round 1, rule d); one stopped
 * within 7 days (no retry loop; plan section 9 point 6); or one done within 30 days without a span
 * (nothing read, too recent, sales elsewhere, a load undone; fix round 2, item 3), unless its span
 * went because the search changed (why 'search_edited' or 'narrower_search'): then at once. One
 * statement, so a rerun or a web request beside the closing step leaves one job.
 */
async function queueDeep(db: Db, source: string, productId: string, today: string, at: string) {
  const rows = await db.all<{ id: string }>(sql`
    INSERT INTO market_jobs (id, source, product_id, kind, status, wanted_from, created_at)
    SELECT ${newId()}, ${source}, ${productId}, 'deep', 'waiting', ${wantedFromOf('deep', today)}, ${at}
    WHERE ${activeLink(source, productId)} AND NOT EXISTS (
      SELECT 1 FROM market_jobs j WHERE j.source = ${source} AND j.product_id = ${productId}
        AND j.kind = 'deep'
        AND (j.status IN ('waiting', 'running')
          OR (j.status = 'done' AND substr(j.finished_at, 1, 10) > ${wantedFromOf('deep', today)}
            AND EXISTS (SELECT 1 FROM sale_spans s WHERE s.job_id = j.id))
          OR (j.status = 'stopped'
            AND substr(j.finished_at, 1, 10) > ${addDays(today, -STOPPED_WAIT_DAYS)})
          OR (j.status = 'done'
            AND substr(j.finished_at, 1, 10) > ${addDays(today, -NO_SPAN_WAIT_DAYS)}
            AND coalesce(json_extract(j.result, '$.why'), '') NOT IN (${sql.join(
              SEARCH_CHANGED.map((w) => sql`${w}`),
              sql`, `,
            )}))))
    ON CONFLICT DO NOTHING RETURNING id`);
  return rows.length;
}

/**
 * Queues a read-back (S36 B3: each week, 6 weeks back) when the last one finished 7 or more days
 * ago (app-zone days) or there was none, none waits or runs or stopped within 7 days, and no deep
 * read of the item waits or runs there (it reads those weeks too). A deep read failing day after
 * day (MARKET_FAILURES_DAILY failures or more; it stays waiting, W10's rule) does not hold it back.
 */
async function queueReadback(db: Db, source: string, productId: string, today: string, at: string) {
  const week = addDays(today, -READBACK_EVERY_DAYS);
  const rows = await db.all<{ id: string }>(sql`
    INSERT INTO market_jobs (id, source, product_id, kind, status, wanted_from, created_at)
    SELECT ${newId()}, ${source}, ${productId}, 'readback', 'waiting', ${wantedFromOf('readback', today)}, ${at}
    WHERE ${activeLink(source, productId)} AND NOT EXISTS (
      SELECT 1 FROM market_jobs WHERE source = ${source} AND product_id = ${productId}
        AND ((kind = 'readback' AND (status IN ('waiting', 'running')
            OR (status IN ('done', 'stopped') AND substr(finished_at, 1, 10) > ${week})))
          OR (kind = 'deep' AND status IN ('waiting', 'running')
            AND failures < ${MARKET_FAILURES_DAILY})))
    ON CONFLICT DO NOTHING RETURNING id`);
  return rows.length;
}

export const sourcesWith = (kinds: Record<string, MarketJobKind[]>, kind: MarketJobKind) =>
  Object.entries(kinds)
    .filter(([, k]) => k.includes(kind))
    .map(([s]) => s);

/**
 * A new game wish's deep reads (S36 B3): one per marketplace with deep reads where the item has an
 * active search; a boxed wish's go to its plain item. Returns the jobs queued.
 */
export async function queueWishReads(db: Db, productId: string, now: Date): Promise<number> {
  const item = await wishRowsItem(db, productId);
  if (!item) return 0;
  const today = localDate(now);
  let queued = 0;
  for (const source of sourcesWith(await jobKindsBySource(db), 'deep'))
    queued += await queueDeep(db, source, item, today, toLocalIso(now));
  return queued;
}

/**
 * `queueWishReads` for a wish just made or confirmed: a failure is logged and never fails the wish
 * (the closing step queues the next night; plan section 1 step 11).
 */
export async function queueWishReadsSafely(db: Db, productId: string): Promise<void> {
  await queueWishReads(db, productId, new Date()).catch((error) =>
    console.error(`deep reads of ${productId} not queued`, error),
  );
}

/**
 * The closing step's part (S36 B3): every wished game's missing deep read and its weekly read-back;
 * and the deep reads and read-backs of an item no longer wished, or whose search is off, stopped
 * (their rows stay). No request.
 */
export async function queueWeeklyReads(
  db: Db,
  now: Date,
): Promise<{ queued: number; stopped: number }> {
  const watched = await db
    .selectDistinct({ id: watches.productId })
    .from(watches)
    .innerJoin(products, eq(products.id, watches.productId))
    .where(eq(products.category, 'game'));
  const items = new Set<string>();
  for (const w of watched) {
    const item = await wishRowsItem(db, w.id);
    if (item) items.add(item);
  }
  const kinds = await jobKindsBySource(db);
  const today = localDate(now);
  const at = toLocalIso(now);
  let stopped = 0;
  const active = await db
    .select()
    .from(marketJobs)
    .where(
      and(
        inArray(marketJobs.kind, ['deep', 'readback']),
        inArray(marketJobs.status, ['waiting', 'running']),
      ),
    );
  for (const job of active) {
    const why =
      !job.productId || !items.has(job.productId)
        ? 'wish removed'
        : !(await searchLink(db, job.productId, job.source))
          ? 'search off'
          : null;
    if (!why) continue;
    const gone = await db
      .update(marketJobs)
      .set({ status: 'stopped', error: why, finishedAt: at })
      .where(and(eq(marketJobs.id, job.id), inArray(marketJobs.status, ['waiting', 'running'])))
      .returning({ id: marketJobs.id });
    stopped += gone.length;
  }
  let queued = 0;
  for (const item of items) {
    for (const source of sourcesWith(kinds, 'deep'))
      queued += await queueDeep(db, source, item, today, at);
    for (const source of sourcesWith(kinds, 'readback'))
      queued += await queueReadback(db, source, item, today, at);
  }
  return { queued, stopped };
}

/**
 * The refs among `refs` stored at `source` under another item than `productId`, with that item;
 * those stored under it; and of these, the ones excluded by a load's undo (`undone:` mark).
 */
export async function refsElsewhere(
  db: Pick<Db, 'select'>,
  source: string,
  productId: string,
  refs: readonly string[],
): Promise<{ elsewhere: Map<string, string>; here: Set<string>; undone: Set<string> }> {
  const elsewhere = new Map<string, string>();
  const here = new Set<string>();
  const undone = new Set<string>();
  const unique = [...new Set(refs)];
  for (let i = 0; i < unique.length; i += REFS_PER_READ) {
    const rows = await db
      .select({
        ref: priceObservations.externalRef,
        productId: priceObservations.productId,
        mark: priceObservations.ruleMark,
      })
      .from(priceObservations)
      .where(
        and(
          eq(priceObservations.source, source),
          inArray(priceObservations.externalRef, unique.slice(i, i + REFS_PER_READ)),
        ),
      );
    for (const r of rows) {
      if (r.productId !== productId) elsewhere.set(r.ref, r.productId);
      else {
        here.add(r.ref);
        if (r.mark?.startsWith('undone:')) undone.add(r.ref);
      }
    }
  }
  return { elsewhere, here, undone };
}

/** What one step or one chunk of a job found while saving (`saveJobRows`). */
export interface JobFindings {
  added: number;
  /** Refs this item would keep, stored under another item (ref, that item). */
  elsewhere: Map<string, string>;
  /** Refs under another item this item's verdict leaves out (listed apart, block nothing). */
  notItem: number;
  /** Refs stored here undone by a load that this item would keep. */
  undoneHere: string[];
}

const union = (a: readonly string[] = [], b: Iterable<string>) => {
  const all = [...new Set([...a, ...b])];
  return { list: all.slice(0, ELSEWHERE_LIST), more: Math.max(0, all.length - ELSEWHERE_LIST) };
};

/**
 * A job's result with a step's findings added (plan 10.1): the findings of another search are
 * dropped, as its frontier is; refs are kept as a set (a page read again adds none), 200 at most
 * and the rest counted. `added` counts the whole job. `read`: the search the key stands for, set with
 * it (fix round 1, rule b), so a span can later be checked against the item's search then.
 */
export function mergeFindings(
  prev: JobResult | null,
  found: JobFindings,
  search?: { key: string; day: string },
  read?: JobResult['read'],
): JobResult {
  const same = !search || prev?.search === search.key;
  const base: JobResult = same
    ? (prev ?? {})
    : {
        ...(prev?.added !== undefined && { added: prev.added }),
        ...(prev?.fingerprint && { fingerprint: prev.fingerprint }),
      };
  const elsewhere = union(base.elsewhere, found.elsewhere.keys());
  const undone = union(base.undoneHere, found.undoneHere);
  const items = union(base.elsewhereItems, found.elsewhere.values());
  const more = (base.elsewhereMore ?? 0) + elsewhere.more + undone.more;
  const notItem = (base.notItem ?? 0) + found.notItem;
  return {
    ...base,
    added: (base.added ?? 0) + found.added,
    ...(search && { search: search.key, firstDay: search.day, ...(read && { read }) }),
    ...(elsewhere.list.length > 0 && { elsewhere: elsewhere.list }),
    ...(items.list.length > 0 && { elsewhereItems: items.list }),
    ...(more > 0 && { elsewhereMore: more }),
    ...(notItem > 0 && { notItem }),
    ...(undone.list.length > 0 && { undoneHere: undone.list }),
  };
}

/**
 * Ends a running job (S36 Terms "Covered day"; plan section 4): in one transaction its status, its
 * result and its span, written only when the job was still running (so one span per job at most).
 * The span is worked out from the finishing search's own frontier (`oldestReached`) and
 * `result.firstDay`; none when `result.why` is set already (a load's), when nothing was read or the
 * days run backwards, or while any sale it would keep is not yet stored under this item, or is
 * undone here (checked again now; more than 200 listed: still blocking). Returns the result, or null
 * when the job was no longer running.
 */
export async function finishJob(
  db: Db,
  jobId: string,
  step: { oldestReached: string | null; result: JobResult },
  now: Date,
): Promise<JobResult | null> {
  return db.transaction(async (tx) => {
    const [job] = await tx.select().from(marketJobs).where(eq(marketJobs.id, jobId));
    if (!job || job.status !== 'running') return null;
    const r = step.result;
    let result: JobResult = r;
    let span: { from: string; to: string } | null = null;
    if (job.productId && isSpanJobKind(job.kind)) {
      const still = await refsElsewhere(tx, job.source, job.productId, [
        ...(r.elsewhere ?? []),
        ...(r.undoneHere ?? []),
      ]);
      // A listed ref blocks unless it is now stored under this item and not undone; one stored
      // nowhere blocks too (its sale is kept nowhere; a deep read comes again in 7 days: N4).
      const blocks = (ref: string) => !still.here.has(ref) || still.undone.has(ref);
      const elsewhere = (r.elsewhere ?? []).filter(blocks);
      const undoneHere = (r.undoneHere ?? []).filter(blocks);
      const { elsewhere: _e, undoneHere: _u, why: _w, span: _s, ...rest } = r;
      const got =
        r.why && r.why !== 'elsewhere'
          ? { none: r.why }
          : elsewhere.length > 0 || undoneHere.length > 0 || (r.elsewhereMore ?? 0) > 0
            ? { none: 'elsewhere' as const }
            : jobSpan(job.kind, job.wantedFrom, step.oldestReached, r.firstDay ?? null);
      if ('from' in got) span = got;
      result = {
        ...rest,
        ...(elsewhere.length > 0 && { elsewhere }),
        ...(undoneHere.length > 0 && { undoneHere }),
        ...('from' in got ? { span: got } : { why: got.none }),
      };
    }
    const oldest = step.oldestReached;
    const [done] = await tx
      .update(marketJobs)
      .set({
        status: 'done',
        cursor: null,
        error: null,
        failures: 0,
        finishedAt: toLocalIso(now),
        result,
        oldestReached:
          oldest == null
            ? sql`${marketJobs.oldestReached}`
            : sql`CASE WHEN ${marketJobs.oldestReached} IS NULL OR ${oldest} < ${marketJobs.oldestReached}
                THEN ${oldest} ELSE ${marketJobs.oldestReached} END`,
      })
      .where(and(eq(marketJobs.id, jobId), eq(marketJobs.status, 'running')))
      .returning({ id: marketJobs.id });
    if (!done) return null;
    if (span && job.productId)
      await addSpan(tx, {
        productId: job.productId,
        source: job.source,
        ...span,
        how: spanHowOf(job.kind as SpanJobKind),
        jobId,
      });
    return result;
  });
}

/**
 * The first day the nightly read stored sales of an item at a source (plan section 9 point 5): the
 * earlier of its first `sale_coverage` night and the first fetch day of its rows there that no job
 * stored (a pasted reference left out: its upsert replaced the stamp). Null: neither.
 */
export async function firstNightDay(
  db: Pick<Db, 'select'>,
  productId: string,
  source: string,
): Promise<string | null> {
  const [cov] = await db
    .select({ nights: saleCoverage.nights })
    .from(saleCoverage)
    .where(and(eq(saleCoverage.productId, productId), eq(saleCoverage.source, source)));
  const [row] = await db
    .select({ day: sql<string | null>`min(substr(${priceObservations.fetchedAt}, 1, 10))` })
    .from(priceObservations)
    .where(
      and(
        eq(priceObservations.productId, productId),
        eq(priceObservations.source, source),
        sql`json_extract(${priceObservations.raw}, '$.job') IS NULL`,
        sql`json_extract(${priceObservations.raw}, '$.reference') IS NULL`,
      ),
    );
  const days = [...(cov?.nights ?? []).map(([from]) => from), ...(row?.day ? [row.day] : [])];
  return days.sort()[0] ?? null;
}

/**
 * The nightly read's own sales of an item at a source observed from `from` to `to` (app-zone days):
 * how many, and how many kept (plan 10.4: the loader sets a load's kept share beside it). Rows a
 * job stored or a pasted reference are left out.
 */
export async function nightlyShare(
  db: Pick<Db, 'select'>,
  productId: string,
  source: string,
  from: string,
  to: string,
): Promise<{ rows: number; kept: number }> {
  const [row] = await db
    .select({
      rows: sql<number>`count(*)`,
      kept: sql<number>`coalesce(sum(CASE WHEN ${priceObservations.excluded} = 0 THEN 1 ELSE 0 END), 0)`,
    })
    .from(priceObservations)
    .where(
      and(
        eq(priceObservations.productId, productId),
        eq(priceObservations.source, source),
        eq(priceObservations.observationType, 'sold'),
        sql`substr(${priceObservations.observedAt}, 1, 10) BETWEEN ${from} AND ${to}`,
        sql`json_extract(${priceObservations.raw}, '$.job') IS NULL`,
        sql`json_extract(${priceObservations.raw}, '$.reference') IS NULL`,
      ),
    );
  return { rows: Number(row?.rows ?? 0), kept: Number(row?.kept ?? 0) };
}

/** A load job to save under (S36 A3), or why none: the same files are never loaded twice. */
export async function startLoadJob(
  db: Db,
  input: { source: string; productId: string; wantedFrom: string | null; fingerprint: string },
  now: Date,
): Promise<{ job: MarketJobRow; reused: boolean } | { skip: string } | { refuse: string }> {
  const [p] = await db
    .select({ category: products.category, kind: products.kind })
    .from(products)
    .where(eq(products.id, input.productId));
  if (!p || !isGameItem(p, await getItemRules(db, input.productId)))
    return { refuse: 'not a game item' };
  const loads = await db
    .select()
    .from(marketJobs)
    .where(
      and(
        eq(marketJobs.source, input.source),
        eq(marketJobs.productId, input.productId),
        eq(marketJobs.kind, LOAD_JOB_KIND),
      ),
    );
  const same = (j: MarketJobRow) => j.result?.fingerprint === input.fingerprint;
  const running = loads.find((j) => j.status === 'running');
  if (running && same(running)) return { job: running, reused: true };
  if (running)
    return {
      refuse: `an earlier load was cut short: rerun that folder or undo job ${running.id}`,
    };
  const done = loads.find((j) => same(j) && j.status === 'done');
  if (done) return { skip: `already loaded as job ${done.id}` };
  const undone = loads.find((j) => same(j) && j.status === JOB_UNDONE);
  if (undone)
    return { refuse: `these files were loaded and undone (job ${undone.id}); not loaded again` };
  const [job] = await db
    .insert(marketJobs)
    .values({
      source: input.source,
      productId: input.productId,
      kind: LOAD_JOB_KIND,
      status: 'running',
      wantedFrom: input.wantedFrom,
      startedAt: toLocalIso(now),
      result: { fingerprint: input.fingerprint },
    })
    .returning();
  return { job: job!, reused: false };
}

/** The days before a load's start whose rows an undo leaves (see `undoLimitDay`). */
const UNDO_KEEPS_DAYS = 14;

/**
 * The first day an undo of a load leaves its rows alone (fix round 1, item 9, the reviewed rule):
 * the later of the item's first nightly read there and the load's start day minus 14 days. A row
 * with the load's stamp is one no nightly had stored; only the last 14 days before the load may hold
 * sales the nightly would have stored itself. No nightly read yet: null (every row of the load goes).
 */
async function undoLimitDay(
  db: Pick<Db, 'select'>,
  job: Pick<MarketJobRow, 'productId' | 'source' | 'startedAt' | 'createdAt'>,
): Promise<string | null> {
  const first = job.productId ? await firstNightDay(db, job.productId, job.source) : null;
  if (!first) return null;
  const start = (job.startedAt ?? job.createdAt).slice(0, 10);
  const recent = addDays(start, -UNDO_KEEPS_DAYS);
  return first > recent ? first : recent;
}

/**
 * Undoes a load (S36 A3; plan section 4, 10.3): in one transaction, its rows observed before
 * `undoLimitDay` are marked excluded (`mismatch`, `undone:<job>`; raw kept), unless an earlier
 * verdict excluded them (only a rules mark is overwritten) or a person did; its span goes and it is
 * marked undone. When it marked any row, every other span of the item at that source goes too (a
 * later deep read over the same refs inserted nothing: its span rested on these rows; fix round 1,
 * rule a); nights stay. Rows the nightly read would have stored itself stay. A job that is not a
 * load is refused; undone already changes nothing. A load cut short (running) or stopped by a merge
 * beside another load, or by a search edit, can be undone too.
 */
export async function undoLoadJob(
  db: Db,
  jobId: string,
  now: Date,
): Promise<{ rows: number; already: boolean } | { refuse: string }> {
  const [job] = await db.select().from(marketJobs).where(eq(marketJobs.id, jobId));
  if (!job) return { refuse: 'no such job' };
  if (job.kind !== LOAD_JOB_KIND) return { refuse: 'only a load job can be undone' };
  if (job.status === JOB_UNDONE) return { rows: 0, already: true };
  if (!job.productId) return { refuse: 'the job has no item' };
  const productId = job.productId;
  const limit = await undoLimitDay(db, job);
  const at = toLocalIso(now);
  const rows = await db.transaction(async (tx: Tx) => {
    const marked = await tx.all<{ id: string }>(sql`
      UPDATE price_observations SET excluded = 1, excluded_reason = 'mismatch',
        rule_mark = ${`undone:${jobId}`}, updated_at = ${at}
      WHERE product_id = ${productId} AND source = ${job.source}
        AND json_extract(raw, '$.job') = ${jobId}
        AND (${limit} IS NULL OR substr(observed_at, 1, 10) < ${limit})
        AND (rule_mark IS NULL OR rule_mark LIKE 'rules:%')
        AND excluded_reason IS NOT 'manual'
        AND (excluded = 0 OR rule_mark LIKE 'rules:%')
        AND EXISTS (SELECT 1 FROM market_jobs WHERE id = ${jobId} AND kind = ${LOAD_JOB_KIND})
      RETURNING id`);
    await removeSpan(tx, jobId);
    if (marked.length > 0) {
      // A deep read whose span goes waits its 30 days ('load_undone'; fix round 2, item 3).
      await markDoneDeep(tx, productId, job.source, 'load_undone', true);
      await dropSpans(tx, productId, job.source);
    }
    const { span: _s, why: _w, ...rest } = job.result ?? {};
    const [gone] = await tx
      .update(marketJobs)
      .set({ status: JOB_UNDONE, result: { ...rest, undone: { rows: marked.length, at } } })
      .where(
        and(
          eq(marketJobs.id, jobId),
          eq(marketJobs.kind, LOAD_JOB_KIND),
          inArray(marketJobs.status, ['done', 'running', 'stopped']),
        ),
      )
      .returning({ id: marketJobs.id });
    if (!gone) throw new Error(`job ${jobId} changed while it was undone; nothing was changed`);
    return marked.length;
  });
  if (rows) {
    await clearBucketValues(db, [productId]);
    await refreshItemSales(db, { marksOnly: true });
  }
  return { rows, already: false };
}
