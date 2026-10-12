import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, it } from 'vitest';
import { type Db, createDb } from './client';
import { foreignPrices } from './fx';
import { migrateDb } from './migrate';
import { createHolding } from './mutations';
import {
  createQuerySource,
  insertObservations,
  linkSource,
  missingPriceSources,
  pendingMatchesForUser,
  saveCandidates,
} from './sources';
import { createUser } from './users';
import { loadMarketData } from './valuation';

let db: Db;
let userId: string;
const now = new Date('2026-10-12T03:00:00Z');

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-coverage-'));
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  userId = (
    await createUser(db, 'a', { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] })
  ).user.id;
  return () => rm(dir, { recursive: true, force: true });
});

const lot = (cost: number) => ({
  quantity: 1,
  costTotalJpy: cost,
  acquiredAt: '2026-10-01T12:00:00.000+09:00',
});

it('lists cards without SNKRDUNK and items over ¥3,000 without 駿河屋', async () => {
  const card = await createHolding(
    db,
    userId,
    { product: { category: 'tcg', kind: 'single', name: 'ピカチュウ' } },
    { ...lot(500), grading: 'raw', rawGrade: 'A' },
  );
  const cheap = await createHolding(
    db,
    userId,
    { product: { category: 'game', kind: 'software', name: '逆転検事2' } },
    { ...lot(2000), condition: 'like_new' },
  );
  // A box goes by SNKRDUNK too, whatever it cost.
  await createHolding(
    db,
    userId,
    { product: { category: 'tcg', kind: 'booster_box', name: '30th BOX' } },
    { ...lot(20000), packagingState: 'sealed_shrink' },
  );
  const game = await createHolding(
    db,
    userId,
    { product: { category: 'game', kind: 'software', name: 'ASTRAL CHAIN' } },
    { ...lot(5000), condition: 'like_new' },
  );
  // Every item has a Mercari search: it does not count, nor hide a 駿河屋 suggestion.
  await createQuerySource(db, game.product.id, 'mercari', { keywords: ['ASTRAL CHAIN'] });
  await saveCandidates(db, game.product.id, 'surugaya', [
    { externalId: '109000490', title: 'ASTRAL CHAIN [通常版]', score: 0.9 },
  ]);

  const missing = await missingPriceSources(db, userId);
  expect(missing.map((m) => [m.product.name, m.source, m.suggestions])).toEqual([
    ['30th BOX', 'snkrdunk', 0],
    ['ASTRAL CHAIN', 'surugaya', 1],
    ['ピカチュウ', 'snkrdunk', 0],
  ]);
  expect(missing.map((m) => m.product.id)).not.toContain(cheap.product.id);
  expect((await pendingMatchesForUser(db, userId)).map((r) => r.product.name)).toEqual([
    'ASTRAL CHAIN',
  ]);

  await linkSource(db, game.product.id, { source: 'surugaya', externalId: '109000490' });
  await linkSource(db, card.product.id, { source: 'snkrdunk', externalId: '1' });
  expect((await missingPriceSources(db, userId)).map((m) => m.product.name)).toEqual(['30th BOX']);
  expect(await pendingMatchesForUser(db, userId)).toEqual([]);
});

it('keeps foreign prices out of the valuation data and shows the newest per listing', async () => {
  const { product } = await createHolding(
    db,
    userId,
    { product: { category: 'tcg', kind: 'single', name: 'ピカチュウ' } },
    { ...lot(500), grading: 'raw', rawGrade: 'A' },
  );
  const usd = (day: string, cents: number) => ({
    productId: product.id,
    source: 'tcgcsv',
    observationType: 'listing' as const,
    bucket: null,
    priceJpy: Math.round(cents * 1.5),
    priceOriginal: cents,
    currency: 'USD',
    fxRate: 150,
    observedAt: `${day}T05:00:00.000+09:00`,
    fetchedAt: `${day}T05:00:00.000+09:00`,
    externalRef: `11|Holofoil|${day}`,
    url: 'https://www.tcgplayer.com/product/11',
    raw: { subType: 'Holofoil', fxDate: day },
  });
  await insertObservations(db, [usd('2026-10-10', 2000), usd('2026-10-11', 2350)]);
  const market = await loadMarketData(db, userId, [product.id], now);
  expect(market.observations.get(product.id) ?? []).toEqual([]);
  expect(await foreignPrices(db, product.id, now)).toEqual([
    expect.objectContaining({ price: 23.5, currency: 'USD', priceJpy: 3525, variant: 'Holofoil' }),
  ]);
});
