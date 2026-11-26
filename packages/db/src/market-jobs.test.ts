import { setAppTimeZone } from '@tora/core';
import { and, eq } from 'drizzle-orm';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Db, createDb } from './client';
import {
  claimJob,
  ensureMarketState,
  releaseJob,
  marketStates,
  nextJobs,
  queueMarketJob,
  readMarketState,
  recordMarketJobsFailed,
  recordRefusal,
  reserveRequest,
  restartMarket,
  saveJobStep,
} from './market-jobs';
import { migrateDb } from './migrate';
import { createProduct } from './mutations';
import { saveSourceInfos } from './registry';
import { blockedOn } from './sources';
import { activity, marketDays, marketJobs, marketState } from './schema';
import { TEST_SOURCES } from './testing';
import { changeTimeZone } from './time-zone';
import { createUser } from './users';

let db: Db;
let uid: string;
const creds = { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] };
const at = (iso: string) => new Date(iso);
const NOON = at('2026-11-24T12:00:00+09:00');

beforeEach(async () => {
  setAppTimeZone('Asia/Tokyo');
  const dir = await mkdtemp(join(tmpdir(), 'tora-market-'));
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  await saveSourceInfos(db, TEST_SOURCES);
  uid = (await createUser(db, 'alice', creds)).user.id;
  return () => rm(dir, { recursive: true, force: true });
});
afterEach(() => setAppTimeZone('Asia/Tokyo'));

const game = (name: string) =>
  createProduct(db, uid, { category: 'game', kind: 'software', name, platform: 'Alpha Station' });
const entries = () => db.select().from(activity).where(eq(activity.kind, 'admin'));

describe('the job queue', () => {
  it('queues jobs for game items only, once per marketplace, item and kind', async () => {
    const g = await game('Game A');
    const card = await createProduct(db, uid, {
      category: 'tcg',
      kind: 'single',
      name: 'Card C',
      franchise: 'pokemon',
    });
    const a = await queueMarketJob(db, { source: 'marketa', productId: g.id, kind: 'deep' });
    const again = await queueMarketJob(db, { source: 'marketa', productId: g.id, kind: 'deep' });
    expect(again.id).toBe(a.id);
    await expect(
      queueMarketJob(db, { source: 'marketa', productId: card.id, kind: 'deep' }),
    ).rejects.toThrow(/game items only/);
    await expect(
      queueMarketJob(db, { source: 'marketa', productId: g.id, kind: 'other' as 'deep' }),
    ).rejects.toThrow(/job kind/);
    // Without an item: one active row too (the index reads a missing item as '').
    const m1 = await queueMarketJob(db, { source: 'marketa', productId: null, kind: 'monthly' });
    const m2 = await queueMarketJob(db, { source: 'marketa', productId: null, kind: 'monthly' });
    expect(m2.id).toBe(m1.id);
    expect(await db.select().from(marketJobs)).toHaveLength(2);
    // A finished job does not block a new one.
    await db.update(marketJobs).set({ status: 'done' }).where(eq(marketJobs.id, a.id));
    const b = await queueMarketJob(db, { source: 'marketa', productId: g.id, kind: 'deep' });
    expect(b.id).not.toBe(a.id);
  });

  it('runs read-backs first, then by kind and age', async () => {
    const [a, b] = [await game('Game A'), await game('Game B')];
    await queueMarketJob(db, { source: 'marketa', productId: null, kind: 'monthly' });
    await queueMarketJob(db, { source: 'marketa', productId: a.id, kind: 'deep' });
    await queueMarketJob(db, { source: 'marketa', productId: b.id, kind: 'readback' });
    await queueMarketJob(db, { source: 'marketb', productId: b.id, kind: 'readback' });
    expect((await nextJobs(db, 'marketa')).map((j) => j.kind)).toEqual([
      'readback',
      'deep',
      'monthly',
    ]);
  });

  it('keeps the oldest day reached and writes no step of a job gone', async () => {
    const g = await game('Game A');
    const job = await queueMarketJob(db, { source: 'marketa', productId: g.id, kind: 'deep' });
    expect(
      await saveJobStep(db, job.id, { cursor: 1, oldestReached: null, done: false }, NOON),
    ).toBe(false);
    await claimJob(db, job.id, NOON);
    const step = (cursor: number, oldest: string | null, done = false) =>
      saveJobStep(db, job.id, { cursor, oldestReached: oldest, done }, NOON);
    await step(2, '2026-10-01');
    await step(3, '2026-11-01');
    await step(4, null);
    const [row] = await db.select().from(marketJobs).where(eq(marketJobs.id, job.id));
    expect([row!.cursor, row!.oldestReached, row!.status]).toEqual([4, '2026-10-01', 'running']);
    expect(await step(5, '2026-09-01', true)).toBe(true);
    const [done] = await db.select().from(marketJobs).where(eq(marketJobs.id, job.id));
    expect([done!.cursor, done!.oldestReached, done!.status]).toEqual([null, '2026-09-01', 'done']);
  });
});

describe('failing jobs (the error rule of the W10 review)', () => {
  it('a failed step adds one failure with its error; a saved step clears both', async () => {
    const g = await game('Game A');
    const job = await queueMarketJob(db, { source: 'marketa', productId: g.id, kind: 'deep' });
    const row = async () =>
      (await db.select().from(marketJobs).where(eq(marketJobs.id, job.id)))[0]!;
    await claimJob(db, job.id, NOON);
    await releaseJob(db, job.id, 'HTTP 401 for https://marketa.test/1');
    await claimJob(db, job.id, at('2026-11-24T13:00:00+09:00'));
    await releaseJob(db, job.id, 'x'.repeat(600));
    expect(await row()).toMatchObject({
      status: 'waiting',
      failures: 2,
      startedAt: '2026-11-24T13:00:00.000+09:00',
    });
    expect((await row()).error).toHaveLength(500);
    // The runner's own check (no error): nothing counted.
    await claimJob(db, job.id, NOON);
    await releaseJob(db, job.id);
    expect(await row()).toMatchObject({ status: 'waiting', failures: 2 });
    await claimJob(db, job.id, NOON);
    await saveJobStep(db, job.id, { cursor: 2, oldestReached: null, done: false }, NOON);
    expect(await row()).toMatchObject({ failures: 0, error: null, cursor: 2 });
  });

  it('runs failing jobs after the others, fewer failures first', async () => {
    const [a, b, c] = [await game('Game A'), await game('Game B'), await game('Game C')];
    const ja = await queueMarketJob(db, { source: 'marketa', productId: a.id, kind: 'readback' });
    const jb = await queueMarketJob(db, { source: 'marketa', productId: b.id, kind: 'deep' });
    const jc = await queueMarketJob(db, { source: 'marketa', productId: c.id, kind: 'deep' });
    const fail = async (id: string) => {
      await claimJob(db, id, NOON);
      await releaseJob(db, id, 'HTTP 503');
    };
    await fail(ja.id);
    await fail(ja.id);
    await fail(jb.id);
    expect((await nextJobs(db, 'marketa')).map((j) => j.id)).toEqual([jc.id, jb.id, ja.id]);
  });
});

describe('the day count (reserveRequest)', () => {
  const reserve = (jobId: string, now = NOON) =>
    reserveRequest(db, { source: 'marketa', jobId, day: '2026-11-24', now });

  it('counts nothing without a state row, or with a number under the floor', async () => {
    const job = await queueMarketJob(db, { source: 'marketa', productId: null, kind: 'monthly' });
    expect(await reserve(job.id)).toBeNull();
    for (const perDay of [0, 24]) {
      await db
        .insert(marketState)
        .values({ source: 'marketa', perDay })
        .onConflictDoUpdate({ target: marketState.source, set: { perDay } });
      expect(await reserve(job.id)).toBeNull();
    }
    expect(await db.select().from(marketDays)).toEqual([]);
    const [j] = await db.select().from(marketJobs);
    expect(j!.requests).toBe(0);
  });

  it('never passes the number, even with 20 at once', async () => {
    const job = await queueMarketJob(db, { source: 'marketa', productId: null, kind: 'monthly' });
    await ensureMarketState(db, 'marketa');
    await db
      .insert(marketDays)
      .values({ source: 'marketa', day: '2026-11-24', used: 195, limitThatDay: 200 });
    const got = await Promise.all(Array.from({ length: 20 }, () => reserve(job.id)));
    expect(got.filter((n) => n !== null).sort()).toEqual([196, 197, 198, 199, 200]);
    const [d] = await db.select().from(marketDays);
    expect(d!.used).toBe(200);
    const [j] = await db.select().from(marketJobs);
    expect(j!.requests).toBe(5);
  });

  it('counts nothing while waiting or stopped; the wait compares instants', async () => {
    const job = await queueMarketJob(db, { source: 'marketa', productId: null, kind: 'monthly' });
    const refused = at('2026-11-24T05:07:30+09:00');
    await recordRefusal(db, { source: 'marketa', at: refused });
    const waitEnd = new Date(refused.getTime() + 72 * 3_600_000);
    // The admin moves the app to Honolulu: stored times are rewritten, the wait is not.
    await changeTimeZone(db, 'Pacific/Honolulu', NOON);
    setAppTimeZone('Pacific/Honolulu');
    expect(await reserve(job.id, new Date(waitEnd.getTime() - 1000))).toBeNull();
    expect(await reserve(job.id, waitEnd)).toBe(1);
    await db.update(marketState).set({ stopped: true });
    expect(await reserve(job.id, waitEnd)).toBeNull();
  });
});

describe('refusals and restarts', () => {
  it("leaves the site to the collect's later runs that day, in the app time zone (K16)", async () => {
    // 08:30 on the 24th in Tokyo, 23:30 on the 23rd in UTC: the day is the app zone's.
    await recordRefusal(db, { source: 'marketa', at: at('2026-11-24T08:30:00+09:00') });
    expect([...(await blockedOn(db, '2026-11-24'))]).toEqual(['marketa']);
    expect((await blockedOn(db, '2026-11-23')).size).toBe(0);
    setAppTimeZone('UTC');
    expect([...(await blockedOn(db, '2026-11-23'))]).toEqual(['marketa']);
    expect((await blockedOn(db, '2026-11-24')).size).toBe(0);
  });

  it('halves after a wait, down to 25, then stops; one entry per refusal', async () => {
    const t0 = at('2026-11-24T05:07:30+09:00');
    const r1 = await recordRefusal(db, { source: 'marketa', at: t0 });
    expect(r1).toEqual({
      changed: true,
      perDay: 100,
      waitUntil: '2026-11-27T05:07:30.000+09:00',
      stopped: false,
    });
    // The same refusal again (a replay): nothing changes, no second entry.
    expect((await recordRefusal(db, { source: 'marketa', at: t0 })).changed).toBe(false);
    expect(await entries()).toHaveLength(1);
    // The state is lost (a restore), the refusal replayed: halved once, still one entry.
    await db.delete(marketState);
    const replay = await recordRefusal(db, { source: 'marketa', at: t0 });
    expect([replay.changed, replay.perDay]).toEqual([true, 100]);
    expect(await entries()).toHaveLength(1);
    const later = (days: number) => new Date(t0.getTime() + days * 86_400_000);
    expect((await recordRefusal(db, { source: 'marketa', at: later(4) })).perDay).toBe(50);
    expect((await recordRefusal(db, { source: 'marketa', at: later(8) })).perDay).toBe(25);
    const stop = await recordRefusal(db, { source: 'marketa', at: later(12) });
    expect([stop.stopped, stop.waitUntil]).toEqual([true, null]);
    expect((await entries()).map((e) => [e.action, e.level]).sort()).toEqual([
      ['marketRefused', 'problem'],
      ['marketRefused', 'problem'],
      ['marketRefused', 'problem'],
      ['marketStopped', 'failed'],
    ]);
    // Counted since the state was lost: the replay and three more.
    expect((await readMarketState(db, 'marketa'))!.refusals).toBe(4);
  });

  it('a restart sets 25 and clears the wait, only when waiting or stopped, day count kept', async () => {
    await ensureMarketState(db, 'marketa');
    expect(await restartMarket(db, 'marketa', uid, NOON)).toBe(false);
    await db
      .insert(marketDays)
      .values({ source: 'marketa', day: '2026-11-24', used: 60, limitThatDay: 200 });
    await recordRefusal(db, { source: 'marketa', at: at('2026-11-24T09:00:00+09:00') });
    expect(await restartMarket(db, 'marketa', uid, NOON)).toBe(true);
    const s = (await readMarketState(db, 'marketa'))!;
    expect([s.perDay, s.waitUntil, s.stopped, s.restartedBy]).toEqual([25, null, false, uid]);
    const [d] = await db.select().from(marketDays);
    expect(d!.used).toBe(60);
    // A replay of the refusal it was restarted from does not undo the restart.
    await recordRefusal(db, { source: 'marketa', at: at('2026-11-24T09:00:00+09:00') });
    expect((await readMarketState(db, 'marketa'))!.perDay).toBe(25);
  });

  it("a replayed stamp's state wins over a restored row when it is stricter", async () => {
    await ensureMarketState(db, 'marketa');
    const r = await recordRefusal(db, {
      source: 'marketa',
      at: NOON,
      stamp: { perDay: 50, stopped: false },
    });
    expect(r).toMatchObject({ changed: true, perDay: 50, stopped: false });
    expect(r.waitUntil).toBe('2026-11-27T12:00:00.000+09:00');
    await db.delete(marketState);
    await db.delete(activity);
    await ensureMarketState(db, 'marketa');
    const stop = await recordRefusal(db, {
      source: 'marketa',
      at: NOON,
      stamp: { perDay: 25, stopped: true },
    });
    expect(stop).toMatchObject({ perDay: 25, stopped: true, waitUntil: null });
    expect((await entries()).map((e) => e.action)).toEqual(['marketStopped']);
  });

  it('a refusal sends the running job back to waiting', async () => {
    const job = await queueMarketJob(db, { source: 'marketa', productId: null, kind: 'monthly' });
    await claimJob(db, job.id, NOON);
    await recordRefusal(db, { source: 'marketa', at: NOON, jobId: job.id });
    const [j] = await db.select().from(marketJobs).where(eq(marketJobs.id, job.id));
    expect(j!.status).toBe('waiting');
  });

  it('a runner failure is one entry a day', async () => {
    await recordMarketJobsFailed(db, 'cannot see locks', NOON);
    await recordMarketJobsFailed(db, 'cannot see locks', new Date(NOON.getTime() + 3_600_000));
    expect(await entries()).toHaveLength(1);
    await recordMarketJobsFailed(db, 'cannot see locks', new Date(NOON.getTime() + 86_400_000));
    expect(await entries()).toHaveLength(2);
  });
});

describe('the state per marketplace (collectors page)', () => {
  it('shows marketplaces with a state row or jobs, with use, jobs and the last error', async () => {
    const g = await game('Game A');
    await queueMarketJob(db, { source: 'marketb', productId: g.id, kind: 'deep' });
    const stopped = await queueMarketJob(db, { source: 'marketa', productId: g.id, kind: 'deep' });
    await db
      .update(marketJobs)
      .set({ status: 'stopped', error: 'HTTP 404', finishedAt: '2026-11-24T10:00:00.000+09:00' })
      .where(eq(marketJobs.id, stopped.id));
    await ensureMarketState(db, 'marketa');
    await db
      .insert(marketDays)
      .values({ source: 'marketa', day: '2026-11-24', used: 12, limitThatDay: 200 });
    await db
      .insert(marketDays)
      .values({ source: 'marketa', day: '2026-11-23', used: 99, limitThatDay: 200 });
    // Two failing jobs on marketb: the count, the most failures, the error of the last tried.
    const failing = await queueMarketJob(db, {
      source: 'marketb',
      productId: g.id,
      kind: 'monthly',
    });
    await db
      .update(marketJobs)
      .set({ failures: 1, error: 'HTTP 503', startedAt: '2026-11-24T09:00:00.000+09:00' })
      .where(eq(marketJobs.id, failing.id));
    await db
      .update(marketJobs)
      .set({ failures: 3, error: 'HTTP 401', startedAt: '2026-11-24T08:00:00.000+09:00' })
      .where(and(eq(marketJobs.source, 'marketb'), eq(marketJobs.kind, 'deep')));
    const views = await marketStates(db, NOON);
    expect(
      views.map((v) => [v.source, v.perDay, v.used, v.waiting, v.stoppedJobs, v.lastError]),
    ).toEqual([
      ['marketa', 200, 12, 0, 1, 'HTTP 404'],
      ['marketb', null, 0, 2, 0, null],
    ]);
    expect(views.map((v) => [v.failingJobs, v.mostFailures, v.lastFailure])).toEqual([
      [0, 0, null],
      [2, 3, 'HTTP 503'],
    ]);
    expect(views[1]!.oldestWaitingAt).not.toBeNull();
    await recordRefusal(db, { source: 'marketa', at: at('2026-11-24T09:00:00+09:00') });
    const [a] = await marketStates(db, NOON);
    expect([a!.perDay, a!.waitUntil]).toEqual([100, '2026-11-27T09:00:00.000+09:00']);
    // Past the wait, it is not shown as waiting.
    const [after] = await marketStates(db, at('2026-11-27T10:00:00+09:00'));
    expect(after!.waitUntil).toBeNull();
    expect(
      await db
        .select()
        .from(marketJobs)
        .where(and(eq(marketJobs.source, 'marketb'))),
    ).toHaveLength(2);
  });

  it('a restart after 30 used today shows 30 used of 25 (the page says: tomorrow)', async () => {
    await ensureMarketState(db, 'marketa');
    await db
      .insert(marketDays)
      .values({ source: 'marketa', day: '2026-11-24', used: 30, limitThatDay: 200 });
    await recordRefusal(db, { source: 'marketa', at: at('2026-11-24T09:00:00+09:00') });
    await restartMarket(db, 'marketa', uid, NOON);
    const [v] = await marketStates(db, NOON);
    expect(v).toMatchObject({ perDay: 25, used: 30, stopped: false, waitUntil: null });
  });
});
