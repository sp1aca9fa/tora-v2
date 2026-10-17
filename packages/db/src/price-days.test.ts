import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { beforeEach, expect, it } from 'vitest';
import { type Db, createDb } from './client';
import { migrateDb } from './migrate';
import { createProduct, mergeProducts } from './mutations';
import { refreshPriceDays, soldDays } from './price-days';
import { saveSetting } from './registry';
import { priceDays, priceDaysDirty, priceObservations } from './schema';
import { setObservationExcluded } from './sources';
import { createUser } from './users';

let db: Db;
let uid: string;

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-price-days-'));
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
  observedAt: at,
  fetchedAt: at,
  externalRef: `r${ref++}`,
  ...extra,
});

const days = async (productId: string) =>
  (await db.select().from(priceDays).where(eq(priceDays.productId, productId))).sort((a, b) =>
    `${a.day}${a.currency}`.localeCompare(`${b.day}${b.currency}`),
  );

it('keeps the sold prices per day, marks only real changes and rebuilds the marked days', async () => {
  const p = await box('Box');
  const [first] = await db
    .insert(priceObservations)
    .values([
      sale(p.id, '2026-10-01T10:00:00.000+09:00', 1200),
      sale(p.id, '2026-10-01T18:00:00.000+09:00', 1000, { quantityInferred: true }),
      sale(p.id, '2026-10-01T19:00:00.000+09:00', 9999, { excluded: true }),
      sale(p.id, '2026-10-01T20:00:00.000+09:00', 800, { observationType: 'listing' }),
      sale(p.id, '2026-10-02T10:00:00.000+09:00', 15, { currency: 'USD' }),
    ])
    .returning();
  expect(await refreshPriceDays(db)).toEqual({ days: 2, full: true });
  expect(await db.select().from(priceDaysDirty)).toEqual([]);
  expect(await days(p.id)).toMatchObject([
    { day: '2026-10-01', currency: 'JPY', prices: [1000, 1200], estimated: 1, observations: 4 },
    { day: '2026-10-02', currency: 'USD', prices: [15], estimated: 0, observations: 1 },
  ]);
  expect(await soldDays(db, [p.id], { currency: 'JPY' })).toHaveLength(1);
  expect(await soldDays(db, [p.id], { since: '2026-10-02' })).toHaveLength(1);

  // Writing the same values (as a collect's upsert does) marks nothing.
  await db
    .update(priceObservations)
    .set({ priceBase: 1200 })
    .where(eq(priceObservations.id, first!.id));
  expect(await db.select().from(priceDaysDirty)).toEqual([]);

  // Excluding a sale in the app rebuilds its day at once, and only that day.
  await setObservationExcluded(db, first!.id, true);
  expect(await db.select().from(priceDaysDirty)).toEqual([]);
  expect((await days(p.id))[0]).toMatchObject({ prices: [1000], observations: 4 });

  // A sale moved to another day: both days are rebuilt.
  await db
    .update(priceObservations)
    .set({ observedAt: '2026-10-03T10:00:00.000+09:00', excluded: false })
    .where(eq(priceObservations.id, first!.id));
  expect(await refreshPriceDays(db)).toMatchObject({ full: false });
  expect((await days(p.id)).map((d) => [d.day, d.prices])).toEqual([
    ['2026-10-01', [1000]],
    ['2026-10-02', [15]],
    ['2026-10-03', [1200]],
  ]);
});

it('follows a merge, and rebuilds everything once a week', async () => {
  const a = await box('A');
  const b = await box('B');
  await db
    .insert(priceObservations)
    .values([
      sale(a.id, '2026-10-01T10:00:00.000+09:00', 100),
      sale(b.id, '2026-10-01T11:00:00.000+09:00', 300),
    ]);
  await refreshPriceDays(db);
  await mergeProducts(db, { id: uid, role: 'admin' }, a.id, b.id);
  expect(await days(a.id)).toEqual([]);
  expect((await days(b.id))[0]).toMatchObject({ prices: [100, 300], observations: 2 });

  expect(await refreshPriceDays(db)).toMatchObject({ full: false });
  await saveSetting(db, 'priceDaysBuiltAt', '2026-01-01T00:00:00.000+09:00');
  expect(await refreshPriceDays(db, { marksOnly: true })).toMatchObject({ full: false });
  expect(await refreshPriceDays(db)).toEqual({ days: 1, full: true });
});
