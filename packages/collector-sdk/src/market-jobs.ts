// The daytime job runner (requirements S36 B4): reads marketplaces for queued jobs, one request per
// step, under each marketplace's number a day, from 05:00 to 22:00, never beside a collect, and
// backs off at a refusal. Plug-ins return rows; only this runner saves them. Started every 30
// minutes by scripts/market-jobs-cron.sh (cli/market-jobs.ts).
import {
  MARKET_FAILURES_DAILY,
  MARKET_FLOOR,
  MARKET_PER_DAY,
  MARKET_WAIT_MS,
  type JobResult,
  LOAD_JOB_KIND,
  type MarketJobKind,
  type MarketStopReason,
  type SourceInfo,
  type SourceRegistry,
  afterRefusal,
  insideHours,
  isGameItem,
  isSpanJobKind,
  jobPace,
  localDate,
  marketsInUse,
  skippedToday,
  toLocalIso,
  whyNotRun,
} from '@tora/core';
import {
  type Db,
  type JobFindings,
  type MarketJobRow,
  activeJobSources,
  claimJob,
  collectRequest,
  ensureMarketState,
  finishJob,
  getItemRules,
  getProduct,
  jobTarget,
  lastCollectRun,
  marketUsed,
  mergeFindings,
  nextJobs,
  readMarketState,
  recordRefusal,
  releaseJob,
  reserveRequest,
  saveJobStep,
  stopJob,
} from '@tora/db';
import { readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { offEverywhere } from './cli/collect-plan';
import { BlockedError, PoliteHttp, RequestCapError, errorText } from './http';
import { saveJobRows } from './job-save';
import { jobSearch } from './job-search';
import { bootId, collectBusy, lockSource, stateDir } from './lock';
import { baseConverter } from './money';
import { saveObservations } from './save';
import type { Collector, JobContext, JobStep } from './types';

export interface MarketJobsOptions {
  /** The app's time zone: the hours and the day a request counts on. */
  zone: string;
  source?: string;
  /** Says what would run; sends nothing and writes nothing. */
  dryRun?: boolean;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  fetchImpl?: typeof fetch;
  stateDir?: string;
  pid?: number;
  /** The pid of the `flock` helper holding the run lock (`holdRunLock`); missing: no request. */
  runLockPid?: number;
  log?: (line: string) => void;
  /** Arms the watchdog with a source's lock (default: 45 s, then `fire`); returns its disarm. */
  watchdog?: (fire: () => void) => () => void;
}

export interface MarketJobsReport {
  /** Requests counted (each before it was sent). */
  requests: number;
  /** Marketplaces whose refusal was recorded, now or from a stamp (exit 4). */
  refused: string[];
  /** The runner's own failures (exit 1). */
  errors: string[];
  /** Why each marketplace stopped for now; `*`: the whole run. */
  stops: Record<string, string>;
}

type Reason = MarketStopReason | 'collect' | 'locked' | 'twice';
/** The check before a request said no. */
class Stop extends Error {
  constructor(
    readonly reason: Reason,
    detail = '',
  ) {
    super(detail ? `${reason} (${detail})` : reason);
  }
}
/** The runner itself failed (database, locks): the run ends with exit 1. */
class RunError extends Error {}

/**
 * A refusal is kept here, written before the database (amendment 4), as
 * `<at> <source> <perDay> <stopped 0|1>`: the state it left (fix 5; an older stamp has the first
 * two only). A wait's stamp goes when the wait ends; a stop's when an admin restarted after it.
 */
const STAMP = 'market-refused-';
/** A collect refused within this long ago keeps the daytime reads away (fix 4). */
const COLLECT_REFUSAL_MS = 24 * 3_600_000;

/**
 * The plug-ins the runner may use (fix 7), by the collect's two admin switches (cli/collect.ts):
 * a source of a market not in use (Settings > Markets) is left out unless it is named with
 * `--source`; a source off for every item type (Settings > Admin > Sources) is left out.
 */
export function jobCollectors(
  collectors: readonly Collector[],
  sources: SourceInfo[],
  registry: SourceRegistry,
  named?: string,
): { kept: Collector[]; unused: string[]; off: string[] } {
  const marketOf = new Map(sources.map((s) => [s.key, s.market]));
  const inUse = marketsInUse(sources, registry.markets);
  const kept: Collector[] = [];
  const unused: string[] = [];
  const off: string[] = [];
  for (const c of collectors.filter((x) => x.runJob)) {
    const market = marketOf.get(c.source);
    if (c.source !== named && market && !inUse.has(market)) unused.push(c.source);
    else if (offEverywhere(registry, c.source)) off.push(c.source);
    else kept.push(c);
  }
  return { kept, unused, off };
}

/** A stamp's line; throws when it cannot be read (the run must not go on without it). */
function readStamp(file: string, text: string) {
  const [when = '', source = '', perDayText, stoppedText] = text.trim().split(/\s+/);
  const at = new Date(when);
  const perDay = Number(perDayText);
  const old = perDayText === undefined && stoppedText === undefined;
  if (
    !source ||
    Number.isNaN(at.getTime()) ||
    (!old &&
      (!Number.isInteger(perDay) ||
        perDay < MARKET_FLOOR ||
        (stoppedText !== '0' && stoppedText !== '1')))
  )
    throw new Error(`unreadable stamp ${file}`);
  return { when, source, at, stamp: old ? undefined : { perDay, stopped: stoppedText === '1' } };
}

/**
 * Replays the refusals kept in stamps (amendment 4) that the database may not hold: one never
 * written (the database failed) or lost (restored from before it). Recorded already, a stamp
 * changes nothing. Run by the job runner before its jobs, and by the collect before it reads the
 * sites refused today ("Refusals"), so a restore never lets a refused marketplace be read again
 * that day. A stamp goes once its wait ended, or an admin restarted after its stop. Returns the
 * marketplaces whose refusal was recorded now. `dryRun`: says what is kept, writes nothing.
 * An unreadable stamp throws (the job runner must not go on without it), unless `unreadable` is
 * given: then it is passed the stamp's file and the site named by the file name while the file
 * is younger than the wait (its time stands for the refusal's), and the other stamps are still
 * replayed (the collect counts that site as refused).
 */
export async function replayMarketStamps(
  db: Db,
  options: {
    stateDir?: string;
    now?: () => Date;
    log?: (line: string) => void;
    dryRun?: boolean;
    unreadable?: (file: string, source: string) => void;
  } = {},
): Promise<string[]> {
  const dir = options.stateDir ?? stateDir();
  const now = options.now ?? (() => new Date());
  const log = options.log ?? console.log;
  const recorded: string[] = [];
  let stamps: string[] = [];
  try {
    // `.tmp`: a stamp being written (renamed when whole).
    stamps = readdirSync(dir).filter((f) => f.startsWith(STAMP) && !f.endsWith('.tmp'));
  } catch {
    // No state folder yet: nothing was refused here.
  }
  for (const file of stamps) {
    let read: ReturnType<typeof readStamp>;
    try {
      read = readStamp(file, readFileSync(join(dir, file), 'utf8'));
    } catch (error) {
      if (!options.unreadable) throw error;
      // Its refusal time cannot be read: the file's own time stands for it, so the site is left
      // alone for one wait, never for good.
      let written = 0;
      try {
        written = statSync(join(dir, file)).mtimeMs;
      } catch {
        // Gone since the listing: nothing to count.
        continue;
      }
      if (now().getTime() < written + MARKET_WAIT_MS)
        options.unreadable(file, file.slice(STAMP.length));
      else log(`${file}: not readable and older than its wait, not counted (remove it)`);
      continue;
    }
    const { when, source, at, stamp } = read;
    if (options.dryRun) {
      log(
        `${source}: refused at ${when} (stamp kept until ${stamp?.stopped ? 'an admin restart' : 'its wait ends'})`,
      );
      continue;
    }
    if (stamp?.stopped) {
      const s = await readMarketState(db, source);
      if (s && !s.stopped && s.restartedBy && Date.parse(s.updatedAt) > at.getTime()) {
        rmSync(join(dir, file), { force: true });
        continue;
      }
    }
    if ((await recordRefusal(db, { source, at, now: now(), stamp })).changed) {
      recorded.push(source);
      log(`${source}: its refusal at ${when} was recorded now`);
    }
    if (!stamp?.stopped && now().getTime() >= at.getTime() + MARKET_WAIT_MS)
      rmSync(join(dir, file), { force: true });
  }
  return recorded;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const defaultWatchdog = (fire: () => void) => {
  const timer = setTimeout(fire, 45_000);
  timer.unref();
  return () => clearTimeout(timer);
};

export async function runMarketJobs(
  db: Db,
  collectors: readonly Collector[],
  options: MarketJobsOptions,
): Promise<MarketJobsReport> {
  const { zone, dryRun = false } = options;
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? realSleep;
  const random = options.random ?? Math.random;
  const dir = options.stateDir ?? stateDir();
  const pid = options.pid ?? process.pid;
  const log = options.log ?? console.log;
  const watchdog = options.watchdog ?? defaultWatchdog;
  const report: MarketJobsReport = { requests: 0, refused: [], errors: [], stops: {} };
  const stop = (source: string, why: string) => {
    report.stops[source] = why;
    log(`${source}: stopped for now (${why})`);
  };

  // A refusal stamped but maybe never written (the database failed, or was restored from before
  // it) is replayed first; recorded already, it changes nothing.
  report.refused.push(...(await replayMarketStamps(db, { stateDir: dir, now, log, dryRun })));
  // A dry run lists the jobs at any hour (each source says why it would not run).
  if (!dryRun && !insideHours(now(), zone)) {
    stop('*', 'hours');
    return report;
  }
  const toBase = dryRun ? null : await baseConverter(db);
  const sources = options.source ? [options.source] : await activeJobSources(db);
  for (const source of sources) {
    try {
      if ((await runSource(source)) === 'run') break;
    } catch (e) {
      report.errors.push(`${source}: ${errorText(e)}`);
      break;
    }
  }
  return report;

  async function runSource(source: string): Promise<'source' | 'run'> {
    const collector = collectors.find((c) => c.source === source && c.runJob);
    // A job still running was cut off mid-step (the lock watchdog's exit, a kill). It counts as one
    // failure, so it goes behind the others and never holds the queue; the run lock rules out
    // another runner.
    if (!dryRun)
      for (const j of await nextJobs(db, source))
        if (j.status === 'running') await releaseJob(db, j.id, 'cut off mid-step');
    const all = await nextJobs(db, source);
    const jobs = all.filter((j) => collector?.jobKinds?.includes(j.kind as MarketJobKind));
    if (jobs.length < all.length)
      log(`${source}: ${all.length - jobs.length} job(s) of a kind no plug-in reads wait`);
    if (!collector || jobs.length === 0) return 'source';
    const t = now();
    const day = localDate(t, zone);
    // A job failing 5 times in a row is tried once a day at most (the W10 review's error rule).
    const skipped = (j: MarketJobRow) => skippedToday(j, t, zone);
    // A refusal at the nightly collect is never worked around (S36 B4); the collect alerted it.
    const last = await lastCollectRun(db, source);
    const collectRefused =
      last?.status === 'blocked' && t.getTime() - Date.parse(last.startedAt) < COLLECT_REFUSAL_MS;
    if (dryRun) {
      const state = (await readMarketState(db, source)) ?? {
        perDay: MARKET_PER_DAY,
        waitUntil: null,
        stopped: false,
      };
      const used = await marketUsed(db, source, day);
      const why = !insideHours(t, zone)
        ? 'hours'
        : collectRefused
          ? 'collect refused'
          : jobs.every(skipped)
            ? 'every job waits for tomorrow'
            : whyNotRun(state, used, t, zone);
      log(
        `${source}: ${jobs.length} job(s); ${Math.max(0, state.perDay - used)} requests left today; ${why ? `would not run (${why})` : 'would run'}`,
      );
      for (const [i, j] of jobs.entries()) {
        const item = j.productId ? ((await getProduct(db, j.productId))?.name ?? j.productId) : '-';
        log(
          `  ${i + 1}. ${j.kind}, ${item}, cursor ${JSON.stringify(j.cursor ?? null)}, failures ${j.failures}${skipped(j) ? ', skipped today' : ''}`,
        );
      }
      return 'source';
    }
    const runnable = jobs.filter((j) => !skipped(j));
    if (runnable.length < jobs.length)
      log(
        `${source}: ${jobs.length - runnable.length} job(s) failing ${MARKET_FAILURES_DAILY}+ times in a row wait for tomorrow`,
      );
    if (runnable.length === 0) return 'source';
    if (collectRefused) {
      stop(source, 'collect refused');
      return 'source';
    }
    await ensureMarketState(db, source);
    const state = (await readMarketState(db, source))!;
    const why = whyNotRun(state, await marketUsed(db, source, day), t, zone);
    if (why) {
      stop(source, why);
      return why === 'hours' ? 'run' : 'source';
    }

    const pace = jobPace(collector.http);
    let step: { jobId: string; requests: number; error?: { e: unknown } } | null = null;
    let held: { release: () => void } | null = null;
    let disarm = () => {};
    const letGo = () => {
      disarm();
      held?.release();
      held = null;
    };
    // Every attempt passes this after the pace wait, so no lock is held while waiting.
    const gate = async () => {
      if (!step || step.requests++ > 0) throw new Stop('twice');
      const jobId = step.jobId;
      const lock = lockSource(source, join(dir, 'locks'), pid, bootId(), 'job');
      if ('heldBy' in lock) throw new Stop('locked', `process ${lock.heldBy}`);
      held = lock;
      disarm = watchdog(() => {
        held?.release();
        console.error(`${source}: a request held its lock 45 s; the runner exits`);
        process.exit(1);
      });
      try {
        if (options.runLockPid === undefined) throw new Error('the run lock is not held');
        const busy = collectBusy({ dir, pid, runLockPid: options.runLockPid });
        if (busy) throw new Stop('collect', busy);
        const at = now();
        if (!insideHours(at, zone)) throw new Stop('hours');
        const asked = await collectRequest(db);
        if (asked && !asked.takenAt) throw new Stop('collect', 'asked for in the app');
        const day = localDate(at, zone);
        if ((await reserveRequest(db, { source, jobId, day, now: at })) === null) {
          const used = await marketUsed(db, source, day);
          throw new Stop(whyNotRun(await readMarketState(db, source), used, at, zone) ?? 'ceiling');
        }
        report.requests++;
      } catch (e) {
        letGo();
        throw e instanceof Stop ? e : new RunError(errorText(e));
      }
    };
    const http = new PoliteHttp({
      ...pace,
      retries: 0,
      timeoutMs: 20_000,
      // A second belt only: the day's count stops first, so a hit is a bug (amendment 6).
      maxRequests: state.perDay + 1,
      fetchImpl: options.fetchImpl ?? ((input, init) => fetch(input, init)),
      sleep,
      random,
      now: () => now().getTime(),
      beforeRequest: gate,
    });
    // An error inside a call is kept even when the plug-in catches it: the step is then discarded.
    const kept = async <R>(call: () => Promise<R>): Promise<R> => {
      try {
        return await call();
      } catch (e) {
        if (step && !step.error) step.error = { e };
        throw e;
      }
    };
    const ctxHttp: JobContext['http'] = {
      text: (url, headers) => kept(() => http.text(url, headers)),
      json: <T>(url: string, headers?: Record<string, string>) =>
        kept(() => http.json<T>(url, headers)),
      postJson: <T>(url: string, body: unknown, headers?: Record<string, string>) =>
        kept(() => http.postJson<T>(url, body, headers)),
      bytes: (url) => kept(() => http.bytes(url)),
    };

    // Where the run goes on after a step failed. The error rule (the W10 review, plan section 11):
    // a refusal waits and halves; the runner's own checks and failures leave the job as it was;
    // any other error (no answer, a body cut off, a timeout, any HTTP status, a page that does not
    // parse, a bad URL, a save that failed) sends the job back to waiting with its error and one
    // more failure, and ends this marketplace's run. Only plug-in faults stop a job.
    const failed = async (jobId: string, e: unknown): Promise<'job' | 'source' | 'run'> => {
      if (e instanceof Stop && e.reason === 'twice') {
        await stopJob(db, jobId, 'more than one request in a step', now());
        return 'job';
      }
      if (e instanceof BlockedError) {
        const at = now();
        // The stamp holds the state this refusal leaves, worked out before the database is written.
        const before = (await readMarketState(db, source).catch(() => null)) ?? state;
        const next = afterRefusal(before.perDay, at);
        const file = join(dir, `${STAMP}${source.replace(/[^\w-]/g, '_')}`);
        try {
          // Whole or not at all: a stamp cut short would stop every later run.
          writeFileSync(
            `${file}.tmp`,
            `${toLocalIso(at)} ${source} ${next.perDay} ${next.stopped ? 1 : 0}\n`,
          );
          renameSync(`${file}.tmp`, file);
        } catch (err) {
          report.errors.push(`${source}: refusal stamp not written (${errorText(err)})`);
        }
        report.refused.push(source);
        const r = await recordRefusal(db, { source, at, jobId, now: at });
        stop(
          source,
          r.stopped
            ? 'refused at the floor: stopped'
            : `refused: ${r.perDay} a day from ${r.waitUntil}`,
        );
        return 'source';
      }
      if (e instanceof Stop || e instanceof RunError || e instanceof RequestCapError)
        await releaseJob(db, jobId);
      if (e instanceof Stop) {
        stop(source, e.message);
        return e.reason === 'hours' || e.reason === 'collect' ? 'run' : 'source';
      }
      if (e instanceof RunError) throw e;
      if (e instanceof RequestCapError) {
        report.errors.push(`${source}: the run's request belt was hit before the day's number`);
        return 'source';
      }
      await releaseJob(db, jobId, errorText(e));
      stop(source, errorText(e));
      return 'source';
    };

    // Rows go under the job's marketplace and its item as read just before the insert. A job about
    // no one item saves rows for game items only; a row for any other item stops it (fix 3). A job
    // about an item saves through the job save path (rule marks, sales under another item left
    // there; S36 B3) and keeps what it found; a deep read or read-back ends with its span.
    const save = async (
      jobId: string,
      kind: string,
      result: JobStep,
      read: JobResult['read'],
    ): Promise<'ok' | 'gone' | 'redo' | 'stopped'> => {
      const target = await jobTarget(db, jobId);
      if (target?.status !== 'running') return 'gone';
      const item = target.productId ? await getProduct(db, target.productId) : null;
      if (target.productId && !item) return 'gone';
      if (target.productId === null) {
        for (const id of new Set(result.rows.map((r) => r.productId))) {
          const p = id ? await getProduct(db, id) : null;
          if (!p || !isGameItem(p, await getItemRules(db, id))) {
            await stopJob(db, jobId, 'a row for an item that is not a game item', now());
            return 'stopped';
          }
        }
      }
      const rows = result.rows.map((r) => ({
        ...r,
        source,
        productId: target.productId ?? r.productId,
      }));
      let found: JobFindings | null = null;
      try {
        if (item)
          found = await saveJobRows(db, { collector, jobId, product: item, rows, toBase: toBase! });
        else await saveObservations(db, toBase!, rows);
      } catch (e) {
        const after = await jobTarget(db, jobId);
        if (after?.status !== 'running') return 'gone';
        if (after.productId !== target.productId) return 'redo';
        throw e;
      }
      const merged = found ? mergeFindings(target.result, found, result.search, read) : undefined;
      // A job of a span kind ends with its span (a tracked game's weekly read as a read-back, S36 step
      // D, W17); a monthly page has none; a load is never run.
      if (merged && result.done && isSpanJobKind(kind) && kind !== LOAD_JOB_KIND)
        return (await finishJob(
          db,
          jobId,
          { oldestReached: result.oldestReached, result: merged },
          now(),
        ))
          ? 'ok'
          : 'gone';
      return (await saveJobStep(db, jobId, result, now(), merged)) ? 'ok' : 'gone';
    };

    // A job ends when a step reached its wanted day, past it by the kind's margin (fix 11).
    const margin = (kind: string) => collector.jobMarginDays?.[kind as MarketJobKind] ?? 0;
    const reachedWanted = (row: MarketJobRow, oldest: string | null) => {
      const days = margin(row.kind);
      if (!row.wantedFrom || !oldest || !Number.isInteger(days) || days < 0) return false;
      const from = Date.parse(`${row.wantedFrom.slice(0, 10)}T00:00:00Z`);
      if (Number.isNaN(from)) return false;
      const until = new Date(from - days * 86_400_000).toISOString().slice(0, 10);
      return /^\d{4}-\d{2}-\d{2}/.test(oldest) && oldest.slice(0, 10) <= until;
    };
    /** Steps in a row with no rows and no older day: this many stop the job (fix 11). */
    const EMPTY_STEPS = 3;

    let paced = false;
    const runOne = async (listed: MarketJobRow): Promise<'job' | 'source' | 'run'> => {
      // The job as claimed, not as listed at the start of the run: a search saved while an
      // earlier job ran reset its cursor and findings (fix round 2, item 1).
      const row = await claimJob(db, listed.id, now());
      if (!row) return 'job';
      let cursor = row.cursor;
      let oldest = row.oldestReached;
      let empty = 0;
      for (;;) {
        const target = await jobTarget(db, row.id);
        if (target?.status !== 'running') return 'job';
        const product = target.productId ? await getProduct(db, target.productId) : null;
        const rules = target.productId ? await getItemRules(db, target.productId) : null;
        if (target.productId && (!product || !isGameItem(product, rules))) {
          await stopJob(db, row.id, 'its item is not a game item', now());
          return 'job';
        }
        // PoliteHttp waits only between requests: the first one waits here.
        if (!paced) {
          paced = true;
          await sleep(pace.minDelayMs + random() * (pace.maxDelayMs - pace.minDelayMs));
        }
        step = { jobId: row.id, requests: 0 };
        try {
          let result: JobStep | null = null;
          let thrown: { e: unknown } | null = null;
          // The search the nightly would send for the item now (S36 B3). No active search: none,
          // and the plug-in ends the job without a request (the closing step stops such jobs).
          // Inside the step, so a throw fails this job like any step (N5). `read`: what it stands
          // for, kept with the job's findings (fix round 1, rule b).
          let read: JobResult['read'];
          try {
            const searched = product ? await jobSearch(db, collector, product) : null;
            const s = searched?.search;
            read = s?.keywords?.length
              ? { keyword: s.keywords.join(' '), categoryId: s.categoryId || null }
              : undefined;
            result = await collector.runJob!(
              {
                id: row.id,
                source,
                kind: row.kind as MarketJobKind,
                productId: target.productId,
                wantedFrom: row.wantedFrom,
                cursor,
              },
              {
                http: ctxHttp,
                now: now(),
                log: (m) => log(`[${source}] ${m}`),
                product,
                search: searched?.search ?? null,
                references: searched?.references ?? [],
              },
            );
          } catch (e) {
            thrown = { e };
          }
          const error = step.error ?? thrown;
          // A second request after a failed first one (a plug-in retrying by itself) was held
          // back unsent: the plug-in's fault, not the site's. A refusal stays a refusal.
          if (error && step.requests > 1 && !(error.e instanceof BlockedError)) {
            await stopJob(db, row.id, 'more than one request in a step', now());
            stop(source, errorText(error.e));
            return 'source';
          }
          if (error) return await failed(row.id, error.e);
          const bad = !result
            ? 'no step returned'
            : !result.done && step.requests === 0
              ? 'a step that is not done made no request'
              : !result.done && JSON.stringify(result.cursor) === JSON.stringify(cursor)
                ? 'a step did not move its cursor'
                : null;
          if (bad) {
            await stopJob(db, row.id, bad, now());
            return 'job';
          }
          const done = result!.done || reachedWanted(row, result!.oldestReached);
          let saved: 'ok' | 'gone' | 'redo' | 'stopped';
          try {
            saved = await save(row.id, row.kind, { ...result!, done }, read);
          } catch (e) {
            return await failed(row.id, new Error(`saving failed: ${errorText(e)}`));
          }
          if (saved === 'gone' || saved === 'stopped' || (saved === 'ok' && done)) return 'job';
          if (saved === 'ok') {
            cursor = result!.cursor;
            const reached = result!.oldestReached;
            const older = !!reached && (!oldest || reached < oldest);
            if (older) oldest = reached;
            empty = result!.rows.length === 0 && !older ? empty + 1 : 0;
            if (empty >= EMPTY_STEPS) {
              await stopJob(db, row.id, `no rows in ${EMPTY_STEPS} steps`, now());
              return 'job';
            }
          }
        } finally {
          step = null;
          letGo();
        }
      }
    };
    for (const row of runnable) {
      const next = await runOne(row);
      if (next !== 'job') return next;
    }
    return 'source';
  }
}
