import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, it } from 'vitest';
import { type Db, createDb } from './client';
import { inferLotSizes } from './lot-sizes';
import { migrateDb } from './migrate';
import { createProduct } from './mutations';
import { setCurrencySettings } from './registry';
import { priceObservations } from './schema';
import { createUser } from './users';

let db: Db;
let productId: string;

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-lots-'));
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  const uid = (
    await createUser(db, 'alice', { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] })
  ).user.id;
  productId = (
    await createProduct(db, uid, { category: 'tcg', kind: 'single', name: 'ピカチュウ' })
  ).id;
  return () => rm(dir, { recursive: true, force: true });
});

const trade = (ref: string, day: string, price: number, inferred = true) => ({
  productId,
  source: 'snkrdunk',
  observationType: 'sold' as const,
  bucket: 'graded:PSA:10',
  priceBase: price,
  priceOriginal: price,
  currency: 'JPY',
  observedAt: `2026-10-${day}T12:00:00.000+09:00`,
  fetchedAt: '2026-10-10T00:00:00.000Z',
  externalRef: ref,
  quantityInferred: inferred,
});

it('divides trades priced at a multiple of the going rate, and is re-runnable', async () => {
  await db.insert(priceObservations).values([
    trade('a', '01', 10_400),
    trade('b', '01', 10_500),
    trade('c', '02', 104_000),
    trade('d', '02', 10_499),
    trade('e', '03', 20_300),
    trade('f', '03', 10_650, false),
    // Two weeks later: no neighbours, so it stays a single unit.
    trade('g', '20', 50_000),
  ]);
  const now = new Date('2026-10-21T12:00:00+09:00');
  expect(await inferLotSizes(db, { now })).toEqual({ checked: 6, updated: 2, full: true });
  const price = new Map(
    (await db.select().from(priceObservations)).map((r) => [r.externalRef, r.priceBase]),
  );
  expect(price.get('c')).toBe(10_400);
  expect(price.get('e')).toBe(10_150);
  expect(price.get('g')).toBe(50_000);
  expect(await inferLotSizes(db, { now, full: true })).toEqual({
    checked: 6,
    updated: 0,
    full: true,
  });
  // The next night, within the week: only the last 14 days' trades (day 20), their neighbours
  // read with them.
  await db
    .insert(priceObservations)
    .values([
      trade('h', '19', 10_100, false),
      trade('i', '21', 9_900, false),
      trade('j', '21', 10_000, false),
    ]);
  const next = new Date('2026-10-22T12:00:00+09:00');
  expect(await inferLotSizes(db, { now: next })).toEqual({ checked: 1, updated: 1, full: false });
  expect(
    (await db.select().from(priceObservations)).find((r) => r.externalRef === 'g')?.priceBase,
  ).toBe(10_000);
});

it('reads a lot price in its own currency, converted to a non-yen base with its rate', async () => {
  await setCurrencySettings(db, { base: 'EUR', rates: { USD: { manual: 0.9 } } });
  // Dollar trades, 0.9 euro per dollar: one unit is $100 (90 euros).
  const usd = (
    ref: string,
    day: string,
    cents: number,
    inferred: boolean,
    fxRate: number | null,
  ) => ({
    ...trade(ref, day, Math.round(cents * 0.9), inferred),
    priceOriginal: cents,
    currency: 'USD',
    fxRate,
  });
  await db.insert(priceObservations).values([
    usd('a', '01', 10_000, false, 0.9),
    usd('b', '01', 10_000, false, 0.9),
    usd('c', '02', 10_000, false, 0.9),
    usd('lot', '02', 30_000, true, 0.9),
    // A foreign price with no rate: unknown, left as it is.
    usd('norate', '02', 30_000, true, null),
  ]);
  await inferLotSizes(db, { now: new Date('2026-10-05T12:00:00+09:00'), full: true });
  const price = new Map(
    (await db.select().from(priceObservations)).map((r) => [r.externalRef, r.priceBase]),
  );
  // $300 is 270 euros, three units of 90 (in dollars against euro references it was 3.33 units).
  expect(price.get('lot')).toBe(9_000);
  expect(price.get('norate')).toBe(27_000);
});
