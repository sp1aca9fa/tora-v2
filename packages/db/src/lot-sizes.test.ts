import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, it } from 'vitest';
import { type Db, createDb } from './client';
import { inferLotSizes } from './lot-sizes';
import { migrateDb } from './migrate';
import { createProduct } from './mutations';
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
  priceJpy: price,
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
  expect(await inferLotSizes(db)).toEqual({ checked: 6, updated: 2 });
  const price = new Map(
    (await db.select().from(priceObservations)).map((r) => [r.externalRef, r.priceJpy]),
  );
  expect(price.get('c')).toBe(10_400);
  expect(price.get('e')).toBe(10_150);
  expect(price.get('g')).toBe(50_000);
  expect(await inferLotSizes(db)).toEqual({ checked: 6, updated: 0 });
});
