import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, it } from 'vitest';
import { accountData } from './account-data';
import { type Db, createDb } from './client';
import { migrateDb } from './migrate';
import { DomainError, createProduct, deleteUnusedProduct, mergeProducts } from './mutations';
import { productsToMatch, productsWithoutSource } from './sources';
import { createUser } from './users';
import { heldBuckets } from './valuation';
import { addWatch, listWatches, removeWatch, updateWatch, watchesOf } from './watches';

let db: Db;
let uid: string;
let other: string;

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-watches-'));
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  const creds = { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] };
  uid = (await createUser(db, 'a', creds)).user.id;
  other = (await createUser(db, 'b', creds)).user.id;
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

it('watches an item in a condition, and again only updates the target', async () => {
  const { watch, product } = await addWatch(
    db,
    uid,
    {
      product: {
        category: 'tcg',
        kind: 'single',
        name: 'ピカチュウ',
        franchise: 'pokemon',
        region: 'jp',
      },
    },
    { grading: 'graded', grader: 'PSA', grade: '10', targetPriceBase: 20_000, note: ' gift ' },
  );
  expect(watch).toMatchObject({ bucket: 'graded:PSA:10', targetPriceBase: 20_000, note: 'gift' });
  const again = await addWatch(
    db,
    uid,
    { productId: product.id },
    { grading: 'graded', grader: 'PSA', grade: '10.0', targetPriceBase: 18_000 },
  );
  expect(again.watch.id).toBe(watch.id);
  expect(again.watch.targetPriceBase).toBe(18_000);
  await addWatch(db, uid, { productId: product.id }, { grading: 'raw', rawGrade: 'A' });
  expect((await watchesOf(db, uid, product.id)).map((w) => w.bucket)).toEqual([
    'graded:PSA:10',
    'raw:A',
  ]);
  // Another person's watch list is their own.
  expect(await listWatches(db, other)).toEqual([]);
  await expect(
    addWatch(
      db,
      uid,
      { productId: product.id },
      { grading: 'raw', rawGrade: 'A', targetPriceBase: 0 },
    ),
  ).rejects.toThrow(DomainError);
});

it('refuses a change to a condition already watched, and removes only its owner’s watch', async () => {
  const product = await card('ミュウ');
  const { watch } = await addWatch(
    db,
    uid,
    { productId: product.id },
    { grading: 'raw', rawGrade: 'A' },
  );
  await addWatch(db, uid, { productId: product.id }, { grading: 'raw', rawGrade: 'B' });
  await expect(
    updateWatch(db, uid, watch.id, { grading: 'raw', rawGrade: 'B' }),
  ).rejects.toMatchObject({ code: 'duplicate_watch' });
  expect(
    await updateWatch(db, uid, watch.id, { grading: 'raw', rawGrade: 'S', targetPriceBase: 5_000 }),
  ).toMatchObject({ bucket: 'raw:S', targetPriceBase: 5_000 });
  await expect(updateWatch(db, other, watch.id, {})).rejects.toMatchObject({ code: 'not_found' });
  expect(await removeWatch(db, other, watch.id)).toBe(false);
  expect(await removeWatch(db, uid, watch.id)).toBe(true);
});

it('has watched items matched and collected in their condition', async () => {
  const product = await card('リザードン');
  expect(await productsToMatch(db, 'snkrdunk')).toEqual([]);
  await addWatch(
    db,
    other,
    { productId: product.id },
    { grading: 'graded', grader: 'PSA', grade: '10' },
  );
  expect((await productsToMatch(db, 'snkrdunk')).map((p) => p.id)).toEqual([product.id]);
  expect((await productsWithoutSource(db, 'mercari')).map((p) => p.id)).toEqual([product.id]);
  expect(await heldBuckets(db, product.id)).toEqual(['graded:PSA:10']);
});

it('keeps watches through a merge, and a watched item is never deleted as unused', async () => {
  const keep = await card('イーブイ');
  const dup = await card('イーブイ ');
  await addWatch(db, uid, { productId: keep.id }, { grading: 'raw', rawGrade: 'A' });
  await addWatch(db, uid, { productId: dup.id }, { grading: 'raw', rawGrade: 'A' });
  await addWatch(db, other, { productId: dup.id }, { grading: 'raw', rawGrade: 'A' });
  expect(await deleteUnusedProduct(db, dup.id)).toBe(false);
  await mergeProducts(db, { id: uid, role: 'admin' }, dup.id, keep.id);
  expect(await watchesOf(db, uid, keep.id)).toHaveLength(1);
  expect(await watchesOf(db, other, keep.id)).toHaveLength(1);
  const data = await accountData(db, other);
  expect(data.watches).toHaveLength(1);
  expect(data.items.map((i) => i.id)).toEqual([keep.id]);
});
