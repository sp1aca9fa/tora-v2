import { mkdtemp, rm } from 'node:fs/promises';
import { saveSourceInfos } from './registry';
import { TEST_SOURCES } from './testing';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, it } from 'vitest';
import { actionTotal, pendingActions } from './actions';
import { type Db, createDb } from './client';
import { type ForeignPrice, foreignEstimates, foreignPrices } from './fx';
import { migrateDb } from './migrate';
import { createHolding } from './mutations';
import {
  createQuerySource,
  insertObservations,
  linkSource,
  missingPriceSources,
  pendingMatchesForUser,
  saveCandidates,
  setSourceWarningDismissed,
} from './sources';
import { createUser, getUserById, setNoticeLevels } from './users';
import { loadMarketData } from './valuation';

let db: Db;
let userId: string;
const now = new Date('2026-10-12T03:00:00Z');

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-coverage-'));
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  await saveSourceInfos(db, TEST_SOURCES);
  userId = (
    await createUser(db, 'a', { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] })
  ).user.id;
  return () => rm(dir, { recursive: true, force: true });
});

const lot = (cost: number) => ({
  quantity: 1,
  costTotalBase: cost,
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

  // Turned off for one item, then on again.
  await setSourceWarningDismissed(db, userId, card.product.id, true);
  expect((await missingPriceSources(db, userId)).map((m) => m.product.name)).not.toContain(
    'ピカチュウ',
  );
  await setSourceWarningDismissed(db, userId, card.product.id, false);
  expect((await missingPriceSources(db, userId)).map((m) => m.product.name)).toContain(
    'ピカチュウ',
  );

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
    priceBase: Math.round(cents * 1.5),
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
    expect.objectContaining({
      market: 'us',
      price: 23.5,
      currency: 'USD',
      priceBase: 3525,
      variant: 'Holofoil',
    }),
  ]);
});

it('lists actions as cards by level: main sources and grades red, games and second sources blue', async () => {
  const card = await createHolding(
    db,
    userId,
    { product: { category: 'tcg', kind: 'single', name: 'ピカチュウ' } },
    lot(500),
  );
  await saveCandidates(db, card.product.id, 'snkrdunk', [
    { externalId: '1', title: 'ピカチュウ', score: 0.9 },
    { externalId: '2', title: 'ピカチュウ (another)', score: 0.95 },
  ]);
  const linked = await createHolding(
    db,
    userId,
    { product: { category: 'tcg', kind: 'single', name: 'ミュウ' } },
    { ...lot(800), grading: 'raw', rawGrade: 'A' },
  );
  await linkSource(db, linked.product.id, { source: 'snkrdunk', externalId: '3' });
  await saveCandidates(db, linked.product.id, 'tcgcsv', [
    { externalId: '4', title: 'Mew', score: 0.7 },
  ]);
  const game = await createHolding(
    db,
    userId,
    { product: { category: 'game', kind: 'software', name: 'ASTRAL CHAIN' } },
    lot(5000),
  );
  await setSourceWarningDismissed(db, userId, game.product.id, true);
  // A TCG supply follows the item rule: asked for when not cheap, at the item level.
  await createHolding(
    db,
    userId,
    { product: { category: 'tcg', kind: 'supply', name: 'デッキシールド' } },
    lot(4445),
  );

  const items = await pendingActions(db, userId);
  expect(
    items.map((i) => [i.level, i.type, 'product' in i && i.product ? i.product.name : '']),
  ).toEqual([
    ['red', 'tcg_main_source', 'ピカチュウ'],
    ['red', 'card_grade', 'ピカチュウ'],
    ['blue', 'game_main_source', 'デッキシールド'],
    ['blue', 'second_source', 'ミュウ'],
    // Dismissed: no 駿河屋 card for the game, its condition still asked.
    ['blue', 'game_condition', 'ASTRAL CHAIN'],
  ]);
  const first = items[0]!;
  expect(first.kind === 'source' && first.candidates.map((c) => c.score)).toEqual([0.95, 0.9]);
  expect(actionTotal(items)).toBe(5);
});

it("follows the user's notice levels; quiet ones are listed but not counted", async () => {
  await createHolding(
    db,
    userId,
    { product: { category: 'tcg', kind: 'single', name: 'ピカチュウ' } },
    { ...lot(500), grading: 'raw', rawGrade: 'A' },
  );
  await createHolding(
    db,
    userId,
    { product: { category: 'game', kind: 'software', name: 'ASTRAL CHAIN' } },
    lot(1000),
  );
  await setNoticeLevels(db, userId, { game_condition: 'red', tcg_main_source: 'grey' });
  const user = await getUserById(db, userId);
  // Only the differences from the defaults are kept.
  expect(user?.noticeLevels).toEqual({ game_condition: 'red', tcg_main_source: 'grey' });
  const items = await pendingActions(db, userId, user?.noticeLevels);
  expect(items.map((i) => [i.level, i.type])).toEqual([
    ['red', 'game_condition'],
    ['grey', 'tcg_main_source'],
  ]);
  expect(actionTotal(items)).toBe(1);
  await setNoticeLevels(db, userId, null);
  expect((await getUserById(db, userId))?.noticeLevels).toBeNull();
});

it('keeps one foreign price per source in the compared condition, the middle one', () => {
  const row = (source: string, priceBase: number, bucket: string | null = null): ForeignPrice => ({
    source,
    market: 'us',
    title: null,
    url: null,
    price: priceBase / 150,
    currency: 'USD',
    priceBase,
    fxRate: 150,
    fxDate: null,
    observedAt: '2026-10-01',
    variant: null,
    bucket,
    count: null,
  });
  const rows = [
    row('tcgcsv', 3000),
    row('tcgcsv', 1000),
    row('tcgcsv', 2000),
    row('ebay', 9000, 'graded:PSA:10'),
    row('ebay', 1500),
  ];
  const out = foreignEstimates(rows, { bucket: 'raw:A', plain: true });
  expect(out.map((f) => [f.source, f.priceBase, f.of])).toEqual([
    ['tcgcsv', 2000, 3],
    ['ebay', 1500, 1],
  ]);
  // A condition plain prices do not count in: only that condition's prices.
  const graded = foreignEstimates(rows, { bucket: 'graded:PSA:10', plain: false });
  expect(graded.map((f) => [f.source, f.priceBase])).toEqual([['ebay', 9000]]);
});
