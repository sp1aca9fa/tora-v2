import {
  type Db,
  createDb,
  createHolding,
  createProduct,
  createUser,
  insertObservations,
  linkSource,
  schema,
} from '@tora/db';
import { migrateDb } from '@tora/db/migrate';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, it } from 'vitest';
import { dataChecks, portfolioSummary, querySql, sales } from './tools';

let db: Db;
let uid: string;
const now = new Date('2026-10-11T03:00:00Z');
const ago = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-mcp-'));
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  uid = (await createUser(db, 'a', { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] }))
    .user.id;
  return () => rm(dir, { recursive: true, force: true });
});

const card = (name: string, cardNumber: string) => ({
  product: {
    category: 'tcg' as const,
    kind: 'single' as const,
    name,
    cardNumber,
    franchise: 'pokemon',
  },
});
const lot = (extra: Record<string, unknown> = {}) => ({
  quantity: 1,
  costTotalBase: 1000,
  acquiredAt: ago(30),
  grading: 'raw' as const,
  rawGrade: 'A' as const,
  ...extra,
});

it('summarizes, lists sales (kept ones behind newer left-out ones) and runs checks', async () => {
  const a = await createHolding(db, uid, card('ピカチュウ', '020'), lot());
  await createHolding(db, uid, card('ピカチュウ ', '20'), lot());
  await createHolding(db, uid, card('ミュウ', '151'), lot({ rawGrade: null, grading: null }));
  const sale = (ref: string, price: number, d: number, excluded = false) => ({
    productId: a.product.id,
    source: 'mercari',
    observationType: 'sold' as const,
    bucket: 'raw:A',
    priceBase: price,
    currency: 'JPY',
    observedAt: ago(d),
    fetchedAt: ago(0),
    externalRef: ref,
    excluded,
    excludedReason: excluded ? ('mismatch' as const) : null,
    raw: { name: `t${ref}`, filter: excluded ? 'bundle' : undefined },
  });
  await insertObservations(db, [
    sale('k1', 2000, 20),
    sale('k2', 2100, 21),
    sale('k3', 2200, 22),
    ...Array.from({ length: 60 }, (_, i) => sale(`x${i}`, 9000, 1, true)),
  ]);

  const kept = await sales(db, a.product.id, { status: 'kept' });
  expect(kept.map((s) => s.priceBase)).toEqual([2000, 2100, 2200]);
  const left = await sales(db, a.product.id, { status: 'excluded', limit: 2 });
  expect(left[0]).toMatchObject({ kept: false, why: 'bundle' });

  const summary = await portfolioSummary(db, uid);
  expect(summary.totals).toMatchObject({ spentBase: 3000, total: 3 });

  const checks = Object.fromEntries((await dataChecks(db, uid, now)).map((c) => [c.check, c]));
  // The two ピカチュウ 020 / 20 are look-alikes; ミュウ has no grade, so no value.
  expect(checks.look_alikes?.count).toBe(1);
  expect(checks.unvalued?.items).toEqual(
    expect.arrayContaining([expect.objectContaining({ name: 'ミュウ' })]),
  );
  expect(checks.missing_details?.count).toBeGreaterThan(0);
});

it('runs read-only SQL only', async () => {
  expect(await querySql(db, 'select count(*) as n from users')).toMatchObject({ rows: [{ n: 1 }] });
  expect(await querySql(db, 'delete from users')).toHaveProperty('error');
  expect(await querySql(db, 'select 1; delete from users')).toHaveProperty('error');
  expect(await querySql(db, 'with x as (select 1) delete from users')).toHaveProperty('error');
  expect((await db.select().from(schema.users)).length).toBe(1);
});

it('finds a twin nobody holds, and a listing linked to two items', async () => {
  const held = await createHolding(db, uid, card('ブラッキーVMAX', '095'), lot());
  const twin = await createProduct(db, uid, card('ブラッキーVMAX', '095').product);
  await linkSource(db, twin.id, { source: 'snkrdunk', externalId: '93021' });
  await linkSource(db, held.product.id, { source: 'snkrdunk', externalId: '93021' });
  // Search links are per item, never shared.
  await linkSource(db, twin.id, { source: 'mercari', externalId: 'search' });
  await linkSource(db, held.product.id, { source: 'mercari', externalId: 'search' });
  const checks = Object.fromEntries((await dataChecks(db, uid, now)).map((c) => [c.check, c]));
  expect(checks.look_alikes?.count).toBe(1);
  expect(checks.shared_listings?.items).toEqual([
    expect.objectContaining({ source: 'snkrdunk', listing: '93021' }),
  ]);
});
