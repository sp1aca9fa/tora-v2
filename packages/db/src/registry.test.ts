import { valuationOrder } from '@tora/core';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
} from './registry';
import { identityFor, insertObservations } from './sources';
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
        costTotalJpy: 1000,
        acquiredAt: new Date().toISOString(),
        grading: 'raw',
        rawGrade: 'A',
      },
    );
    const sale = (source: string, priceJpy: number, day: number) => ({
      productId: product.id,
      source,
      observationType: 'sold' as const,
      bucket: 'raw:A',
      priceJpy,
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
      costTotalJpy: 1,
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
    priceJpy: 100,
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
