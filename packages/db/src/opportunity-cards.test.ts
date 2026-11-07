// The Worth a look list (S26): proven first, ties nearest their target, by type and signal, in
// batches.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type UserPreferences, localDate, toLocalIso } from '@tora/core';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { type Db, createDb } from './client';
import { migrateDb } from './migrate';
import { createProduct } from './mutations';
import {
  type OpportunityItem,
  opportunityCards,
  rarityOptions,
  setSignalPick,
} from './opportunities';
import { saveSetting } from './registry';
import { products, signals } from './schema';
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

describe('ways of spotting a deal and potential (S32)', () => {
  const names = (c: { items: { product: { name: string } }[] }) =>
    c.items.map((i) => i.product.name);
  const cards = (
    filter: Partial<Parameters<typeof opportunityCards>[2]>,
    offset = 0,
    limit = 20,
    preferences: UserPreferences | null = null,
  ) =>
    opportunityCards(
      db,
      { id: uid, preferences },
      { type: 'sealed', ...filter },
      offset,
      limit,
      now,
    ).then((c) => c!);
  /** A box with these numbers on top of the usual ones, none of them a way when left out. */
  const withNumbers = async (
    name: string,
    numbers: Partial<OpportunityItem['numbers']>,
    more: Partial<OpportunityItem> = {},
  ) => {
    const { item } = await box(name, [], 9000);
    return { ...item, numbers: { ...item.numbers, salesBefore: null, ...numbers }, ...more };
  };
  const save = (items: OpportunityItem[]) =>
    saveSetting(db, 'opportunities', { day: localDate(now), tests: {}, items });

  it('filters by a way, counts each way with items, pages, and leaves unknown out', async () => {
    await save([
      await withNumbers('Fall one', { jump14: -0.3 }),
      await withNumbers('Fall two', { jump14: -0.25 }),
      await withNumbers('Fall three', { jump14: -0.2 }),
      await withNumbers('Calm', { jump14: 0 }),
      // Unknown: saved before these numbers existed.
      await withNumbers('Old data', {}),
      (await box('Fall in another type', [], 9000, 'card')).item,
    ]);
    const all = await cards({});
    expect(all.total).toBe(5);
    expect(all.ways).toEqual([{ key: 'falling_hard', items: 3 }]);
    const first = await cards({ way: 'falling_hard' }, 0, 2);
    expect(first.total).toBe(3);
    expect(first.items).toHaveLength(2);
    const rest = await cards({ way: 'falling_hard' }, 2, 2);
    expect(rest.items).toHaveLength(1);
    expect(new Set([...names(first), ...names(rest)])).toEqual(
      new Set(['Fall one', 'Fall two', 'Fall three']),
    );
    // A way nothing is on: no items, no chip.
    const none = await cards({ way: 'rising_fast' });
    expect([none.total, none.items]).toEqual([0, []]);
    expect(none.ways.some((w) => w.key === 'rising_fast')).toBe(false);
  });

  it('combines a way with a name search and with signals', async () => {
    await save([
      await withNumbers('Dragon fall', { jump14: -0.3 }),
      await withNumbers('Knight fall', { jump14: -0.3 }),
      await withNumbers('Dragon calm', { jump14: 0 }),
    ]);
    const found = await cards({ way: 'falling_hard', q: 'dragon' });
    expect(names(found)).toEqual(['Dragon fall']);
    // The chip counts what choosing it would show.
    expect(found.ways).toEqual([{ key: 'falling_hard', items: 1 }]);
    const signal = await cards({ way: 'falling_hard', signals: ['sales_up'] });
    expect([signal.total, signal.ways]).toEqual([0, []]);
  });

  it('reads old saved data as unknown for listings, and new data on, off', async () => {
    await save([
      await withNumbers('Old', {}),
      await withNumbers('Drying', {}, { listings: { now: 7, before: 10 } }),
      await withNumbers('Steady', {}, { listings: { now: 10, before: 10 } }),
      await withNumbers('No count', {}, { listings: { now: null, before: 10 } }),
    ]);
    expect(names(await cards({ way: 'listings_drying' }))).toEqual(['Drying']);
  });

  it('orders a way by potential first only, tags rows, and leaves other lists as they were', async () => {
    const items = [
      await withNumbers('Aaa plain', { jump14: -0.3 }),
      await withNumbers('Bbb Dragon', { jump14: -0.3 }),
      await withNumbers('Ccc Dragon Knight', { jump14: -0.3 }),
    ];
    await save(items);
    const prefs: UserPreferences = { potential: { subjects: ['dragon', 'KNIGHT'] } };
    const plain = await cards({ way: 'falling_hard' });
    expect(plain.items.every((i) => i.potential.length === 0)).toBe(true);
    const set = await cards({ way: 'falling_hard' }, 0, 20, prefs);
    expect(names(set)).toEqual(['Ccc Dragon Knight', 'Bbb Dragon', 'Aaa plain']);
    expect(set.items.map((i) => i.potential.length)).toEqual([2, 1, 0]);
    // Headings go only when the criteria really moved something in a way's list.
    expect(set.reordered).toBe(true);
    expect(plain.reordered).toBe(false);
    expect((await cards({}, 0, 20, prefs)).reordered).toBe(false);
    const unmet: UserPreferences = { potential: { subjects: ['nothing like this'] } };
    expect((await cards({ way: 'falling_hard' }, 0, 20, unmet)).reordered).toBe(false);
    // Across batches too.
    expect(names(await cards({ way: 'falling_hard' }, 1, 1, prefs))).toEqual(['Bbb Dragon']);
    // Criteria set with no way: tags, but the usual order, the same as with none.
    const noWay = await cards({}, 0, 20, prefs);
    expect(names(noWay)).toEqual(names(await cards({})));
    expect(noWay.items.find((i) => i.product.name === 'Bbb Dragon')!.potential).toEqual([
      { kind: 'subject', value: 'dragon' },
    ]);
    // Empty criteria: the same as none.
    const empty: UserPreferences = {
      potential: { subjects: [], rarities: [], outOfPrint: false, ranked: false },
    };
    expect(names(await cards({ way: 'falling_hard' }, 0, 20, empty))).toEqual(names(plain));
  });

  it('meets rarity, the out of print mark and a current rank from the item', async () => {
    const a = await withNumbers('Marked', { jump14: -0.3 });
    const b = await withNumbers('Plain', { jump14: -0.3 });
    await db
      .update(products)
      .set({ reprint: 'none', rarity: 'XR' })
      .where(eq(products.id, a.productId));
    await save([a, b]);
    expect(await rarityOptions(db)).toEqual(['XR']);
    const c = await cards({ way: 'falling_hard' }, 0, 20, {
      potential: { rarities: ['XR'], outOfPrint: true, ranked: true },
    });
    expect(c.items.map((i) => [i.product.name, i.potential])).toEqual([
      ['Marked', [{ kind: 'rarity', value: 'XR' }, { kind: 'out_of_print' }]],
      ['Plain', []],
    ]);
  });
});
