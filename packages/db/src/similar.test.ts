import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, it } from 'vitest';
import { type Db, createDb } from './client';
import { migrateDb } from './migrate';
import { addPull, createHolding, createProduct, mergeProducts } from './mutations';
import { collectorRuns, holdings, productSources, products } from './schema';
import { cardNumberKey, suggestFromKnownProducts } from './similar';
import { linkSource, listPendingCandidates, rejectCandidate, startRun } from './sources';
import { createUser } from './users';

let db: Db;
let uid: string;
const at = '2026-09-01T12:00:00.000+09:00';

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-similar-'));
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  uid = (await createUser(db, 'a', { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] }))
    .user.id;
  return () => rm(dir, { recursive: true, force: true });
});

const single = (name: string, extra: Record<string, unknown> = {}) =>
  createProduct(db, uid, {
    category: 'tcg',
    kind: 'single',
    name,
    franchise: 'pokemon',
    region: 'jp',
    ...extra,
  });

it('normalizes card numbers', () => {
  expect(cardNumberKey('019/23')).toBe(cardNumberKey(' 19 / 23 '));
  expect(cardNumberKey('０１９/２３')).toBe('19/23');
  expect(cardNumberKey(null)).toBeNull();
});

it('a pulled card typed like an existing card reuses it', async () => {
  const bought = await single('インフルエンサーの紹介', { setCode: 'MP1', cardNumber: '019/23' });
  const deck = await createHolding(
    db,
    uid,
    {
      product: {
        category: 'tcg',
        kind: 'deck',
        name: 'スタートデッキ100',
        franchise: 'pokemon',
        region: 'jp',
      },
    },
    { quantity: 1, costTotalJpy: 1000, acquiredAt: at, packagingState: 'sealed_shrink' },
  );
  const pull = await addPull(
    db,
    uid,
    deck.holding.id,
    { card: { name: 'インフルエンサーの紹介', cardNumber: '19/23' } },
    { quantity: 1, rawGrade: 'A', acquiredAt: at },
  );
  expect(pull.product.id).toBe(bought.id);
  // Another number is another card.
  const other = await addPull(
    db,
    uid,
    deck.holding.id,
    { card: { name: 'インフルエンサーの紹介', cardNumber: '020/23' } },
    { quantity: 1, rawGrade: 'A', acquiredAt: at },
  );
  expect(other.product.id).not.toBe(bought.id);
});

it('suggests the listing of a linked look-alike; a dismissed one stays dismissed', async () => {
  const linked = await single('インフルエンサーの紹介', { setCode: 'MP1', cardNumber: '019/23' });
  await linkSource(
    db,
    linked.id,
    { source: 'snkrdunk', externalId: '777', title: 'インフルエンサーの紹介 [MP1 019/23](…)' },
    'https://cdn.example/777.webp',
  );
  // Same number and set code, name typed differently: still the same card.
  const typed = await single('インフルエンサー の紹介 ', { setCode: 'MP1', cardNumber: '19/23' });
  expect(await suggestFromKnownProducts(db, typed.id)).toBe(1);
  const [c] = await listPendingCandidates(db, typed.id);
  expect(c).toMatchObject({ externalId: '777', imageUrl: 'https://cdn.example/777.webp' });
  await rejectCandidate(db, c!.id);
  expect(await suggestFromKnownProducts(db, typed.id)).toBe(0);
  // Different number, or already linked: nothing.
  const otherCard = await single('インフルエンサーの紹介', {
    setCode: 'MP1',
    cardNumber: '020/23',
  });
  expect(await suggestFromKnownProducts(db, otherCard.id)).toBe(0);
  expect(await suggestFromKnownProducts(db, linked.id)).toBe(0);
});

it('suggests sealed look-alikes by name', async () => {
  const box = { category: 'tcg' as const, kind: 'booster_box' as const, franchise: 'pokemon' };
  const a = await createProduct(db, uid, { ...box, name: '拡張パック「テスト」ボックス' });
  await linkSource(db, a.id, { source: 'snkrdunk', externalId: '1' });
  const b = await createProduct(db, uid, { ...box, name: '拡張パック「テスト」 ボックス' });
  expect(await suggestFromKnownProducts(db, b.id)).toBe(1);
});

it('closes runs that never finished', async () => {
  await db.insert(collectorRuns).values({
    source: 'snkrdunk',
    startedAt: '2026-01-01T00:00:00.000+09:00',
    status: 'running',
  });
  await startRun(db, 'snkrdunk');
  const runs = await db.select().from(collectorRuns).orderBy(collectorRuns.startedAt);
  expect(runs.map((r) => r.status)).toEqual(['failed', 'running']);
  expect(runs[0]!.error).toContain('interrupted');
});

it('merges a duplicate into an existing product', async () => {
  const user = { id: uid, role: 'member' as const };
  const real = await single('インフルエンサーの紹介', { setCode: 'MP1', cardNumber: '019/23' });
  const dup = await single('インフルエンサーの紹介', { cardNumber: '19/23' });
  await linkSource(db, real.id, { source: 'snkrdunk', externalId: '777' });
  await linkSource(db, dup.id, { source: 'snkrdunk', externalId: '777' });
  await linkSource(db, dup.id, { source: 'mercari', externalId: 'm1' });
  const lot = {
    quantity: 1,
    costTotalJpy: 500,
    acquiredAt: at,
    grading: 'raw' as const,
    rawGrade: 'A' as const,
  };
  await createHolding(db, uid, { productId: real.id }, lot);
  await createHolding(db, uid, { productId: dup.id }, lot);

  await mergeProducts(db, user, dup.id, real.id);
  const lots = await db.select().from(holdings);
  expect(lots.every((h) => h.productId === real.id)).toBe(true);
  const listings = await db.select().from(productSources);
  expect(
    listings.map((l) => `${l.productId === real.id}:${l.source}:${l.externalId}`).sort(),
  ).toEqual(['true:mercari:m1', 'true:snkrdunk:777']);
  expect((await db.select().from(products)).map((p) => p.id)).toEqual([real.id]);

  // Different kinds cannot be merged.
  const box = await createProduct(db, uid, { category: 'tcg', kind: 'booster_box', name: 'Box' });
  await expect(mergeProducts(db, user, box.id, real.id)).rejects.toThrow('invalid_input');
});
