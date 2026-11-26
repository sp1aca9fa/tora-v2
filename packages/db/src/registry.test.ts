import { identitySources, valuationOrder } from '@tora/core';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { beforeEach, expect, it } from 'vitest';
import { type Db, createDb } from './client';
import { migrateDb } from './migrate';
import { createHolding } from './mutations';
import {
  checkSourceQuality,
  dismissSourceQuality,
  loadSourceRegistry,
  pruneSourceDetails,
  saveSourceInfos,
  setCollectWindow,
  setMarketSettings,
  setSourceOrder,
  setSourceRoles,
} from './registry';
import {
  blockedOn,
  markRunRefused,
  collectorTimes,
  finishRun,
  identityFor,
  insertObservations,
  startRun,
} from './sources';
import * as schema from './schema';
import { TEST_SOURCES } from './testing';
import { createUser } from './users';

let db: Db;
let userId: string;

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-registry-'));
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  await saveSourceInfos(db, TEST_SOURCES);
  userId = (
    await createUser(db, 'a', { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] })
  ).user.id;
  return () => rm(dir, { recursive: true, force: true });
});

let ref = 0;
/** `items` cards, each with 3 reference sales and 3 supporting sales `factor` times the price. */
async function cardsSoldOnBoth(items: number, factor: number) {
  for (let i = 0; i < items; i++) {
    const { product } = await createHolding(
      db,
      userId,
      { product: { category: 'tcg', kind: 'single', name: `Card ${i}`, cardNumber: String(i) } },
      {
        quantity: 1,
        costTotalBase: 1000,
        acquiredAt: new Date().toISOString(),
        grading: 'raw',
        rawGrade: 'A',
      },
    );
    const sale = (source: string, priceBase: number, day: number) => ({
      productId: product.id,
      source,
      observationType: 'sold' as const,
      bucket: 'raw:A',
      priceBase,
      observedAt: new Date(Date.now() - day * 86_400_000).toISOString(),
      fetchedAt: new Date().toISOString(),
      externalRef: `r${ref++}`,
    });
    await insertObservations(db, [
      ...[1, 2, 3].map((d) => sale('snkrdunk', 10_000, d)),
      ...[1, 2, 3].map((d) => sale('mercari', Math.round(10_000 * factor), d)),
    ]);
  }
}

it('lowers a supporting source that strays from the reference to comparison', async () => {
  await cardsSoldOnBoth(10, 0.7);
  expect(await checkSourceQuality(db)).toEqual(['mercari:card']);
  const registry = await loadSourceRegistry(db);
  expect(registry.quality?.mercari?.card).toMatchObject({
    status: 'disagrees',
    pairs: 10,
    bias: -0.3,
    against: 'snkrdunk',
  });
  expect(registry.roles.mercari?.card).toBe('comparison');
  expect(registry.declared?.mercari?.card).toBe('supporting');
  expect(valuationOrder(registry, 'card')).toEqual(['snkrdunk']);
  // Sealed was not compared (no items): unverified, its role kept.
  expect(registry.quality?.mercari?.sealed?.status).toBe('unverified');
  expect(valuationOrder(registry, 'sealed')).toEqual(['snkrdunk', 'mercari', 'surugaya']);
});

it('keeps a source that agrees, or that too few items can judge', async () => {
  await cardsSoldOnBoth(10, 0.95);
  await checkSourceQuality(db);
  expect((await loadSourceRegistry(db)).quality?.mercari?.card?.status).toBe('agrees');
});

it('leaves a source unverified with fewer than 10 items in common', async () => {
  await cardsSoldOnBoth(9, 0.5);
  await checkSourceQuality(db);
  const registry = await loadSourceRegistry(db);
  expect(registry.quality?.mercari?.card).toMatchObject({ status: 'unverified', pairs: 9 });
  expect(registry.roles.mercari?.card).toBe('supporting');
});

it('keeps a dismissed notice dismissed while the source keeps disagreeing', async () => {
  await cardsSoldOnBoth(10, 0.7);
  await checkSourceQuality(db);
  await dismissSourceQuality(db, 'mercari', 'card');
  await checkSourceQuality(db);
  const registry = await loadSourceRegistry(db);
  expect(registry.quality?.mercari?.card?.dismissedAt).toBeTruthy();
  // Still comparison only: dismissing hides the notice, it does not change the role.
  expect(registry.roles.mercari?.card).toBe('comparison');
});

it('drops listing details of sources that keep them only for a while', async () => {
  await saveSourceInfos(db, [{ key: 'asks', label: 'Asks', detailsDays: 14 }]);
  const { product } = await createHolding(
    db,
    userId,
    { product: { category: 'tcg', kind: 'single', name: 'X', cardNumber: '1' } },
    {
      quantity: 1,
      costTotalBase: 1,
      acquiredAt: new Date().toISOString(),
      grading: 'raw',
      rawGrade: 'A',
    },
  );
  const ask = (days: number) => ({
    productId: product.id,
    source: 'asks',
    observationType: 'listing' as const,
    bucket: null,
    priceBase: 100,
    observedAt: new Date(Date.now() - days * 86_400_000).toISOString(),
    fetchedAt: new Date().toISOString(),
    externalRef: `a${days}`,
    raw: { count: 3, ids: ['1', '2', '3'] },
  });
  await insertObservations(db, [ask(20), ask(2)]);
  expect(await pruneSourceDetails(db)).toBe(1);
  const rows = await db.select().from(schema.priceObservations);
  const raw = (ref: string) => rows.find((r) => r.externalRef === ref)!.raw;
  expect(raw('a20')).toEqual({ count: 3 });
  expect(raw('a2')).toEqual({ count: 3, ids: ['1', '2', '3'] });
});

it('accepts a link from any identity source, best first', async () => {
  const registry = await loadSourceRegistry(db);
  const box = { category: 'tcg', kind: 'booster_box' } as const;
  expect(identityFor(box, 10000, registry)).toEqual({
    preferred: 'snkrdunk',
    accepted: ['snkrdunk', 'surugaya'],
  });
  const game = { category: 'game', kind: 'game' } as never;
  expect(identityFor(game, 10000, registry)?.accepted).toEqual(['surugaya']);
  // Cheap items are not asked for one.
  expect(identityFor(game, 2000, registry)).toBeNull();
});

it('values each market with its own sources and identity choice', async () => {
  // A US source made the reference stays out of the primary (Japanese) value.
  await setSourceRoles(db, 'tcgcsv', { card: 'reference' });
  let registry = await loadSourceRegistry(db);
  expect(registry.markets).toMatchObject({ primary: 'jp', secondary: 'us' });
  expect(valuationOrder(registry, 'card')).toEqual(['snkrdunk', 'mercari']);
  expect(valuationOrder(registry, 'card', 'us')).toEqual(['tcgcsv']);
  // The admin's identity source comes first; none means none asked for.
  await setMarketSettings(db, {
    primary: 'jp',
    secondary: 'us',
    identity: { jp: { sealed: 'surugaya', item: null } },
  });
  registry = await loadSourceRegistry(db);
  expect(identitySources(registry, 'sealed')).toEqual(['surugaya', 'snkrdunk']);
  expect(identitySources(registry, 'item')).toEqual([]);
  // Swapping the markets swaps what the value counts.
  await setMarketSettings(db, { primary: 'us', secondary: 'jp' });
  registry = await loadSourceRegistry(db);
  expect(valuationOrder(registry, 'card')).toEqual(['tcgcsv']);
});

it("keeps the admin's order per class within a role, never across roles", async () => {
  let registry = await loadSourceRegistry(db);
  expect(valuationOrder(registry, 'sealed')).toEqual(['snkrdunk', 'mercari', 'surugaya']);
  // Sealed items try 駿河屋 before Mercari; cards keep their order; the reference stays first.
  await setSourceOrder(db, 'sealed', ['surugaya', 'snkrdunk', 'mercari']);
  registry = await loadSourceRegistry(db);
  expect(valuationOrder(registry, 'sealed')).toEqual(['snkrdunk', 'surugaya', 'mercari']);
  expect(valuationOrder(registry, 'item')).toEqual(['surugaya', 'mercari']);
  expect(valuationOrder(registry, 'card')).toEqual(['snkrdunk', 'mercari']);
  await setSourceOrder(db, 'item', ['mercari', 'surugaya']);
  registry = await loadSourceRegistry(db);
  expect(valuationOrder(registry, 'item')).toEqual(['surugaya', 'mercari']);
  expect(registry.order?.sealed?.[0]).toBe('surugaya');
});

it('shows a third market and keeps the compare choice and identity amount (S16)', async () => {
  await saveSourceInfos(db, [
    ...TEST_SOURCES,
    {
      key: 'cardmarket',
      label: 'Cardmarket',
      market: 'eu',
      currency: 'EUR',
      priceKinds: ['listing'],
      roles: { card: 'reference' },
      identity: ['card'],
    },
  ]);
  let registry = await loadSourceRegistry(db);
  expect(registry.markets).toMatchObject({ compare: 'secondary', identityMinCost: 3000 });
  expect(valuationOrder(registry, 'card', 'eu')).toEqual(['cardmarket']);
  await setMarketSettings(db, { ...registry.markets!, compare: 'all', identityMinCost: 10000 });
  registry = await loadSourceRegistry(db);
  expect(registry.markets).toMatchObject({ primary: 'jp', compare: 'all', identityMinCost: 10000 });
  // Items outside cards and sealed TCG need an identity link only above the admin's amount.
  const game = { category: 'game', kind: 'software', itemType: 'game' };
  expect(identityFor(game, 9000, registry)).toBeNull();
  expect(identityFor(game, 12000, registry)).not.toBeNull();
});

it('lists the sources blocked on a day, so later retries leave them alone', async () => {
  const run = async (source: string, status: 'ok' | 'blocked' | 'partial') =>
    finishRun(db, await startRun(db, source), { status, requests: 1, observationsAdded: 0 });
  await run('snkrdunk', 'blocked');
  await run('snkrdunk', 'ok');
  await run('mercari', 'partial');
  const today = (await db.select().from(schema.collectorRuns))[0]!.startedAt.slice(0, 10);
  expect([...(await blockedOn(db, today))]).toEqual(['snkrdunk']);
  expect((await blockedOn(db, '2000-01-01')).size).toBe(0);
});

it('counts a run with a refusal time as refused whatever its status', async () => {
  // Crashed after the refusal, before its end: left running, or closed failed by the next start.
  await db.insert(schema.collectorRuns).values([
    {
      source: 'shopa',
      status: 'running',
      startedAt: '2026-11-01T02:00:00.000+09:00',
      refusedAt: '2026-11-01T02:10:00.000+09:00',
    },
    {
      source: 'shopb',
      status: 'failed',
      startedAt: '2026-11-01T02:00:00.000+09:00',
      finishedAt: '2026-11-01T03:00:00.000+09:00',
      refusedAt: '2026-11-01T02:20:00.000+09:00',
    },
    { source: 'shopc', status: 'failed', startedAt: '2026-11-01T02:00:00.000+09:00' },
  ]);
  expect([...(await blockedOn(db, '2026-11-01'))].sort()).toEqual(['shopa', 'shopb']);
});

it('counts a refusal for the day it came, in the app time zone (K16)', async () => {
  // App time Asia/Tokyo (the default). Started 23:00 on the 1st, refused 00:20 on the 2nd.
  await db.insert(schema.collectorRuns).values([
    {
      source: 'shopa',
      status: 'blocked',
      startedAt: '2026-11-01T23:00:00.000+09:00',
      finishedAt: '2026-11-02T00:20:00.000+09:00',
    },
    // Refused at 23:59 on the 1st, its end written in UTC: still the 1st in app time.
    {
      source: 'shopb',
      status: 'blocked',
      startedAt: '2026-11-01T14:00:00.000Z',
      finishedAt: '2026-11-01T14:59:00.000Z',
    },
  ]);
  // A daytime job's refusal at 00:10 on the 2nd (app time), written as UTC on the 1st.
  await db.insert(schema.marketState).values([
    { source: 'shopc', perDay: 100, lastRefusalAt: '2026-11-01T15:10:00.000Z' },
    { source: 'shopd', perDay: 200, lastRefusalAt: null },
  ]);
  expect([...(await blockedOn(db, '2026-11-01'))].sort()).toEqual(['shopb']);
  expect([...(await blockedOn(db, '2026-11-02'))].sort()).toEqual(['shopa', 'shopc']);
  expect((await blockedOn(db, '2026-11-03')).size).toBe(0);
});

it('keys a refusal on its own time, not the end of the run (K16)', async () => {
  // App time Asia/Tokyo. Refused at 23:58 on the 1st, the run finishing at 00:05 on the 2nd.
  const id = await startRun(db, 'shopa');
  await markRunRefused(db, id, new Date('2026-11-01T23:58:00+09:00'));
  // A later refusal of the same run does not move it.
  await markRunRefused(db, id, new Date('2026-11-02T00:01:00+09:00'));
  await finishRun(db, id, { status: 'blocked', requests: 3, observationsAdded: 0 });
  await db
    .update(schema.collectorRuns)
    .set({
      startedAt: '2026-11-01T23:00:00.000+09:00',
      finishedAt: '2026-11-02T00:05:00.000+09:00',
    })
    .where(eq(schema.collectorRuns.id, id));
  const [row] = await db.select().from(schema.collectorRuns);
  expect(Date.parse(row!.refusedAt!)).toBe(Date.parse('2026-11-01T23:58:00+09:00'));
  expect([...(await blockedOn(db, '2026-11-01'))]).toEqual(['shopa']);
  expect((await blockedOn(db, '2026-11-02')).size).toBe(0);
});

it("records each run's working time and flags a long run and a long night (S16)", async () => {
  const run = async (source: string, activeMs: number) =>
    finishRun(db, await startRun(db, source), {
      status: 'ok',
      requests: 1,
      observationsAdded: 0,
      activeMs,
    });
  for (const ms of [600_000, 660_000, 540_000]) await run('snkrdunk', ms);
  await run('snkrdunk', 3_000_000);
  await run('mercari', 300_000);
  let times = await collectorTimes(db);
  expect(times.sources.snkrdunk).toEqual({ last: 3_000_000, usual: 600_000, long: true });
  expect(times.sources.mercari).toEqual({ last: 300_000, usual: null, long: false });
  expect(times).toMatchObject({ night: 3_300_000, windowHours: 6, over: false });
  await setCollectWindow(db, 0.5);
  times = await collectorTimes(db);
  expect(times).toMatchObject({ windowHours: 0.5, over: true });
});
