// Edge cases tried on purpose (requirements S15).
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, it } from 'vitest';
import { type Db, createDb } from './client';
import { migrateDb } from './migrate';
import { createHolding } from './mutations';
import { setMarketSettings, saveSourceInfos, setSourceRoles } from './registry';
import { getHoldingDetail, listInventory, searchProducts } from './queries';
import { insertObservations } from './sources';
import { TEST_SOURCES } from './testing';
import { createUser, getActiveDevice, registerDevice, revokeDevice } from './users';
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

it('takes two devices per account, refuses a third, and forgets a revoked one', async () => {
  const phone = await registerDevice(db, userId, 'phone');
  const pc = await registerDevice(db, userId, 'pc');
  expect(phone && pc).toBeTruthy();
  expect(await registerDevice(db, userId, 'tablet')).toBeNull();
  // Another person's slots are their own.
  const other = (
    await createUser(db, 'b', { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] })
  ).user.id;
  expect(await revokeDevice(db, other, phone!.id)).toBe(false);
  expect(await getActiveDevice(db, userId, phone!.id)).toBeTruthy();
  expect(await revokeDevice(db, userId, phone!.id)).toBe(true);
  // A signed-in session on the revoked device no longer finds it, and its slot is free.
  expect(await getActiveDevice(db, userId, phone!.id)).toBeFalsy();
  expect(await registerDevice(db, userId, 'tablet')).toBeTruthy();
});

it('keeps names and notes with markup, quotes, wildcards and emoji as typed, and finds them', async () => {
  const names = [
    '<script>alert(1)</script> Box',
    "Robert'); DROP TABLE holdings;--",
    '100% Pack_A \\ 50%',
    'ピカチュウ🎴 ＭＥＧＡ ex',
    'L'.repeat(1000),
  ];
  for (const name of names)
    await createHolding(
      db,
      userId,
      { product: { category: 'tcg', kind: 'single', name, cardNumber: '1' } },
      {
        quantity: 1,
        costTotalBase: 0,
        acquiredAt: new Date().toISOString(),
        notes: `${name}\n"quoted" & <b>`,
      },
    );
  const lots = await listInventory(db, userId);
  expect(lots.map((l) => l.product.name).toSorted()).toEqual(names.toSorted());
  for (const { holding, product } of lots) {
    const detail = await getHoldingDetail(db, userId, holding.id);
    expect(detail?.holding.notes).toBe(`${product.name}\n"quoted" & <b>`);
  }
  // Wildcards and quotes in a search are plain text; full-width letters match their plain forms.
  const found = async (q: string) =>
    (await listInventory(db, userId, { q })).map((l) => l.product.name);
  expect(await found('%')).toEqual(['100% Pack_A \\ 50%']);
  expect(await found('_')).toEqual(['100% Pack_A \\ 50%']);
  expect(await found('\\')).toEqual(['100% Pack_A \\ 50%']);
  expect(await found("'); DROP")).toEqual(["Robert'); DROP TABLE holdings;--"]);
  expect(await found('🎴')).toEqual(['ピカチュウ🎴 ＭＥＧＡ ex']);
  expect(await found('<script>')).toHaveLength(1);
  expect((await searchProducts(db, 'mega')).map((p) => p.name)).toEqual([
    'ピカチュウ🎴 ＭＥＧＡ ex',
  ]);
});
