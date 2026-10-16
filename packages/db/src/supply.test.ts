import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, it } from 'vitest';
import { type Db, createDb } from './client';
import { migrateDb } from './migrate';
import { createProduct, deleteUnusedProduct, mergeProducts } from './mutations';
import { supply as supplyTable } from './schema';
import { type SupplyRow, currentSupply, saveSupply } from './supply';
import { createUser } from './users';

let db: Db;
let uid: string;

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-supply-'));
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  const creds = { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] };
  uid = (await createUser(db, 'a', creds, 'admin')).user.id;
  return () => rm(dir, { recursive: true, force: true });
});

const card = (name: string) =>
  createProduct(db, uid, {
    category: 'tcg',
    kind: 'single',
    name,
    franchise: 'pokemon',
    region: 'jp',
  });

const row = (productId: string, day: string, ask: number): SupplyRow => ({
  productId,
  source: 'snkrdunk',
  bucket: 'raw:A',
  day,
  lowestAskBase: ask,
  lowestAskOriginal: ask,
  currency: 'JPY',
  fxRate: null,
  listings: 3,
  fetchedAt: `${day}T05:00:00.000+09:00`,
});

it('moves what was for sale to the item a duplicate is merged into, and deletes it with the item', async () => {
  const keep = await card('ピカチュウ');
  const dup = await card('ピカチュウ ');
  await saveSupply(db, [row(keep.id, '2026-10-10', 1000), row(dup.id, '2026-10-10', 900)]);
  await saveSupply(db, [row(dup.id, '2026-10-11', 950)]);
  await mergeProducts(db, { id: uid, role: 'admin' }, dup.id, keep.id);
  // The target's own report of a day wins; the other day moves over.
  const rows = await db.select().from(supplyTable);
  expect(rows.map((r) => [r.productId, r.day, r.lowestAskBase]).sort()).toEqual([
    [keep.id, '2026-10-10', 1000],
    [keep.id, '2026-10-11', 950],
  ]);
  const now = (await currentSupply(db, [keep.id], new Date('2026-10-11T03:00:00Z'))).get(keep.id);
  expect(now?.map((r) => r.lowestAskBase)).toEqual([950]);
  expect(await deleteUnusedProduct(db, keep.id)).toBe(true);
  expect(await db.select().from(supplyTable)).toEqual([]);
});
