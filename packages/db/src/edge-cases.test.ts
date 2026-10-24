// Edge cases tried on purpose (requirements S15).
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, it } from 'vitest';
import { type Db, createDb } from './client';
import { migrateDb } from './migrate';
import { createHolding } from './mutations';
import { setMarketSettings, saveSourceInfos, setSourceRoles } from './registry';
import { insertObservations } from './sources';
import { TEST_SOURCES } from './testing';
import { createUser } from './users';
import {
  clearAllBucketValues,
  portfolioSeries,
  portfolioValuation,
  refreshBucketValues,
  runSnapshots,
} from './valuation';

let db: Db;
let userId: string;

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-edge-'));
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  await saveSourceInfos(db, TEST_SOURCES);
  userId = (
    await createUser(db, 'a', { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] })
  ).user.id;
  return () => rm(dir, { recursive: true, force: true });
});

const DAY = 86_400_000;

it('gives the same values after switching the primary market away and back', async () => {
  await setSourceRoles(db, 'tcgcsv', { card: 'reference' });
  let ref = 0;
  for (let i = 0; i < 3; i++) {
    const { product } = await createHolding(
      db,
      userId,
      { product: { category: 'tcg', kind: 'single', name: `Card ${i}`, cardNumber: String(i) } },
      {
        quantity: 1 + i,
        costTotalBase: 1000,
        acquiredAt: new Date(Date.now() - 40 * DAY).toISOString(),
        grading: 'raw',
        rawGrade: 'A',
      },
    );
    const sale = (source: string, priceBase: number, daysAgo: number) => ({
      productId: product.id,
      source,
      observationType: 'sold' as const,
      bucket: 'raw:A',
      priceBase,
      observedAt: new Date(Date.now() - daysAgo * DAY).toISOString(),
      fetchedAt: new Date().toISOString(),
      externalRef: `r${ref++}`,
    });
    await insertObservations(db, [
      ...[2, 9, 20, 35].map((d) => sale('snkrdunk', 10_000 + i * 1000 + d, d)),
      ...[3, 12, 25].map((d) => sale('tcgcsv', 15_000 + i * 500 + d, d)),
    ]);
  }
  // What a market change does (Admin > Markets): values cleared, then saved again.
  const switchTo = async (primary: string, secondary: string) => {
    await setMarketSettings(db, { primary, secondary });
    await clearAllBucketValues(db);
    await refreshBucketValues(db);
    await runSnapshots(db);
  };
  const state = async () => {
    const p = await portfolioValuation(db, userId);
    return {
      totals: p.totals,
      values: p.rows.map((r) => [r.holding.id, r.valuation.valueBase, r.valuation.source]),
      series: await portfolioSeries(db, userId),
    };
  };
  await switchTo('jp', 'us');
  const before = await state();
  expect(before.values.every(([, , source]) => source === 'snkrdunk')).toBe(true);
  await switchTo('us', 'jp');
  const away = await state();
  expect(away.values.every(([, , source]) => source === 'tcgcsv')).toBe(true);
  expect(away.totals.valueBase).not.toBe(before.totals.valueBase);
  await switchTo('jp', 'us');
  expect(await state()).toEqual(before);
});

it('values nothing, without failing, from a market with no sources or a removed plug-in', async () => {
  const { product } = await createHolding(
    db,
    userId,
    { product: { category: 'tcg', kind: 'single', name: 'Card', cardNumber: '1' } },
    {
      quantity: 1,
      costTotalBase: 1000,
      acquiredAt: new Date(Date.now() - 10 * DAY).toISOString(),
      grading: 'raw',
      rawGrade: 'A',
    },
  );
  // Sales kept from a plug-in that is no longer installed (its key unknown to the registry).
  await insertObservations(
    db,
    [1, 2, 3].map((d) => ({
      productId: product.id,
      source: 'removedplugin',
      observationType: 'sold' as const,
      bucket: 'raw:A',
      priceBase: 5000,
      observedAt: new Date(Date.now() - d * DAY).toISOString(),
      fetchedAt: new Date().toISOString(),
      externalRef: `gone${d}`,
    })),
  );
  await refreshBucketValues(db);
  await runSnapshots(db);
  let p = await portfolioValuation(db, userId);
  expect(p.rows[0]!.valuation.source).not.toBe('removedplugin');
  // A primary market no source belongs to.
  await setMarketSettings(db, { primary: 'eu', secondary: 'jp' });
  await clearAllBucketValues(db);
  await refreshBucketValues(db);
  await runSnapshots(db);
  p = await portfolioValuation(db, userId);
  expect(p.totals).toMatchObject({ valued: 0, total: 1, valueBase: 0 });
  expect((await portfolioSeries(db, userId)).length).toBeGreaterThan(0);
});
