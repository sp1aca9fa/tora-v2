import { type SourceRegistry, setAppTimeZone } from '@tora/core';
import {
  type Db,
  createDb,
  createProduct,
  createQuerySource,
  createUser,
  ensureMarketState,
  queueMarketJob,
  restartMarket,
  saveSourceInfos,
  schema,
  updateSourceQuery,
} from '@tora/db';
import { migrateDb } from '@tora/db/migrate';
import { TEST_SOURCES } from '@tora/db/testing';
import { eq, notInArray } from 'drizzle-orm';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { holdRunLock } from './lock';
import { type MarketJobsOptions, jobCollectors, runMarketJobs } from './market-jobs';
import type { Collector, JobStep } from './types';

const {
  marketDays,
  marketJobs,
  marketState,
  priceObservations,
  productSources,
  products,
  activity,
  collectorRuns,
  saleSpans,
} = schema;

let db: Db;
let state: string;
let uid: string;
let clock = 0;
let fetched: string[] = [];
let fetchedAt: number[] = [];
/** The answer to the n-th fetch (1-based); default a page. */
let answer: (n: number) => Response = () => Response.json({ ok: true });
let release: () => Promise<void>;
let lockPid: number;

beforeEach(async () => {
  setAppTimeZone('Asia/Tokyo');
  const dir = await mkdtemp(join(tmpdir(), 'tora-jobs-'));
  state = join(dir, 'state');
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  await saveSourceInfos(db, TEST_SOURCES);
  uid = (
    await createUser(db, 'alice', { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] })
  ).user.id;
  const run = await holdRunLock(state);
  if (typeof run !== 'object') throw new Error(`run lock: ${run}`);
  release = run.release;
  lockPid = run.pid;
  fetched = [];
  fetchedAt = [];
  answer = () => Response.json({ ok: true });
  // No job request may go around the runner's http.
  vi.stubGlobal('fetch', () => Promise.reject(new Error('global fetch used')));
  return async () => {
    await release();
    await rm(dir, { recursive: true, force: true });
  };
});
afterEach(() => vi.unstubAllGlobals());

const at = (iso: string) => (clock = Date.parse(iso));
const run = (collector: Collector | Collector[], extra: Partial<MarketJobsOptions> = {}) =>
  runMarketJobs(db, [collector].flat(), {
    zone: 'Asia/Tokyo',
    now: () => new Date(clock),
    sleep: async (ms) => void (clock += ms),
    random: () => 0.5,
    fetchImpl: (async (url: string) => {
      fetched.push(url);
      fetchedAt.push(clock);
      // As fetch: a URL that does not parse fails before any connection.
      if (!URL.canParse(url)) throw new TypeError(`Failed to parse URL from ${url}`);
      return answer(fetched.length);
    }) as typeof fetch,
    stateDir: state,
    runLockPid: lockPid,
    log: () => {},
    watchdog: () => () => {},
    ...extra,
  });

/** A made-up marketplace: one sale per page of a game's search, `pages` pages. */
function plugin(
  step?: (
    job: Parameters<NonNullable<Collector['runJob']>>[0],
    ctx: Parameters<NonNullable<Collector['runJob']>>[1],
  ) => Promise<JobStep>,
  pages = 40,
): Collector {
  return {
    source: 'marketa',
    label: 'Market A',
    supports: () => true,
    findCandidates: async () => [],
    collect: async () => ({ state: {}, complete: true }),
    jobKinds: ['deep'],
    runJob:
      step ??
      (async (job, ctx) => {
        const page = (job.cursor as { page: number } | null)?.page ?? 1;
        await ctx.http.json(`https://marketa.test/search?page=${page}`);
        return {
          rows: [
            {
              productId: job.productId!,
              source: 'marketa',
              observationType: 'sold' as const,
              bucket: 'used',
              price: 1000 + page,
              currency: 'JPY',
              observedAt: '2026-11-01T12:00:00.000+09:00',
              fetchedAt: ctx.now.toISOString(),
              externalRef: `p${page}`,
            },
          ],
          cursor: { page: page + 1 },
          done: page >= pages,
          oldestReached: '2026-11-01',
        };
      }),
  };
}

const game = (name = 'Game A') =>
  createProduct(db, uid, { category: 'game', kind: 'software', name, platform: 'Alpha Station' });
async function setup(perDay = 25) {
  const g = await game();
  const job = await queueMarketJob(db, { source: 'marketa', productId: g.id, kind: 'deep' });
  await ensureMarketState(db, 'marketa');
  await db.update(marketState).set({ perDay }).where(eq(marketState.source, 'marketa'));
  return { g, job };
}
const jobRow = async (id: string) =>
  (await db.select().from(marketJobs).where(eq(marketJobs.id, id)))[0]!;
const rows = () => db.select().from(priceObservations);
const used = async () => (await db.select().from(marketDays))[0]?.used ?? 0;
/** Three jobs on Game A, B and C, queued in that order. */
async function three() {
  await ensureMarketState(db, 'marketa');
  const jobs: Awaited<ReturnType<typeof queueMarketJob>>[] = [];
  for (const [i, name] of ['Game A', 'Game B', 'Game C'].entries()) {
    const g = await game(name);
    const j = await queueMarketJob(db, { source: 'marketa', productId: g.id, kind: 'deep' });
    await db
      .update(marketJobs)
      .set({ createdAt: `2026-11-0${i + 1}T00:00:00.000+09:00` })
      .where(eq(marketJobs.id, j.id));
    jobs.push(j);
  }
  return jobs as [(typeof jobs)[0], (typeof jobs)[0], (typeof jobs)[0]];
}
/** One page per job, its URL naming the item (`base` '': a URL that does not parse). */
const named = (base = 'https://marketa.test') =>
  plugin(async (_job, ctx) => {
    await ctx.http.json(`${base}/search?q=${encodeURIComponent(ctx.product!.name)}`);
    return { rows: [], cursor: null, done: true, oldestReached: null };
  });
/** The item a fetch of `named` was for. */
const item = (url: string) => new URL(url, 'https://marketa.test').searchParams.get('q');

describe('the daytime job runner (S36 B4)', () => {
  it("reads page by page, one request each, until the day's number", async () => {
    const { g, job } = await setup();
    at('2026-11-24T05:00:00+09:00');
    const report = await run(plugin());
    expect(fetched).toHaveLength(25);
    expect(report).toMatchObject({ requests: 25, errors: [], stops: { marketa: 'ceiling' } });
    // One pace (15 s) before the first request, 15 s between the others.
    expect(new Date(fetchedAt[0]!).toISOString()).toBe('2026-11-23T20:00:15.000Z');
    expect(new Date(fetchedAt[24]!).toISOString()).toBe('2026-11-23T20:06:15.000Z');
    expect(await used()).toBe(25);
    expect(await jobRow(job.id)).toMatchObject({
      status: 'waiting',
      cursor: { page: 26 },
      requests: 25,
      oldestReached: '2026-11-01',
    });
    const saved = await rows();
    expect(saved).toHaveLength(25);
    expect(saved.every((r) => r.productId === g.id && r.source === 'marketa')).toBe(true);
    // The next day goes on from page 26 and finishes at 40.
    at('2026-11-25T05:00:00+09:00');
    await run(plugin());
    expect(fetched).toHaveLength(40);
    expect(await jobRow(job.id)).toMatchObject({ status: 'done', cursor: null, requests: 40 });
  });

  it('discards a step whose request failed, even when the plug-in caught the error', async () => {
    const { job } = await setup();
    const swallow = plugin(async (j, ctx) => {
      try {
        await ctx.http.json('https://marketa.test/search?page=1');
      } catch {
        // A careless plug-in.
      }
      return { rows: [], cursor: null, done: true, oldestReached: null };
    });
    // The pace wait crosses 22:00: the check before the request says no.
    at('2026-11-24T21:59:50+09:00');
    expect((await run(swallow)).stops).toEqual({ marketa: 'hours' });
    expect(fetched).toHaveLength(0);
    // The runner's own check said no: not a failure of the job.
    expect(await jobRow(job.id)).toMatchObject({
      status: 'waiting',
      cursor: null,
      requests: 0,
      failures: 0,
      error: null,
    });
    // A server error: one fetch, one count (no retry), the job waits, the marketplace ends.
    answer = () => new Response('busy', { status: 503 });
    at('2026-11-24T12:00:00+09:00');
    expect((await run(swallow)).stops.marketa).toMatch(/HTTP 503/);
    expect(fetched).toHaveLength(1);
    expect(await used()).toBe(1);
    expect(await jobRow(job.id)).toMatchObject({
      status: 'waiting',
      requests: 1,
      failures: 1,
      error: expect.stringMatching(/HTTP 503/),
    });
    expect(await rows()).toHaveLength(0);
  });

  it('a refusal halves the number, waits, is stamped and replayed once the database lost it', async () => {
    const { job } = await setup(200);
    answer = (n) => (n === 3 ? new Response('no', { status: 403 }) : Response.json({}));
    at('2026-11-24T12:00:00+09:00');
    const report = await run(plugin());
    expect(fetched).toHaveLength(3);
    expect(report.refused).toEqual(['marketa']);
    expect(await jobRow(job.id)).toMatchObject({ status: 'waiting', cursor: { page: 3 } });
    expect(await db.select().from(marketState)).toMatchObject([{ perDay: 100, refusals: 1 }]);
    // The state it left: 100 a day, not stopped.
    expect(readFileSync(join(state, 'market-refused-marketa'), 'utf8')).toMatch(
      / marketa 100 0\n$/,
    );
    // Again the same day: waiting, nothing sent, nothing recorded twice.
    expect(await run(plugin())).toMatchObject({ refused: [], stops: { marketa: 'waiting' } });
    expect(fetched).toHaveLength(3);
    // A restore from before the refusal: the stamp puts it back, one entry still.
    await db.delete(marketState);
    expect((await run(plugin())).refused).toEqual(['marketa']);
    expect(fetched).toHaveLength(3);
    expect(await db.select().from(marketState)).toMatchObject([{ perDay: 100 }]);
    expect(await db.select().from(activity).where(eq(activity.kind, 'admin'))).toHaveLength(1);
    // The stamp goes once its wait (72 h from the refusal at 12:00:45) is over.
    at('2026-11-27T12:00:44+09:00');
    await run(plugin());
    expect(existsSync(join(state, 'market-refused-marketa'))).toBe(true);
    at('2026-11-27T12:00:45+09:00');
    await run(plugin());
    expect(existsSync(join(state, 'market-refused-marketa'))).toBe(false);
  });

  it('stops a job at a second request in a step, or a cursor that does not move', async () => {
    const { g, job } = await setup();
    at('2026-11-24T12:00:00+09:00');
    const twice = plugin(async (_j, ctx) => {
      await ctx.http.json('https://marketa.test/1');
      await ctx.http.json('https://marketa.test/2');
      return { rows: [], cursor: 2, done: false, oldestReached: null };
    });
    await run(twice);
    expect(fetched).toHaveLength(1);
    expect(await jobRow(job.id)).toMatchObject({
      status: 'stopped',
      error: 'more than one request in a step',
    });
    const stuck = plugin(async (j, ctx) => {
      await ctx.http.json('https://marketa.test/1');
      return { rows: [], cursor: j.cursor, done: false, oldestReached: null };
    });
    const second = await queueMarketJob(db, { source: 'marketa', productId: g.id, kind: 'deep' });
    await run(stuck);
    expect(await jobRow(second.id)).toMatchObject({
      status: 'stopped',
      error: 'a step did not move its cursor',
    });
  });

  it('stops a job whose item is no longer a game before any request', async () => {
    const { g, job } = await setup();
    await db.update(products).set({ category: 'tcg', kind: 'single' }).where(eq(products.id, g.id));
    at('2026-11-24T12:00:00+09:00');
    await run(plugin());
    expect(fetched).toHaveLength(0);
    expect(await jobRow(job.id)).toMatchObject({ status: 'stopped' });
    expect(await used()).toBe(0);
  });

  it('a dry run reads only: no statement but SELECT, nothing in the state folder', async () => {
    const a = await game();
    const g = await game('Game B');
    const failing = await queueMarketJob(db, { source: 'marketa', productId: g.id, kind: 'deep' });
    await queueMarketJob(db, { source: 'marketa', productId: a.id, kind: 'readback' });
    // Failed 5 times in a row, last tried this morning: skipped today.
    await db
      .update(marketJobs)
      .set({ failures: 5, startedAt: '2026-11-24T06:00:00.000+09:00' })
      .where(eq(marketJobs.id, failing.id));
    const both = { ...plugin(), jobKinds: ['readback', 'deep'] as const };
    const client = db.$client;
    const execute = client.execute.bind(client);
    const writes: string[] = [];
    client.execute = ((stmt: string | { sql: string }) => {
      const sql = typeof stmt === 'string' ? stmt : stmt.sql;
      if (!/^\s*select/i.test(sql)) writes.push(sql);
      return execute(stmt as string);
    }) as typeof client.execute;
    client.batch = (() => Promise.reject(new Error('batch in a dry run'))) as typeof client.batch;
    const before = readdirSync(state).sort();
    const lines: string[] = [];
    at('2026-11-24T12:00:00+09:00');
    const report = await run(both, { dryRun: true, log: (l) => lines.push(l) });
    expect(writes).toEqual([]);
    expect(fetched).toHaveLength(0);
    expect(report).toMatchObject({ requests: 0, errors: [] });
    expect(readdirSync(state).sort()).toEqual(before);
    // In run order (failing jobs last), with what is left of the day.
    expect(lines).toEqual([
      'marketa: 2 job(s); 200 requests left today; would run',
      '  1. readback, Game A, cursor null, failures 0',
      '  2. deep, Game B, cursor null, failures 5, skipped today',
    ]);
    // Outside the hours it still lists them, and says why it would not run.
    lines.length = 0;
    at('2026-11-24T23:00:00+09:00');
    expect((await run(both, { dryRun: true, log: (l) => lines.push(l) })).stops).toEqual({});
    expect(lines[0]).toBe('marketa: 2 job(s); 200 requests left today; would not run (hours)');
    expect(lines).toHaveLength(3);
    // The next day it would be tried again.
    lines.length = 0;
    at('2026-11-25T12:00:00+09:00');
    await run(both, { dryRun: true, log: (l) => lines.push(l) });
    expect(lines[2]).toBe('  2. deep, Game B, cursor null, failures 5');
    // Only jobs skipped today: it says so, as the real run would send nothing.
    lines.length = 0;
    at('2026-11-24T12:00:00+09:00');
    await run(plugin(), { dryRun: true, log: (l) => lines.push(l) });
    expect(lines).toEqual([
      'marketa: 1 job(s) of a kind no plug-in reads wait',
      'marketa: 1 job(s); 200 requests left today; would not run (every job waits for tomorrow)',
      '  1. deep, Game B, cursor null, failures 5, skipped today',
    ]);
    expect(writes).toEqual([]);
  });
  it('a failed step sends its job back with its error and one more failure, and ends the marketplace', async () => {
    const [a, b, c] = await three();
    answer = () => {
      throw new TypeError('fetch failed');
    };
    at('2026-11-24T12:00:00+09:00');
    expect((await run(named())).stops.marketa).toMatch(/fetch failed/);
    expect(fetched).toHaveLength(1);
    expect(await used()).toBe(1);
    expect(await jobRow(a.id)).toMatchObject({
      status: 'waiting',
      failures: 1,
      error: 'TypeError: fetch failed',
    });
    for (const j of [b, c])
      expect(await jobRow(j.id)).toMatchObject({ status: 'waiting', failures: 0, requests: 0 });
    // The next run takes the next job first; the failing one waits behind it.
    answer = () => Response.json({});
    await run(named());
    expect(fetched.map(item)).toEqual(['Game A', 'Game B', 'Game C', 'Game A']);
    for (const j of [a, b, c])
      expect(await jobRow(j.id)).toMatchObject({ status: 'done', failures: 0, error: null });
  });

  const body = (text: () => Promise<string>) =>
    ({ status: 200, ok: true, headers: new Headers(), text }) as unknown as Response;
  it.each([
    ['a body cut off', () => body(() => Promise.reject(new TypeError('terminated'))), /terminated/],
    [
      'a body that times out',
      () => body(() => Promise.reject(new DOMException('timed out', 'TimeoutError'))),
      /TimeoutError/,
    ],
    ['a 503', () => new Response('busy', { status: 503 }), /HTTP 503/],
    ['a 401', () => new Response('who are you', { status: 401 }), /HTTP 401/],
    ['a page that does not parse', () => new Response('<p>sold</p>'), /invalid JSON/],
    ['a relative URL', 'relative', /Failed to parse URL/],
  ] as const)('%s: the same', async (_name, give, error) => {
    const [a, b, c] = await three();
    const step = give === 'relative' ? named('') : named();
    if (give !== 'relative') answer = give;
    at('2026-11-24T12:00:00+09:00');
    expect((await run(step)).stops.marketa).toMatch(error);
    expect(fetched).toHaveLength(1);
    expect(await used()).toBe(1);
    expect(await jobRow(a.id)).toMatchObject({
      status: 'waiting',
      requests: 1,
      failures: 1,
      error: expect.stringMatching(error),
    });
    for (const j of [b, c]) expect(await jobRow(j.id)).toMatchObject({ failures: 0, requests: 0 });
    at('2026-11-24T12:30:00+09:00');
    await run(step);
    expect(fetched.map(item)).toEqual(['Game A', 'Game B']);
    expect(await jobRow(b.id)).toMatchObject({ status: 'waiting', failures: 1 });
  });

  it('a 401 on every request: one request a run, no job stopped, the failures spread', async () => {
    const jobs = await three();
    answer = () => new Response('who are you', { status: 401 });
    for (let i = 0; i < 6; i++) {
      at(`2026-11-24T1${i}:00:00+09:00`);
      await run(named());
    }
    expect(fetched).toHaveLength(6);
    expect(fetched.map(item)).toEqual(['Game A', 'Game B', 'Game C', 'Game A', 'Game B', 'Game C']);
    expect(await used()).toBe(6);
    for (const j of jobs)
      expect(await jobRow(j.id)).toMatchObject({ status: 'waiting', failures: 2 });
  });

  it('a saved step after 2 failures clears the failures and the error', async () => {
    const { job } = await setup();
    answer = () => new Response('who are you', { status: 401 });
    at('2026-11-24T12:00:00+09:00');
    await run(plugin(undefined, 3));
    at('2026-11-24T12:30:00+09:00');
    await run(plugin(undefined, 3));
    expect(await jobRow(job.id)).toMatchObject({
      failures: 2,
      error: expect.stringMatching(/401/),
    });
    // One page read, then the day's number.
    await db
      .insert(marketDays)
      .values({ source: 'marketa', day: '2026-11-24', used: 24, limitThatDay: 25 })
      .onConflictDoUpdate({
        target: [marketDays.source, marketDays.day],
        set: { used: 24, limitThatDay: 25 },
      });
    answer = () => Response.json({});
    at('2026-11-24T13:00:00+09:00');
    expect((await run(plugin(undefined, 3))).stops).toEqual({ marketa: 'ceiling' });
    expect(await jobRow(job.id)).toMatchObject({
      status: 'waiting',
      cursor: { page: 2 },
      failures: 0,
      error: null,
    });
  });

  it('a second request after a failed first one stops the job: the plug-in retried by itself', async () => {
    const [a, b] = await three();
    answer = () => new Response('busy', { status: 503 });
    const retrying = plugin(async (_j, ctx) => {
      const url = 'https://marketa.test/search';
      await ctx.http.json(url).catch(() => ctx.http.json(url));
      return { rows: [], cursor: null, done: true, oldestReached: null };
    });
    at('2026-11-24T12:00:00+09:00');
    expect((await run(retrying)).stops.marketa).toMatch(/503/);
    // The retry was held back unsent, and the marketplace's run ended there.
    expect(fetched).toHaveLength(1);
    expect(await used()).toBe(1);
    expect(await jobRow(a.id)).toMatchObject({
      status: 'stopped',
      error: 'more than one request in a step',
    });
    expect(await jobRow(b.id)).toMatchObject({ status: 'waiting', failures: 0, requests: 0 });
  });

  it('a job cut off mid-step counts one failure and goes behind the others', async () => {
    const [a, b, c] = await three();
    // The runner was killed while Game A's step held the lock: the job is still running.
    await db.update(marketJobs).set({ status: 'running' }).where(eq(marketJobs.id, a.id));
    at('2026-11-24T12:00:00+09:00');
    // A dry run leaves it as it is.
    await run(named(), { dryRun: true, log: () => {} });
    expect(await jobRow(a.id)).toMatchObject({ status: 'running', failures: 0 });
    answer = (n) =>
      item(fetched[n - 1]!) === 'Game A' ? new Response('no', { status: 500 }) : Response.json({});
    await run(named());
    expect(fetched.map(item)).toEqual(['Game B', 'Game C', 'Game A']);
    expect(await jobRow(a.id)).toMatchObject({ status: 'waiting', failures: 2 });
    for (const j of [b, c]) expect(await jobRow(j.id)).toMatchObject({ status: 'done' });
  });

  it('after 5 failures a job is tried once a day; the jobs behind it run', async () => {
    const [a, b] = await three();
    await db.delete(marketJobs).where(notInArray(marketJobs.id, [a.id, b.id]));
    // Both failed 5 times or more in a row, last tried yesterday.
    const yesterday = '2026-11-23T20:00:00.000+09:00';
    await db
      .update(marketJobs)
      .set({ failures: 5, startedAt: yesterday })
      .where(eq(marketJobs.id, a.id));
    await db
      .update(marketJobs)
      .set({ failures: 7, startedAt: yesterday })
      .where(eq(marketJobs.id, b.id));
    answer = (n) =>
      item(fetched[n - 1]!) === 'Game A' ? new Response('no', { status: 401 }) : Response.json({});
    at('2026-11-24T12:00:00+09:00');
    await run(named());
    expect(fetched.map(item)).toEqual(['Game A']);
    expect(await jobRow(a.id)).toMatchObject({ status: 'waiting', failures: 6 });
    // Later today: A waits for tomorrow, B behind it is read.
    at('2026-11-24T12:30:00+09:00');
    await run(named());
    expect(fetched.map(item)).toEqual(['Game A', 'Game B']);
    expect(await jobRow(b.id)).toMatchObject({ status: 'done', failures: 0 });
    at('2026-11-24T21:30:00+09:00');
    await run(named());
    expect(fetched).toHaveLength(2);
    // Tomorrow, once.
    at('2026-11-25T05:00:00+09:00');
    await run(named());
    at('2026-11-25T05:30:00+09:00');
    await run(named());
    expect(fetched.map(item)).toEqual(['Game A', 'Game B', 'Game A']);
    expect(await jobRow(a.id)).toMatchObject({ status: 'waiting', failures: 7 });
  });

  it('a refusal after failures is still a refusal: wait, halve, alert', async () => {
    const { job } = await setup(200);
    answer = () => new Response('who are you', { status: 401 });
    at('2026-11-24T12:00:00+09:00');
    await run(plugin());
    at('2026-11-24T12:30:00+09:00');
    await run(plugin());
    answer = () => new Response('no', { status: 403 });
    at('2026-11-24T13:00:00+09:00');
    expect((await run(plugin())).refused).toEqual(['marketa']);
    expect(fetched).toHaveLength(3);
    expect(await db.select().from(marketState)).toMatchObject([
      { perDay: 100, waitUntil: expect.any(String), refusals: 1 },
    ]);
    expect(
      (await db.select().from(activity).where(eq(activity.kind, 'admin'))).map((e) => e.action),
    ).toEqual(['marketRefused']);
    expect(await jobRow(job.id)).toMatchObject({ status: 'waiting', failures: 2 });
  });

  it('a job about no one item stops at a row for an item that is not a game', async () => {
    await setup();
    const card = await game('Card C');
    await db
      .update(products)
      .set({ category: 'tcg', kind: 'single' })
      .where(eq(products.id, card.id));
    await db.delete(marketJobs);
    const job = await queueMarketJob(db, { source: 'marketa', productId: null, kind: 'deep' });
    const monthly = plugin(async (_j, ctx) => {
      await ctx.http.json('https://marketa.test/month');
      return {
        rows: [
          {
            productId: card.id,
            source: 'marketa',
            observationType: 'sold' as const,
            bucket: 'used',
            price: 900,
            currency: 'JPY',
            observedAt: '2026-11-01T12:00:00.000+09:00',
            fetchedAt: ctx.now.toISOString(),
            externalRef: 'month-1',
          },
        ],
        cursor: { page: 2 },
        done: false,
        oldestReached: '2026-11-01',
      };
    });
    at('2026-11-24T12:00:00+09:00');
    await run(monthly);
    expect(fetched).toHaveLength(1);
    expect(await rows()).toHaveLength(0);
    expect(await jobRow(job.id)).toMatchObject({
      status: 'stopped',
      error: 'a row for an item that is not a game item',
    });
  });

  it('a collect refused within a day keeps the marketplace away', async () => {
    const { job } = await setup();
    await db
      .insert(collectorRuns)
      .values({ source: 'marketa', startedAt: '2026-11-24T03:00:00.000+09:00', status: 'blocked' });
    at('2026-11-24T05:10:00+09:00');
    expect((await run(plugin(undefined, 1))).stops).toEqual({ marketa: 'collect refused' });
    expect(fetched).toHaveLength(0);
    expect(await db.select().from(marketState)).toMatchObject([{ perDay: 25, stopped: false }]);
    await db
      .update(collectorRuns)
      .set({ startedAt: '2026-11-23T04:10:00.000+09:00' })
      .where(eq(collectorRuns.source, 'marketa'));
    await run(plugin(undefined, 1));
    expect(fetched).toHaveLength(1);
    expect(await jobRow(job.id)).toMatchObject({ status: 'done' });
  });

  it("a stamp's state is the stricter one at a replay; a stop's stamp waits for a restart", async () => {
    await setup(200);
    const stamp = join(state, 'market-refused-marketa');
    // A restore put the number back to 200; the refusal had left 50.
    writeFileSync(stamp, '2026-11-24T12:00:00.000+09:00 marketa 50 0\n');
    at('2026-11-24T13:00:00+09:00');
    expect(await run(plugin())).toMatchObject({
      refused: ['marketa'],
      stops: { marketa: 'waiting' },
    });
    expect(await db.select().from(marketState)).toMatchObject([{ perDay: 50, stopped: false }]);
    // An older stamp (time and source only) halves the restored number, as before.
    await db.delete(marketState);
    await ensureMarketState(db, 'marketa');
    writeFileSync(stamp, '2026-11-24T12:00:00.000+09:00 marketa\n');
    await run(plugin());
    expect(await db.select().from(marketState)).toMatchObject([{ perDay: 100 }]);
    // A stop: kept past 72 h, replayed over a restored row, gone after an admin restart.
    await db.update(marketState).set({ perDay: 200, lastRefusalAt: null, waitUntil: null });
    writeFileSync(stamp, '2026-11-24T12:00:00.000+09:00 marketa 25 1\n');
    at('2026-11-28T12:00:00+09:00');
    expect((await run(plugin())).stops).toEqual({ marketa: 'stopped' });
    expect(await db.select().from(marketState)).toMatchObject([{ perDay: 25, stopped: true }]);
    expect(existsSync(stamp)).toBe(true);
    expect(fetched).toHaveLength(0);
    await restartMarket(db, 'marketa', uid, new Date(clock));
    await run(plugin(undefined, 1));
    expect(existsSync(stamp)).toBe(false);
    expect(fetched).toHaveLength(1);
  });

  it('a stamp is written whole or not at all', async () => {
    await setup(200);
    // A leftover from a write cut short is not a stamp.
    writeFileSync(join(state, 'market-refused-marketa.tmp'), '');
    at('2026-11-24T12:00:00+09:00');
    expect((await run(plugin(undefined, 1))).errors).toEqual([]);
    expect(fetched).toHaveLength(1);
    // The write fails: no stamp, an error, the refusal still recorded.
    await db.update(marketJobs).set({ status: 'waiting', cursor: null });
    rmSync(join(state, 'market-refused-marketa.tmp'));
    mkdirSync(join(state, 'market-refused-marketa.tmp'));
    answer = () => new Response('no', { status: 403 });
    const report = await run(plugin(undefined, 1));
    expect(report.errors).toEqual([expect.stringMatching(/refusal stamp not written/)]);
    expect(report.refused).toEqual(['marketa']);
    expect(existsSync(join(state, 'market-refused-marketa'))).toBe(false);
    expect(await db.select().from(marketState)).toMatchObject([{ perDay: 100 }]);
  });

  it("the admin's switches leave sources out, as the collect does", async () => {
    await setup();
    at('2026-11-24T12:00:00+09:00');
    const infos = [
      { key: 'marketa', label: 'Market A', market: 'us' },
      { key: 'marketb', label: 'Market B', market: 'jp' },
    ];
    const registry = (roles: SourceRegistry['roles'], primary = 'jp'): SourceRegistry => ({
      sources: infos,
      roles,
      markets: { primary, secondary: null },
    });
    const inUse = registry({ marketa: { game: 'comparison' } });
    // Its market is not in use: left out, unless named.
    const out = jobCollectors([plugin()], infos, inUse);
    expect(out).toMatchObject({ kept: [], unused: ['marketa'], off: [] });
    await run(out.kept);
    expect(fetched).toHaveLength(0);
    const named = jobCollectors([plugin()], infos, inUse, 'marketa');
    expect(named.kept).toHaveLength(1);
    await run(named.kept, { source: 'marketa' });
    expect(fetched.length).toBeGreaterThan(0);
    // Off for every item type: left out, named or not.
    const off = registry({ marketa: { game: 'off' } }, 'us');
    expect(jobCollectors([plugin()], infos, off, 'marketa')).toMatchObject({
      kept: [],
      off: ['marketa'],
    });
  });

  it("a job ends at its wanted day past the kind's margin, or after 3 empty steps", async () => {
    const g = await game();
    await ensureMarketState(db, 'marketa');
    const days = [
      '2026-10-20',
      '2026-10-10',
      '2026-09-30',
      '2026-09-20',
      '2026-09-10',
      '2026-08-31',
    ];
    const back = (margin: number) => ({
      ...plugin(async (j, ctx) => {
        const page = (j.cursor as { page: number } | null)?.page ?? 1;
        await ctx.http.json(`https://marketa.test/back?page=${page}`);
        return {
          rows: [
            {
              productId: j.productId!,
              source: 'marketa',
              observationType: 'sold' as const,
              bucket: 'used',
              price: 1000,
              currency: 'JPY',
              observedAt: `${days[page - 1]}T12:00:00.000+09:00`,
              fetchedAt: ctx.now.toISOString(),
              externalRef: `m${margin}p${page}`,
            },
          ],
          cursor: { page: page + 1 },
          done: false,
          oldestReached: days[page - 1]!,
        };
      }),
      jobMarginDays: { deep: margin },
    });
    at('2026-11-24T12:00:00+09:00');
    let job = await queueMarketJob(db, {
      source: 'marketa',
      productId: g.id,
      kind: 'deep',
      wantedFrom: '2026-10-01',
    });
    await run(back(0));
    expect(fetched).toHaveLength(3);
    expect(await jobRow(job.id)).toMatchObject({ status: 'done', oldestReached: '2026-09-30' });
    // 28 days past it: 2026-09-03 or older.
    fetched = [];
    job = await queueMarketJob(db, {
      source: 'marketa',
      productId: g.id,
      kind: 'deep',
      wantedFrom: '2026-10-01',
    });
    await run(back(28));
    expect(fetched).toHaveLength(6);
    expect(await jobRow(job.id)).toMatchObject({ status: 'done', oldestReached: '2026-08-31' });
    // A plug-in that never says done and finds nothing.
    fetched = [];
    job = await queueMarketJob(db, { source: 'marketa', productId: g.id, kind: 'deep' });
    const empty = plugin(async (j, ctx) => {
      const page = (j.cursor as { page: number } | null)?.page ?? 1;
      await ctx.http.json(`https://marketa.test/none?page=${page}`);
      return { rows: [], cursor: { page: page + 1 }, done: false, oldestReached: null };
    });
    await run(empty);
    expect(fetched).toHaveLength(3);
    expect(await jobRow(job.id)).toMatchObject({ status: 'stopped', error: 'no rows in 3 steps' });
  });

  it('at the ceiling, a swallowed refusal of the check discards the step', async () => {
    const { job } = await setup(25);
    await db
      .insert(marketDays)
      .values({ source: 'marketa', day: '2026-11-24', used: 24, limitThatDay: 25 });
    const swallow = plugin(async (j, ctx) => {
      const page = (j.cursor as { page: number } | null)?.page ?? 1;
      try {
        await ctx.http.json(`https://marketa.test/search?page=${page}`);
      } catch {
        // A careless plug-in.
      }
      const row = {
        productId: j.productId!,
        source: 'marketa',
        observationType: 'sold' as const,
        bucket: 'used',
        price: 1000 + page,
        currency: 'JPY',
        observedAt: '2026-11-01T12:00:00.000+09:00',
        fetchedAt: ctx.now.toISOString(),
        externalRef: `c${page}`,
      };
      return { rows: [row], cursor: { page: page + 1 }, done: page >= 2, oldestReached: null };
    });
    at('2026-11-24T12:00:00+09:00');
    expect((await run(swallow)).stops).toEqual({ marketa: 'ceiling' });
    expect(fetched).toHaveLength(1);
    expect(await used()).toBe(25);
    expect(await jobRow(job.id)).toMatchObject({ status: 'waiting', cursor: { page: 2 } });
    expect(await rows()).toHaveLength(1);
  });
  it('a search saved again mid-step: the page in flight saves nothing, the job starts over', async () => {
    const { g, job } = await setup();
    await createQuerySource(db, g.id, 'marketa', { keywords: ['Game A'] });
    const [link] = await db.select().from(productSources).where(eq(productSources.productId, g.id));
    const base = plugin();
    const editing = plugin(async (j, ctx) => {
      const step = await base.runJob!(j, ctx);
      // The search form saved with nothing changed while page 3 was being read.
      if ((j.cursor as { page: number } | null)?.page === 3)
        await updateSourceQuery(db, link!.id, link!.query!);
      return step;
    });
    at('2026-11-24T12:00:00+09:00');
    await run(editing);
    expect(fetched).toHaveLength(3);
    const stamped = (await rows()).filter(
      (r) => (r.raw as { job?: string } | null)?.job === job.id,
    );
    expect(stamped).toEqual([]);
    expect(await db.select().from(saleSpans)).toEqual([]);
    expect(await jobRow(job.id)).toMatchObject({
      status: 'waiting',
      cursor: null,
      oldestReached: null,
      result: null,
    });
    // The next run reads from page 1 again.
    at('2026-11-24T13:00:00+09:00');
    await run(plugin(undefined, 2));
    expect(fetched.slice(3)).toEqual([
      'https://marketa.test/search?page=1',
      'https://marketa.test/search?page=2',
    ]);
  });

  it('a search saved while another job of the run is read: that job starts over from its first page', async () => {
    // Game B: 30 pages, its search saved while Game A's job (listed first, 1 page) is read.
    const a = await game('Game A');
    const b = await game('Game B');
    await createQuerySource(db, b.id, 'marketa', { keywords: ['Game B'] });
    const [link] = await db.select().from(productSources).where(eq(productSources.productId, b.id));
    const paged = (saveOn?: string) =>
      plugin(async (j, ctx) => {
        const name = ctx.product!.name;
        const page = (j.cursor as { page: number } | null)?.page ?? 1;
        await ctx.http.json(`https://marketa.test/search?q=${encodeURIComponent(name)}&p=${page}`);
        if (name === saveOn) await updateSourceQuery(db, link!.id, link!.query!);
        const row = {
          productId: j.productId!,
          source: 'marketa',
          observationType: 'sold' as const,
          bucket: 'used',
          price: 1000 + page,
          currency: 'JPY',
          observedAt: '2026-11-01T12:00:00.000+09:00',
          fetchedAt: ctx.now.toISOString(),
          externalRef: `${name}-p${page}`,
        };
        const last = name === 'Game B' ? 30 : 1;
        return {
          rows: [row],
          cursor: { page: page + 1 },
          done: page >= last,
          oldestReached: '2026-06-01',
          // The marketplace's saved search, first read on the 25th: B's read can end with a span.
          search: { key: `k-${name}`, day: '2026-11-25' },
        };
      });
    const jobB = await queueMarketJob(db, { source: 'marketa', productId: b.id, kind: 'deep' });
    await ensureMarketState(db, 'marketa');
    await db.update(marketState).set({ perDay: 25 }).where(eq(marketState.source, 'marketa'));
    // The first day reads 25 of B's pages: its stored cursor is at page 26.
    at('2026-11-24T05:00:00+09:00');
    await run(paged());
    expect(await jobRow(jobB.id)).toMatchObject({ status: 'waiting', cursor: { page: 26 } });
    // The next day lists A, then B; A's step saves B's search with nothing changed.
    const jobA = await queueMarketJob(db, { source: 'marketa', productId: a.id, kind: 'deep' });
    await db
      .update(marketJobs)
      .set({ createdAt: '2026-11-01T00:00:00.000+09:00' })
      .where(eq(marketJobs.id, jobA.id));
    await db.update(marketState).set({ perDay: 100 }).where(eq(marketState.source, 'marketa'));
    at('2026-11-25T05:00:00+09:00');
    await run(paged('Game A'));
    const pages = (name: string) =>
      fetched
        .slice(25)
        .map((u) => new URL(u).searchParams)
        .filter((q) => q.get('q') === name)
        .map((q) => Number(q.get('p')));
    expect(pages('Game A')).toEqual([1]);
    expect(pages('Game B')).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    expect(await jobRow(jobB.id)).toMatchObject({ status: 'done' });
    // Every page of B's span holds its row again: none rests on a deleted one.
    const ofB = (await rows()).filter((r) => r.productId === b.id).map((r) => r.externalRef);
    expect(new Set(ofB)).toEqual(new Set(Array.from({ length: 30 }, (_, i) => `Game B-p${i + 1}`)));
    const spansOfB = (await db.select().from(saleSpans)).filter((s) => s.productId === b.id);
    expect(spansOfB.map((s) => s.jobId)).toEqual([jobB.id]);
  });

  it("a tracked game's weekly read ends with a read-back span; a monthly page with none (F7)", async () => {
    await ensureMarketState(db, 'marketa');
    const jobs = [];
    for (const [name, kind] of [
      ['Game W', 'tracked_weekly'],
      ['Game M', 'monthly'],
    ] as const) {
      const g = await game(name);
      await createQuerySource(db, g.id, 'marketa', { keywords: [name] });
      jobs.push(await queueMarketJob(db, { source: 'marketa', productId: g.id, kind }));
    }
    const once = plugin(async (j, ctx) => {
      await ctx.http.json(`https://marketa.test/search?q=${encodeURIComponent(ctx.product!.name)}`);
      return {
        rows: [
          {
            productId: j.productId!,
            source: 'marketa',
            observationType: 'sold' as const,
            bucket: 'used',
            price: 1000,
            currency: 'JPY',
            observedAt: '2026-11-01T12:00:00.000+09:00',
            fetchedAt: ctx.now.toISOString(),
            externalRef: `${ctx.product!.name}-1`,
          },
        ],
        cursor: null,
        done: true,
        oldestReached: '2026-06-01',
        search: { key: `k-${ctx.product!.name}`, day: '2026-11-01' },
      };
    });
    at('2026-11-24T12:00:00+09:00');
    await run({ ...once, jobKinds: ['tracked_weekly', 'monthly'] });
    expect((await Promise.all(jobs.map((j) => jobRow(j.id)))).map((j) => j.status)).toEqual([
      'done',
      'done',
    ]);
    expect((await db.select().from(saleSpans)).map((s) => [s.jobId, s.how])).toEqual([
      [jobs[0]!.id, 'readback'],
    ]);
  });

  it("a finished deep read keeps the search the plug-in was given as its result's read", async () => {
    const { g, job } = await setup();
    await createQuerySource(db, g.id, 'marketa', { keywords: ['Game A', 'Gold'], categoryId: '7' });
    const given: unknown[] = [];
    const base = plugin(undefined, 2);
    const keyed = plugin(async (j, ctx) => {
      given.push(ctx.search);
      const step = await base.runJob!(j, ctx);
      return { ...step, search: { key: 'k1', day: '2026-11-24' } };
    });
    at('2026-11-24T12:00:00+09:00');
    await run(keyed);
    expect(given).toEqual([
      { keywords: ['Game A', 'Gold'], categoryId: '7' },
      { keywords: ['Game A', 'Gold'], categoryId: '7' },
    ]);
    expect(await jobRow(job.id)).toMatchObject({
      status: 'done',
      result: { search: 'k1', read: { keyword: 'Game A Gold', categoryId: '7' } },
    });
  });

  it("a search that cannot be built fails its job's step; the other marketplaces go on", async () => {
    const { g, job } = await setup();
    // A search left to the plug-in's default, which throws.
    await db.insert(productSources).values({
      productId: g.id,
      source: 'marketa',
      externalId: 'search',
      query: null,
      active: true,
    });
    const broken: Collector = {
      ...plugin(),
      defaultQuery: () => {
        throw new Error('no default search');
      },
    };
    const b = await game('Game B');
    const other = await queueMarketJob(db, { source: 'marketb', productId: b.id, kind: 'deep' });
    const second: Collector = { ...named(), source: 'marketb', label: 'Market B' };
    at('2026-11-24T12:00:00+09:00');
    const report = await run([broken, second]);
    expect(report.stops.marketa).toMatch(/no default search/);
    expect(fetched.map(item)).toEqual(['Game B']);
    expect(await jobRow(job.id)).toMatchObject({
      status: 'waiting',
      failures: 1,
      error: expect.stringMatching(/no default search/),
    });
    expect(await jobRow(other.id)).toMatchObject({ status: 'done' });
  });
});
