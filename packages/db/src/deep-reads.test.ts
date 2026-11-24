// A game wish's marketplace history (S36 A3, B3; plan-deep-read.md sections 4, 9 and 10) on
// throwaway databases. Made-up marketplaces (marketa, marketb) and titles only.
import { setAppTimeZone } from '@tora/core';
import { eq } from 'drizzle-orm';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Db, createDb } from './client';
import {
  finishJob,
  firstNightDay,
  jobKindsBySource,
  nightlyShare,
  queueWeeklyReads,
  queueWishReads,
  saveJobKinds,
  startLoadJob,
  undoLoadJob,
} from './deep-reads';
import { migrateDb } from './migrate';
import { createProduct, mergeProducts } from './mutations';
import { saveSourceInfos } from './registry';
import { addNight, addSpan, removeSpan } from './sale-coverage';
import {
  marketJobs,
  priceObservations,
  productSources,
  saleCoverage,
  saleSpans,
  watches,
} from './schema';
import {
  createQuerySource,
  insertObservations,
  setObservationExcluded,
  updateSourceQuery,
} from './sources';
import { TEST_SOURCES } from './testing';
import { createUser } from './users';
import { addWatch } from './watches';

let db: Db;
let uid: string;
const creds = { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] };
const NOW = new Date('2026-12-01T09:00:00+09:00');

beforeEach(async () => {
  setAppTimeZone('Asia/Tokyo');
  const dir = await mkdtemp(join(tmpdir(), 'tora-deep-'));
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  await saveSourceInfos(db, TEST_SOURCES);
  uid = (await createUser(db, 'alice', creds)).user.id;
  await saveJobKinds(db, { marketa: ['deep', 'readback'], marketb: [] });
  return () => rm(dir, { recursive: true, force: true });
});
afterEach(() => setAppTimeZone('Asia/Tokyo'));

const game = (name: string) =>
  createProduct(db, uid, { category: 'game', kind: 'software', name, platform: 'Alpha Station' });
const wished = async (name: string, item?: { id: string }) => {
  const p = item ?? (await game(name));
  await createQuerySource(db, p.id, 'marketa', { keywords: [name] });
  await addWatch(db, uid, { productId: p.id }, {});
  return p;
};
const jobsOf = (productId: string) =>
  db.select().from(marketJobs).where(eq(marketJobs.productId, productId));
const set = (id: string, values: Partial<typeof marketJobs.$inferInsert>) =>
  db.update(marketJobs).set(values).where(eq(marketJobs.id, id));
const sold = (
  productId: string,
  ref: string,
  day: string,
  more: Partial<typeof priceObservations.$inferInsert> = {},
) => ({
  productId,
  source: 'marketa',
  observationType: 'sold' as const,
  bucket: 'used',
  price: 1000,
  currency: 'JPY',
  priceBase: 1000,
  observedAt: `${day}T12:00:00.000+09:00`,
  fetchedAt: `${day}T23:00:00.000+09:00`,
  externalRef: ref,
  raw: { name: 'Game A' },
  ...more,
});
const rowOf = async (ref: string) =>
  (await db.select().from(priceObservations).where(eq(priceObservations.externalRef, ref)))[0]!;

describe('which marketplaces read deep', () => {
  it('saves a change only, without the marketplaces that have none', async () => {
    expect(await jobKindsBySource(db)).toEqual({ marketa: ['deep', 'readback'] });
    expect(await saveJobKinds(db, { marketb: [], marketa: ['readback', 'deep'] })).toBe(false);
    expect(await saveJobKinds(db, { marketa: ['deep'] })).toBe(true);
  });
});

describe('the queue', () => {
  it('queues one deep read per wished game with a search, run twice or beside the wish', async () => {
    const g = await wished('Game A');
    expect(await queueWeeklyReads(db, NOW)).toEqual({ queued: 1, stopped: 0 });
    expect(await queueWeeklyReads(db, NOW)).toEqual({ queued: 0, stopped: 0 });
    expect(await queueWishReads(db, g.id, NOW)).toBe(0);
    // No read-back while the deep read waits: it reads those weeks too.
    expect((await jobsOf(g.id)).map((j) => [j.kind, j.status, j.wantedFrom])).toEqual([
      ['deep', 'waiting', '2025-12-01'],
    ]);
    // Not wished, or no active search: none.
    const plain = await game('Game B');
    await createQuerySource(db, plain.id, 'marketa', { keywords: ['Game B'] });
    const noSearch = await game('Game C');
    await addWatch(db, uid, { productId: noSearch.id }, {});
    expect(await queueWeeklyReads(db, NOW)).toEqual({ queued: 0, stopped: 0 });
    expect(await queueWishReads(db, noSearch.id, NOW)).toBe(0);
  });

  it('never queues a read for a card or a sealed item', async () => {
    const card = await createProduct(db, uid, {
      category: 'tcg',
      kind: 'single',
      name: 'Card C',
      franchise: 'pokemon',
    });
    const box = await createProduct(db, uid, {
      category: 'tcg',
      kind: 'booster_box',
      name: 'Box D',
      franchise: 'pokemon',
    });
    for (const p of [card, box]) await wished(p.name, p);
    expect(await queueWeeklyReads(db, NOW)).toEqual({ queued: 0, stopped: 0 });
    expect(await queueWishReads(db, card.id, NOW)).toBe(0);
    expect(await db.select().from(marketJobs)).toEqual([]);
  });

  it('queues a read-back 7 days after the last, and a deep read 7 days after a stop', async () => {
    const g = await wished('Game A');
    await queueWeeklyReads(db, NOW);
    const [deep] = await jobsOf(g.id);
    await set(deep!.id, { status: 'stopped', finishedAt: '2026-11-25T10:00:00.000+09:00' });
    expect(await queueWeeklyReads(db, NOW)).toEqual({ queued: 1, stopped: 0 });
    expect((await jobsOf(g.id)).map((j) => j.kind).sort()).toEqual(['deep', 'readback']);
    await db.delete(marketJobs);
    await queueWeeklyReads(db, NOW);
    const [next] = await jobsOf(g.id);
    await set(next!.id, { status: 'done', finishedAt: '2026-11-30T10:00:00.000+09:00' });
    expect(await queueWeeklyReads(db, NOW)).toEqual({ queued: 1, stopped: 0 });
    const back = (await jobsOf(g.id)).find((j) => j.kind === 'readback')!;
    expect(back.wantedFrom).toBe('2026-10-20');
    // Finished 6 days ago: none; 7 days ago: one.
    await set(back.id, { status: 'done', finishedAt: '2026-11-25T23:00:00.000+09:00' });
    expect(await queueWeeklyReads(db, NOW)).toEqual({ queued: 0, stopped: 0 });
    await set(back.id, { finishedAt: '2026-11-24T08:00:00.000+09:00' });
    expect(await queueWeeklyReads(db, NOW)).toEqual({ queued: 1, stopped: 0 });
  });

  it('stops the reads of an item no longer wished or whose search is off; rows stay', async () => {
    const a = await wished('Game A');
    const b = await wished('Game B');
    await queueWeeklyReads(db, NOW);
    await insertObservations(db, [sold(a.id, 'a1', '2026-11-20')]);
    await db.delete(watches).where(eq(watches.productId, a.id));
    await db
      .update(productSources)
      .set({ active: false })
      .where(eq(productSources.productId, b.id));
    expect(await queueWeeklyReads(db, NOW)).toEqual({ queued: 0, stopped: 2 });
    expect(
      [...(await jobsOf(a.id)), ...(await jobsOf(b.id))].map((j) => [j.status, j.error]),
    ).toEqual([
      ['stopped', 'wish removed'],
      ['stopped', 'search off'],
    ]);
    expect(await rowOf('a1')).toBeDefined();
  });

  it('blocks a deep read for 12 months only while its span exists; any other ending 30 days', async () => {
    const g = await wished('Game A');
    await queueWeeklyReads(db, NOW);
    const [deep] = await jobsOf(g.id);
    const deeps = async () => (await jobsOf(g.id)).filter((j) => j.kind === 'deep');
    const dropNew = async () => {
      for (const j of await deeps())
        if (j.id !== deep!.id) await db.delete(marketJobs).where(eq(marketJobs.id, j.id));
    };
    // Done without a span (nothing read): finished 3 days ago, none; 30 days ago, queued again.
    await set(deep!.id, {
      status: 'done',
      finishedAt: '2026-11-28T10:00:00.000+09:00',
      result: { why: 'nothing_read' },
    });
    await queueWeeklyReads(db, NOW);
    expect(await deeps()).toHaveLength(1);
    await set(deep!.id, { finishedAt: '2026-11-01T10:00:00.000+09:00' });
    await queueWeeklyReads(db, NOW);
    expect(await deeps()).toHaveLength(2);
    await dropNew();
    // With its span, finished 30 days ago: none; the span removed: queued again.
    await addSpan(db, {
      productId: g.id,
      source: 'marketa',
      from: '2025-12-01',
      to: '2026-10-31',
      how: 'deep',
      jobId: deep!.id,
    });
    await queueWeeklyReads(db, NOW);
    expect(await deeps()).toHaveLength(1);
    await removeSpan(db, deep!.id);
    await queueWeeklyReads(db, NOW);
    expect(await deeps()).toHaveLength(2);
  });

  it('queues a deep read ending elsewhere again after 30 days; at once when its search changed', async () => {
    const g = await wished('Game A');
    await queueWeeklyReads(db, NOW);
    const [deep] = await jobsOf(g.id);
    const deeps = async () => (await jobsOf(g.id)).filter((j) => j.kind === 'deep');
    // Ended 'elsewhere' 10 days ago: none; 31 days ago: queued again.
    await set(deep!.id, {
      status: 'done',
      finishedAt: '2026-11-21T10:00:00.000+09:00',
      result: { why: 'elsewhere', elsewhere: ['x1'] },
    });
    await queueWeeklyReads(db, NOW);
    expect(await deeps()).toHaveLength(1);
    await set(deep!.id, { finishedAt: '2026-10-31T10:00:00.000+09:00' });
    await queueWeeklyReads(db, NOW);
    expect(await deeps()).toHaveLength(2);
    // Its span gone because the search changed, finished yesterday: queued at once, and once.
    for (const why of ['search_edited', 'narrower_search'] as const) {
      for (const j of await deeps())
        if (j.id !== deep!.id) await db.delete(marketJobs).where(eq(marketJobs.id, j.id));
      await set(deep!.id, {
        finishedAt: '2026-11-30T10:00:00.000+09:00',
        result: { added: 3, why },
      });
      await queueWeeklyReads(db, NOW);
      await queueWeeklyReads(db, NOW);
      expect((await deeps()).map((j) => j.status).sort()).toEqual(['done', 'waiting']);
    }
  });

  it('queues the read-back beside a deep read failing day after day', async () => {
    const g = await wished('Game A');
    await queueWeeklyReads(db, NOW);
    const [deep] = await jobsOf(g.id);
    await set(deep!.id, { failures: 4 });
    expect(await queueWeeklyReads(db, NOW)).toEqual({ queued: 0, stopped: 0 });
    await set(deep!.id, { failures: 5 });
    expect(await queueWeeklyReads(db, NOW)).toEqual({ queued: 1, stopped: 0 });
    expect((await jobsOf(g.id)).map((j) => [j.kind, j.status]).sort()).toEqual([
      ['deep', 'waiting'],
      ['readback', 'waiting'],
    ]);
  });

  it('a search saved again forgets what rested on its rows: spans, nights, places', async () => {
    const a = await wished('Game A');
    const b = await wished('Game B');
    const linkOf = async (productId: string, source: string) =>
      (await db.select().from(productSources).where(eq(productSources.productId, productId))).find(
        (l) => l.source === source,
      )!;
    // A: a deep read done 3 days ago with its span, and nights.
    const [done] = await db
      .insert(marketJobs)
      .values({
        source: 'marketa',
        productId: a.id,
        kind: 'deep',
        status: 'done',
        wantedFrom: '2025-11-01',
        finishedAt: '2026-11-28T10:00:00.000+09:00',
        result: { added: 3, span: { from: '2025-11-01', to: '2026-10-31' } },
      })
      .returning();
    await addSpan(db, {
      productId: a.id,
      source: 'marketa',
      from: '2025-11-01',
      to: '2026-10-31',
      how: 'deep',
      jobId: done!.id,
    });
    await addNight(db, a.id, 'marketa', '2026-11-20');
    await insertObservations(db, [
      sold(a.id, 'a1', '2026-11-20', { raw: { name: 'Game A', job: done!.id } }),
      sold(a.id, 'a2', '2026-11-21', { excluded: true, excludedReason: 'manual' }),
    ]);
    // B: a deep read and a read-back mid-way, and a load running.
    const running = (kind: string) =>
      db
        .insert(marketJobs)
        .values({
          source: 'marketa',
          productId: b.id,
          kind,
          status: 'running',
          cursor: { page: 25 },
          oldestReached: '2026-03-01',
          failures: 2,
          error: 'earlier',
          result: { added: 2900, search: 'k1', firstDay: '2026-11-29' },
        })
        .returning();
    const [deepB] = await running('deep');
    const [backB] = await running('readback');
    const [loadB] = await running('load');
    // A job of another marketplace is not touched.
    await createQuerySource(db, b.id, 'marketb', { keywords: ['Game B'] });
    const [other] = await db
      .insert(marketJobs)
      .values({
        source: 'marketb',
        productId: b.id,
        kind: 'deep',
        status: 'running',
        cursor: { page: 3 },
      })
      .returning();
    for (const p of [a, b]) {
      const link = await linkOf(p.id, 'marketa');
      await updateSourceQuery(db, link.id, link.query!);
    }
    expect(await db.select().from(saleSpans)).toEqual([]);
    expect(await db.select().from(saleCoverage)).toEqual([]);
    expect((await db.select().from(priceObservations)).map((r) => r.externalRef)).toEqual(['a2']);
    for (const j of [deepB!, backB!])
      expect((await jobsOf(b.id)).find((x) => x.id === j.id)).toMatchObject({
        status: 'waiting',
        cursor: null,
        result: null,
        oldestReached: null,
        failures: 0,
        error: null,
      });
    expect((await jobsOf(b.id)).find((x) => x.id === loadB!.id)).toMatchObject({
      status: 'stopped',
      error: 'search edited',
    });
    expect((await jobsOf(b.id)).find((x) => x.id === other!.id)).toMatchObject({
      status: 'running',
      cursor: { page: 3 },
    });
    const doneA = (await jobsOf(a.id))[0]!;
    expect(doneA).toMatchObject({ status: 'done', result: { added: 3, why: 'search_edited' } });
    expect(doneA.result).not.toHaveProperty('span');
    // A's deep read is queued again at once (its search was saved); B's wait from page 0.
    expect(await queueWeeklyReads(db, NOW)).toEqual({ queued: 1, stopped: 0 });
    expect((await jobsOf(a.id)).map((j) => [j.kind, j.status]).sort()).toEqual([
      ['deep', 'done'],
      ['deep', 'waiting'],
    ]);
  });
});

describe('finishJob', () => {
  const running = async (productId: string, kind = 'deep', wantedFrom = '2025-12-01') => {
    const [job] = await db
      .insert(marketJobs)
      .values({ source: 'marketa', productId, kind, status: 'running', wantedFrom })
      .returning();
    return job!;
  };
  const spans = () => db.select().from(saleSpans);

  it('writes the span once, with the job', async () => {
    const g = await game('Game A');
    const job = await running(g.id);
    const step = { oldestReached: '2025-10-31', result: { firstDay: '2026-12-01', added: 5 } };
    expect(await finishJob(db, job.id, step, NOW)).toMatchObject({
      span: { from: '2025-12-01', to: '2026-11-30' },
    });
    expect(await finishJob(db, job.id, step, NOW)).toBeNull();
    expect((await spans()).map((s) => [s.fromDay, s.toDay, s.how, s.jobId])).toEqual([
      ['2025-12-01', '2026-11-30', 'deep', job.id],
    ]);
    expect((await jobsOf(g.id))[0]).toMatchObject({ status: 'done', oldestReached: '2025-10-31' });
  });

  it("writes a tracked game's weekly read as a read-back span; a monthly page writes none", async () => {
    const g = await game('Game A');
    const job = await running(g.id, 'tracked_weekly', '2026-11-17');
    const step = { oldestReached: '2026-11-03', result: { firstDay: '2026-12-01', added: 4 } };
    expect(await finishJob(db, job.id, step, NOW)).toMatchObject({
      span: { from: '2026-11-17', to: '2026-11-30' },
    });
    const month = await running(g.id, 'monthly', '');
    expect(await finishJob(db, month.id, step, NOW)).not.toHaveProperty('span');
    expect((await spans()).map((s) => [s.fromDay, s.toDay, s.how, s.jobId])).toEqual([
      ['2026-11-17', '2026-11-30', 'readback', job.id],
    ]);
  });

  it('writes none while a sale it would keep is still elsewhere, checked again at the end', async () => {
    const g = await game('Game A');
    const look = await game('Game A Look-alike');
    // 'moved': stored under this item since (a merge or a search edit brought it here).
    await insertObservations(db, [
      sold(look.id, 'x1', '2026-11-20'),
      sold(g.id, 'moved', '2026-11-21'),
    ]);
    const first = { firstDay: '2026-12-01' };
    const r1 = await finishJob(
      db,
      (await running(g.id)).id,
      { oldestReached: '2025-10-31', result: { ...first, elsewhere: ['x1', 'moved'] } },
      NOW,
    );
    expect(r1).toMatchObject({ why: 'elsewhere', elsewhere: ['x1'] });
    // Every ref moved back since: the span is written.
    const r2 = await finishJob(
      db,
      (await running(g.id, 'readback', '2026-10-20')).id,
      { oldestReached: '2026-10-02', result: { ...first, elsewhere: ['moved'] } },
      NOW,
    );
    expect(r2).toMatchObject({ span: { from: '2026-10-20', to: '2026-11-30' } });
    expect(r2).not.toHaveProperty('elsewhere');
    // Over 200 listed: still blocking. A load's own reason stands.
    const r3 = await finishJob(
      db,
      (await running(g.id, 'readback', '2026-10-20')).id,
      { oldestReached: '2026-10-02', result: { ...first, elsewhereMore: 3 } },
      NOW,
    );
    expect(r3).toMatchObject({ why: 'elsewhere' });
    const r4 = await finishJob(
      db,
      (await running(g.id, 'load', '')).id,
      { oldestReached: '2026-08-25', result: { ...first, why: 'narrower_search' } },
      NOW,
    );
    expect(r4).toMatchObject({ why: 'narrower_search' });
    expect((await spans()).length).toBe(1);
  });

  it('writes none while a listed sale is stored nowhere or undone here', async () => {
    const g = await game('Game A');
    const look = await game('Game A Look-alike');
    await insertObservations(db, [
      sold(look.id, 'r1', '2026-11-20'),
      sold(g.id, 'u1', '2026-11-21', { excluded: true, ruleMark: 'undone:job-0' }),
    ]);
    // The look-alike's rows deleted before the last step: r1 is kept nowhere.
    await db.delete(priceObservations).where(eq(priceObservations.productId, look.id));
    const first = { firstDay: '2026-12-01' };
    const r1 = await finishJob(
      db,
      (await running(g.id)).id,
      { oldestReached: '2025-10-31', result: { ...first, elsewhere: ['r1'] } },
      NOW,
    );
    expect(r1).toMatchObject({ why: 'elsewhere', elsewhere: ['r1'] });
    const r2 = await finishJob(
      db,
      (await running(g.id, 'readback', '2026-10-20')).id,
      { oldestReached: '2026-10-02', result: { ...first, undoneHere: ['u1'] } },
      NOW,
    );
    expect(r2).toMatchObject({ why: 'elsewhere', undoneHere: ['u1'] });
    expect(await spans()).toEqual([]);
  });
});

describe('a load and its undo', () => {
  it('a search saved again stops a done load, so its files can be loaded again', async () => {
    const g = await game('Game A');
    await createQuerySource(db, g.id, 'marketa', { keywords: ['Game A'] });
    const input = { source: 'marketa', productId: g.id, wantedFrom: null, fingerprint: 'f1' };
    const first = await startLoadJob(db, input, NOW);
    if (!('job' in first)) throw new Error('no job');
    await set(first.job.id, { status: 'done' });
    expect(await startLoadJob(db, input, NOW)).toHaveProperty('skip');
    // The save deletes the item's stored sales at that marketplace, the load's rows included.
    const [link] = await db.select().from(productSources).where(eq(productSources.productId, g.id));
    await updateSourceQuery(db, link!.id, link!.query!);
    expect((await jobsOf(g.id)).find((j) => j.id === first.job.id)).toMatchObject({
      status: 'stopped',
      error: 'search edited',
    });
    const again = await startLoadJob(db, input, NOW);
    expect('job' in again && again.job.id !== first.job.id).toBe(true);
  });

  it('starts a load once per set of files', async () => {
    const g = await game('Game A');
    const input = { source: 'marketa', productId: g.id, wantedFrom: null, fingerprint: 'f1' };
    const first = await startLoadJob(db, input, NOW);
    if (!('job' in first)) throw new Error('no job');
    expect(await startLoadJob(db, input, NOW)).toMatchObject({ reused: true });
    expect(await startLoadJob(db, { ...input, fingerprint: 'f2' }, NOW)).toHaveProperty('refuse');
    await set(first.job.id, { status: 'done' });
    expect(await startLoadJob(db, input, NOW)).toHaveProperty('skip');
    const card = await createProduct(db, uid, {
      category: 'tcg',
      kind: 'single',
      name: 'Card C',
      franchise: 'pokemon',
    });
    expect(await startLoadJob(db, { ...input, productId: card.id }, NOW)).toEqual({
      refuse: 'not a game item',
    });
  });

  it("takes back its rows before the first nightly read, never a person's exclusion", async () => {
    const g = await game('Game A');
    const start = await startLoadJob(
      db,
      { source: 'marketa', productId: g.id, wantedFrom: null, fingerprint: 'f1' },
      NOW,
    );
    if (!('job' in start)) throw new Error('no job');
    const id = start.job.id;
    const job = { name: 'Game A', job: id };
    await insertObservations(db, [
      sold(g.id, 'early', '2026-11-01', { raw: job, fetchedAt: '2026-11-22T10:00:00.000+09:00' }),
      sold(g.id, 'late', '2026-11-20', { raw: job }),
      sold(g.id, 'person', '2026-11-02', { raw: job, excluded: true, excludedReason: 'manual' }),
      sold(g.id, 'verdict', '2026-11-03', {
        raw: job,
        excluded: true,
        excludedReason: 'mismatch',
      }),
      sold(g.id, 'rules', '2026-11-04', {
        raw: job,
        excluded: true,
        excludedReason: 'mismatch',
        ruleMark: 'rules:abc',
      }),
      sold(g.id, 'night', '2026-11-16'),
      sold(g.id, 'pasted', '2026-10-01', { raw: { name: 'Game A', reference: true } }),
    ]);
    // The first nightly day: the earlier of its first night and its own rows' first fetch day.
    expect(await firstNightDay(db, g.id, 'marketa')).toBe('2026-11-16');
    await addNight(db, g.id, 'marketa', '2026-11-15');
    expect(await firstNightDay(db, g.id, 'marketa')).toBe('2026-11-15');
    expect(await nightlyShare(db, g.id, 'marketa', '2026-10-01', '2026-11-30')).toEqual({
      rows: 1,
      kept: 1,
    });
    await finishJob(
      db,
      id,
      { oldestReached: '2026-08-25', result: { firstDay: '2026-11-20', fingerprint: 'f1' } },
      NOW,
    );
    expect(await db.select().from(saleSpans)).toHaveLength(1);
    const before = await db.select().from(priceObservations);

    expect(await undoLoadJob(db, id, NOW)).toEqual({ rows: 2, already: false });
    for (const ref of ['early', 'rules'])
      expect(await rowOf(ref)).toMatchObject({
        excluded: true,
        excludedReason: 'mismatch',
        ruleMark: `undone:${id}`,
      });
    for (const ref of ['late', 'person', 'verdict', 'night', 'pasted'])
      expect(await rowOf(ref)).toEqual(before.find((r) => r.externalRef === ref));
    expect((await rowOf('early')).raw).toEqual(job);
    expect(await db.select().from(saleSpans)).toEqual([]);
    expect((await jobsOf(g.id))[0]).toMatchObject({ status: 'undone' });
    expect((await jobsOf(g.id))[0]!.result).not.toHaveProperty('span');

    expect(await undoLoadJob(db, id, NOW)).toEqual({ rows: 0, already: true });
    expect(
      await startLoadJob(
        db,
        { source: 'marketa', productId: g.id, wantedFrom: null, fingerprint: 'f1' },
        NOW,
      ),
    ).toHaveProperty('refuse');
    const [deep] = await db
      .insert(marketJobs)
      .values({ source: 'marketa', productId: g.id, kind: 'deep', status: 'done' })
      .returning();
    expect(await undoLoadJob(db, deep!.id, NOW)).toEqual({
      refuse: 'only a load job can be undone',
    });
  });

  it("takes every span of the item there with its rows: a later deep read's too", async () => {
    const g = await wished('Game A');
    const start = await startLoadJob(
      db,
      { source: 'marketa', productId: g.id, wantedFrom: null, fingerprint: 'f1' },
      NOW,
    );
    if (!('job' in start)) throw new Error('no job');
    const load = start.job.id;
    const raw = { name: 'Game A', job: load };
    await insertObservations(db, [
      sold(g.id, 'l1', '2026-09-01', { raw }),
      sold(g.id, 'l2', '2026-10-01', { raw }),
    ]);
    await finishJob(
      db,
      load,
      { oldestReached: '2026-08-25', result: { firstDay: '2026-11-20', fingerprint: 'f1' } },
      NOW,
    );
    // A deep read over the same refs inserts nothing and writes its span.
    const [deep] = await db
      .insert(marketJobs)
      .values({
        source: 'marketa',
        productId: g.id,
        kind: 'deep',
        status: 'running',
        wantedFrom: '2025-12-01',
      })
      .returning();
    expect(
      await finishJob(
        db,
        deep!.id,
        { oldestReached: '2025-10-31', result: { firstDay: '2026-12-01', added: 0 } },
        NOW,
      ),
    ).toHaveProperty('span');
    await addNight(db, g.id, 'marketa', '2026-11-30');
    expect((await db.select().from(saleSpans)).map((s) => s.how).sort()).toEqual(['deep', 'load']);
    // Both rows are older than the 14 days before the load: they go, and both spans; nights stay.
    expect(await undoLoadJob(db, load, NOW)).toEqual({ rows: 2, already: false });
    expect(await db.select().from(saleSpans)).toEqual([]);
    expect(await db.select().from(saleCoverage)).toHaveLength(1);
    const deeps = async () => (await jobsOf(g.id)).filter((j) => j.kind === 'deep');
    expect((await deeps())[0]).toMatchObject({ result: { added: 0, why: 'load_undone' } });
    expect((await deeps())[0]!.result).not.toHaveProperty('span');
    // The deep read is queued again once its 30 days are over (a read-back meanwhile).
    await queueWeeklyReads(db, new Date('2026-12-09T09:00:00+09:00'));
    expect((await deeps()).map((j) => j.status)).toEqual(['done']);
    await queueWeeklyReads(db, new Date('2026-12-31T09:00:00+09:00'));
    expect((await deeps()).map((j) => j.status).sort()).toEqual(['done', 'waiting']);
  });

  it("a person's include settles an undone row: a later deep read no longer counts it", async () => {
    const g = await game('Game A');
    const start = await startLoadJob(
      db,
      { source: 'marketa', productId: g.id, wantedFrom: null, fingerprint: 'f1' },
      NOW,
    );
    if (!('job' in start)) throw new Error('no job');
    const raw = { name: 'Game A', job: start.job.id };
    await insertObservations(db, [
      sold(g.id, 'u1', '2026-09-01', { raw }),
      sold(g.id, 'r1', '2026-09-02', {
        excluded: true,
        excludedReason: 'manual',
        ruleMark: 'rules:abc',
      }),
    ]);
    expect(await undoLoadJob(db, start.job.id, NOW)).toEqual({ rows: 1, already: false });
    const deepRead = async () => {
      const [job] = await db
        .insert(marketJobs)
        .values({ source: 'marketa', productId: g.id, kind: 'deep', status: 'running' })
        .returning();
      return finishJob(
        db,
        job!.id,
        { oldestReached: '2025-10-31', result: { firstDay: '2026-12-01', undoneHere: ['u1'] } },
        NOW,
      );
    };
    expect(await deepRead()).toMatchObject({ why: 'elsewhere', undoneHere: ['u1'] });
    for (const ref of ['u1', 'r1'])
      expect(await setObservationExcluded(db, (await rowOf(ref)).id, false)).toEqual({
        productId: g.id,
      });
    expect(await rowOf('u1')).toMatchObject({
      excluded: false,
      excludedReason: null,
      ruleMark: null,
    });
    // Only a load's undo mark goes.
    expect(await rowOf('r1')).toMatchObject({ excluded: false, ruleMark: 'rules:abc' });
    expect(await deepRead()).toHaveProperty('span');
  });

  it('keeps the rows of the 14 days before the load once the nightly read started earlier', async () => {
    const g = await game('Game A');
    await addNight(db, g.id, 'marketa', '2026-06-01');
    const start = await startLoadJob(
      db,
      { source: 'marketa', productId: g.id, wantedFrom: null, fingerprint: 'f1' },
      new Date('2026-11-20T10:00:00+09:00'),
    );
    if (!('job' in start)) throw new Error('no job');
    const id = start.job.id;
    const raw = { name: 'Game A', job: id };
    await insertObservations(db, [
      sold(g.id, 'july', '2026-07-01', { raw }),
      sold(g.id, 'day5', '2026-11-05', { raw }),
      sold(g.id, 'day6', '2026-11-06', { raw }),
      sold(g.id, 'day19', '2026-11-19', { raw }),
    ]);
    expect(await undoLoadJob(db, id, NOW)).toEqual({ rows: 2, already: false });
    for (const ref of ['july', 'day5'])
      expect(await rowOf(ref)).toMatchObject({ excluded: true, ruleMark: `undone:${id}` });
    for (const ref of ['day6', 'day19'])
      expect(await rowOf(ref)).toMatchObject({ excluded: false, ruleMark: null });
    const after = await db.select().from(priceObservations);
    expect(await undoLoadJob(db, id, NOW)).toEqual({ rows: 0, already: true });
    expect(await db.select().from(priceObservations)).toEqual(after);
  });

  it('goes with its rows when the item is merged; the target keeps its own deep read', async () => {
    const keep = await wished('Game A');
    const dup = await wished('Game A copy');
    await queueWeeklyReads(db, NOW);
    const [load] = await db
      .insert(marketJobs)
      .values({ source: 'marketa', productId: dup.id, kind: 'load', status: 'done' })
      .returning();
    const keepDeep = (await jobsOf(keep.id))[0]!;
    await mergeProducts(db, { id: uid, role: 'admin' }, dup.id, keep.id);
    const jobs = await jobsOf(keep.id);
    expect(jobs.map((j) => j.id).sort()).toEqual([keepDeep.id, load!.id].sort());
    expect(await jobsOf(dup.id)).toEqual([]);
  });
});
