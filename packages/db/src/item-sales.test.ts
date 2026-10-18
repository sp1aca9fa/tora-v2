import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toLocalIso } from '@tora/core';
import { eq } from 'drizzle-orm';
import { beforeEach, expect, it } from 'vitest';
import { type Db, createDb } from './client';
import {
  checkItemSales,
  loadItemSales,
  refreshItemSales,
  soldDays,
  sourceCounts,
  unpackSales,
} from './item-sales';
import { migrateDb } from './migrate';
import { createProduct, mergeProducts } from './mutations';
import { saveSetting } from './registry';
import { itemSales, priceDaysDirty, priceObservations } from './schema';
import { setObservationExcluded } from './sources';
import { createUser } from './users';

let db: Db;
let uid: string;

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-item-sales-'));
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  const creds = { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] };
  uid = (await createUser(db, 'a', creds, 'admin')).user.id;
  return () => rm(dir, { recursive: true, force: true });
});

const box = (name: string) =>
  createProduct(db, uid, { category: 'tcg', kind: 'booster_box', name, franchise: 'pokemon' });

let ref = 0;
const sale = (productId: string, at: string, price: number, extra: object = {}) => ({
  productId,
  source: 'snkrdunk',
  observationType: 'sold' as const,
  bucket: 'sealed:shrink',
  priceBase: price,
  currency: 'JPY',
  // Stored in the app's time zone, as collects save them.
  observedAt: toLocalIso(new Date(at)),
  fetchedAt: at,
  externalRef: `r${ref++}`,
  ...extra,
});

const days = async (productId: string) =>
  (await soldDays(db, [productId])).sort((a, b) =>
    `${a.day}${a.currency}`.localeCompare(`${b.day}${b.currency}`),
  );

it('packs the kept sales with their exact times, marks only real changes, updates marked days', async () => {
  const p = await box('Box');
  const [first] = await db
    .insert(priceObservations)
    .values([
      sale(p.id, '2026-10-01T02:00:00.000Z', 1200),
      sale(p.id, '2026-10-01T03:00:00.000Z', 1000, { quantityInferred: true }),
      sale(p.id, '2026-10-01T04:00:00.000Z', 9999, { excluded: true }),
      sale(p.id, '2026-10-01T05:00:00.000Z', 800, { observationType: 'listing' }),
      sale(p.id, '2026-10-02T02:00:00.000Z', 15, { currency: 'USD' }),
    ])
    .returning();
  expect(await refreshItemSales(db)).toEqual({ items: 1, full: true });
  expect(await db.select().from(priceDaysDirty)).toEqual([]);
  // The same observations as the raw sales (kept ones), times exactly as stored.
  const packed = (await loadItemSales(db, [p.id])).get(p.id);
  const raw = (await db.select().from(priceObservations))
    .filter((r) => !r.excluded)
    .map((r) => [r.observationType, r.observedAt, r.priceBase, r.quantityInferred, r.currency]);
  expect(
    unpackSales(packed)
      .map((o) => [o.observationType, o.observedAt, o.priceBase, o.quantityInferred, o.currency])
      .sort(),
  ).toEqual(raw.sort());
  expect(await days(p.id)).toMatchObject([
    { currency: 'JPY', prices: [1000, 1200], estimated: 1 },
    { currency: 'USD', prices: [15], estimated: 0 },
  ]);
  expect(sourceCounts(packed)).toEqual([{ source: 'snkrdunk', n: 5, latest: '2026-10-02' }]);
  expect(await soldDays(db, [p.id], { currency: 'JPY' })).toHaveLength(1);

  // Writing the same values (as a collect's upsert does) marks nothing.
  await db
    .update(priceObservations)
    .set({ priceBase: 1200 })
    .where(eq(priceObservations.id, first!.id));
  expect(await db.select().from(priceDaysDirty)).toEqual([]);

  // Excluding a sale in the app updates its day at once.
  await setObservationExcluded(db, first!.id, true);
  expect(await db.select().from(priceDaysDirty)).toEqual([]);
  expect((await days(p.id))[0]).toMatchObject({ prices: [1000], estimated: 1 });

  // A sale moved to another day: both days are updated, the rest kept.
  await db
    .update(priceObservations)
    .set({ observedAt: toLocalIso(new Date('2026-10-05T02:00:00.000Z')), excluded: false })
    .where(eq(priceObservations.id, first!.id));
  expect(await refreshItemSales(db)).toMatchObject({ full: false });
  expect((await days(p.id)).map((d) => d.prices)).toEqual([[1000], [15], [1200]]);
  const after = (await loadItemSales(db, [p.id])).get(p.id);
  expect(unpackSales(after, { types: ['listing'] }).map((o) => o.priceBase)).toEqual([800]);
  expect(sourceCounts(after)[0]!.n).toBe(5);
});

it('follows a merge, and rebuilds everything once a week', async () => {
  const a = await box('A');
  const b = await box('B');
  await db
    .insert(priceObservations)
    .values([
      sale(a.id, '2026-10-01T10:00:00.000Z', 100),
      sale(b.id, '2026-10-01T11:00:00.000Z', 300),
    ]);
  await refreshItemSales(db);
  await mergeProducts(db, { id: uid, role: 'admin' }, a.id, b.id);
  expect((await loadItemSales(db, [a.id])).size).toBe(0);
  expect((await days(b.id))[0]).toMatchObject({ prices: [100, 300] });

  expect(await refreshItemSales(db)).toMatchObject({ full: false });
  await saveSetting(db, 'itemSalesBuiltAt', '2026-01-01T00:00:00.000+09:00');
  expect(await refreshItemSales(db, { marksOnly: true })).toMatchObject({ full: false });
  expect(await refreshItemSales(db)).toMatchObject({ full: true });
  expect((await days(b.id))[0]).toMatchObject({ prices: [100, 300] });
});

it('the self-check finds a saved row that drifted from the sales, fixes it, and skips marked items', async () => {
  const a = await box('A');
  const b = await box('B');
  await db
    .insert(priceObservations)
    .values([
      sale(a.id, '2026-10-01T02:00:00.000Z', 100),
      sale(a.id, '2026-10-02T02:00:00.000Z', 200),
      sale(b.id, '2026-10-01T02:00:00.000Z', 300),
    ]);
  await refreshItemSales(db);
  expect(await checkItemSales(db)).toEqual({ checked: 2, fixed: [] });
  // A's row loses a sale behind the marks' back (as a bug would).
  const drifted = (await loadItemSales(db, [a.id])).get(a.id)!;
  drifted.groups[0]!.at.pop();
  drifted.groups[0]!.p.pop();
  await db
    .update(itemSales)
    .set({ sales: drifted, checkedAt: null })
    .where(eq(itemSales.productId, a.id));
  // B has a change still marked: left for the next night.
  await db.insert(priceObservations).values([sale(b.id, '2026-10-03T02:00:00.000Z', 310)]);
  expect(await checkItemSales(db)).toEqual({ checked: 1, fixed: [a.id] });
  expect((await days(a.id)).map((d) => d.prices)).toEqual([[100], [200]]);
});
