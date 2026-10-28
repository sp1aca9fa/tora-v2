// The Worth a look list (S26): proven first, ties nearest their target, by type and signal, in
// batches.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localDate, toLocalIso } from '@tora/core';
import { beforeEach, expect, it } from 'vitest';
import { type Db, createDb } from './client';
import { migrateDb } from './migrate';
import { createProduct } from './mutations';
import { type OpportunityItem, opportunityCards, setSignalPick } from './opportunities';
import { saveSetting } from './registry';
import { signals } from './schema';
import { createUser } from './users';

let db: Db;
let uid: string;
const now = new Date();
const GROUP = 'tcg|booster_box|pokemon|jp';

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-cards-'));
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  const creds = { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] };
  uid = (await createUser(db, 'a', creds, 'admin')).user.id;
  return () => rm(dir, { recursive: true, force: true });
});

const test = (checked: number, higher: number) => ({
  signals: checked,
  checked,
  higher,
  change: 0.1,
});

/** A box with signals on and buy timing numbers at this fair value (usual price 10,000). */
async function box(name: string, on: OpportunityItem['on'], fair: number, type = 'sealed') {
  const p = await createProduct(db, uid, {
    category: 'tcg',
    kind: 'booster_box',
    name,
    franchise: 'pokemon',
    region: 'jp',
  });
  await db.insert(signals).values({
    productId: p.id,
    bucket: 'sealed:shrink',
    day: localDate(now),
    source: 'snkrdunk',
    stats: {
      fair,
      sales30: 20,
      days180: 100,
      days365: 200,
      usual180: 10000,
      q25d180: 9000,
      q75d180: 11000,
      q10d365: 8000,
      cheaperThan180: 0.5,
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
  const item: OpportunityItem = {
    productId: p.id,
    bucket: 'sealed:shrink',
    source: 'snkrdunk',
    group: GROUP,
    itemType: type,
    numbers: { price: fair, own84: null, line84: null, sales30: 20, salesBefore: 10, age: null },
    on,
    ask: null,
    buylist: null,
  };
  return { p, item };
}

it('ranks proven items first, then the rest nearest their target, in batches', async () => {
  const a = await box('Proven far', ['sales_up'], 12000);
  const b = await box('Proven near', ['sales_up'], 9000);
  const c = await box('Unproven near', ['leader'], 8000);
  const d = await box('Nothing far', [], 15000);
  const e = await box('A card', ['sales_up'], 9000, 'card');
  await saveSetting(db, 'opportunities', {
    day: localDate(now),
    tests: {
      [GROUP]: {
        day: localDate(now),
        items: 5,
        any: test(100, 60),
        signals: { sales_up: test(20, 18), leader: test(4, 4) },
      },
    },
    items: [a, b, c, d, e].map((x) => x.item),
  });
  const user = { id: uid, preferences: null };
  const first = (await opportunityCards(db, user, { type: 'sealed' }, 0, 2, now))!;
  expect(first.type).toBe('sealed');
  expect(first.summary.types).toEqual([
    { type: 'sealed', items: 4, proven: 2 },
    { type: 'card', items: 1, proven: 1 },
  ]);
  expect(first.summary.signals.sealed!.map((s) => s.key)).toEqual(['sales_up']);
  expect([first.total, first.proven]).toEqual([4, 2]);
  // Both proven with the same score: the one nearer its target first.
  expect(first.items.map((i) => i.product.name)).toEqual(['Proven near', 'Proven far']);
  expect(first.items[0]!.target).toBeGreaterThan(0);
  expect(first.items[0]!.now).toBe(9000);
  const rest = (await opportunityCards(db, user, { type: 'sealed' }, 2, 20, now))!;
  expect(rest.items.map((i) => i.product.name)).toEqual(['Unproven near', 'Nothing far']);
  const bySignal = (await opportunityCards(
    db,
    user,
    { type: 'sealed', signals: ['sales_up'] },
    0,
    20,
    now,
  ))!;
  expect(bySignal.items.map((i) => i.product.name)).toEqual(['Proven near', 'Proven far']);
  // An unknown type falls back to the one with the most items worth a look.
  expect((await opportunityCards(db, user, { type: 'nope' }, 0, 1, now))!.type).toBe('sealed');
});

it('ranks an item whose warning outweighs its signal with the rest', async () => {
  const a = await box('Outweighed', ['sales_up', 'sales_down'], 9000);
  const b = await box('Plain good', ['sales_up'], 9000);
  await saveSetting(db, 'opportunities', {
    day: localDate(now),
    tests: {
      [GROUP]: {
        day: localDate(now),
        items: 2,
        any: test(100, 60),
        signals: { sales_up: test(20, 18), sales_down: test(20, 2) },
      },
    },
    items: [a, b].map((x) => x.item),
  });
  const user = { id: uid, preferences: null };
  const c = (await opportunityCards(db, user, { type: 'sealed' }, 0, 20, now))!;
  expect(c.proven).toBe(1);
  expect(c.summary.types[0]!.proven).toBe(1);
  expect(c.items.map((i) => i.product.name)).toEqual(['Plain good', 'Outweighed']);
});

it('puts a plug-in signal an admin picks after the proven items, apart', async () => {
  const a = await box('Proven', ['sales_up'], 9000);
  const b = await box('Picked', ['slab_cheap'], 9000);
  const c = await box('Plain', [], 9000);
  await saveSetting(db, 'opportunities', {
    day: localDate(now),
    tests: {
      [GROUP]: {
        day: localDate(now),
        items: 3,
        any: test(100, 60),
        signals: { sales_up: test(20, 18), slab_cheap: test(4, 3) },
      },
    },
    items: [a, b, c].map((x) => x.item),
    rules: [{ key: 'slab_cheap', label: 'Cheap slab', about: 'A slab is cheap.' }],
  });
  const user = { id: uid, preferences: null };
  const names = async () =>
    (await opportunityCards(db, user, { type: 'sealed' }, 0, 20, now))!.items.map(
      (i) => `${i.product.name}${i.picked.length ? '*' : ''}`,
    );
  expect(await names()).toEqual(['Proven', 'Picked', 'Plain']);
  await setSignalPick(db, 'slab_cheap', true);
  const picked = (await opportunityCards(db, user, { type: 'sealed' }, 0, 20, now))!;
  expect([picked.proven, picked.picked]).toEqual([1, 1]);
  expect(picked.rules[0]!.label).toBe('Cheap slab');
  expect(await names()).toEqual(['Proven', 'Picked*', 'Plain']);
  await setSignalPick(db, 'slab_cheap', false);
  expect(await names()).toEqual(['Proven', 'Picked', 'Plain']);
});
