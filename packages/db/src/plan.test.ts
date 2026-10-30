import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, it } from 'vitest';
import { localDate, toLocalIso } from '@tora/core';
import { type Db, createDb } from './client';
import { migrateDb } from './migrate';
import { createHolding, createProduct } from './mutations';
import { buyPlanFor, spentInMonth } from './plan';
import { signals } from './schema';
import { getUserById, createUser, setPreferences } from './users';
import { addWatch } from './watches';

let db: Db;
let uid: string;

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-plan-'));
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  const creds = { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] };
  uid = (await createUser(db, 'a', creds, 'admin')).user.id;
  return () => rm(dir, { recursive: true, force: true });
});

it("offers the person's watches and plan items with when to buy and at what price", async () => {
  const product = await createProduct(db, uid, {
    category: 'tcg',
    kind: 'booster_box',
    name: 'Box',
    franchise: 'pokemon',
    region: 'jp',
  });
  await addWatch(db, uid, { productId: product.id }, { packagingState: 'sealed_shrink' });
  const now = new Date();
  await db.insert(signals).values({
    productId: product.id,
    bucket: 'sealed:shrink',
    day: localDate(now),
    source: 'snkrdunk',
    stats: {
      fair: 8800,
      sales30: 20,
      days180: 100,
      days365: 200,
      usual180: 10000,
      q25d180: 9000,
      q75d180: 11000,
      q10d365: 8000,
      cheaperThan180: 0.9,
      trend14: 0,
      trend28: 0,
      trend84: 0,
      ask: null,
      ageDays: null,
      releaseFrom: null,
      market: null,
      pattern: null,
    },
    createdAt: toLocalIso(now),
    updatedAt: toLocalIso(now),
  });
  // An item in the plan with no numbers yet: offered, without a price.
  const other = await createProduct(db, uid, {
    category: 'tcg',
    kind: 'booster_box',
    name: 'Other',
    franchise: 'pokemon',
    region: 'jp',
  });
  await setPreferences(db, uid, {
    buyPlan: {
      budget: 20000,
      until: '2026-12-31',
      items: [
        { productId: product.id, bucket: 'sealed:shrink' },
        { productId: other.id, bucket: '' },
      ],
    },
  });
  const plan = await buyPlanFor(db, (await getUserById(db, uid))!, now);
  expect(plan.map((p) => [p.product.name, p.step.when, p.step.price, p.from, p.ticked])).toEqual([
    ['Box', 'now', 8800, ['watch', 'plan'], true],
    ['Other', 'none', null, ['plan'], true],
  ]);
});

it("counts a month's purchases only, at cost, sold or not (a monthly plan)", async () => {
  const box = {
    productId: (await createProduct(db, uid, { category: 'tcg', kind: 'booster_box', name: 'Box' }))
      .id,
  };
  const lot = (costTotalBase: number, acquiredAt: string, more = {}) =>
    createHolding(db, uid, box, { quantity: 1, costTotalBase, acquiredAt, ...more });
  await lot(5000, '2026-10-01T00:10:00.000+09:00');
  await lot(3000, '2026-10-31T23:50:00.000+09:00');
  await lot(9000, '2026-10-15T12:00:00.000+09:00', { acquisitionType: 'gift' });
  await lot(7000, '2026-09-30T23:59:00.000+09:00');
  const other = (
    await createUser(db, 'b', { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] })
  ).user.id;
  await createHolding(db, other, box, {
    quantity: 1,
    costTotalBase: 4000,
    acquiredAt: '2026-10-02T12:00:00.000+09:00',
  });
  expect(await spentInMonth(db, uid, '2026-10')).toEqual({
    total: 8000,
    lots: 2,
    productIds: [box.productId],
  });
  expect((await spentInMonth(db, uid, '2026-11')).lots).toBe(0);
});
