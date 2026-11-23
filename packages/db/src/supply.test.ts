import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, it } from 'vitest';
import { type Db, createDb } from './client';
import { migrateDb } from './migrate';
import { createProduct, deleteUnusedProduct, mergeProducts } from './mutations';
import { supply as supplyTable } from './schema';
import { chooseAsk } from './ask-check';
import {
  type SupplyRow,
  currentSupply,
  listingsIn,
  lowestAsk,
  saveSupply,
  supplyOffers,
} from './supply';
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

it("reads a row's stored listings, unknown fields as unknown; none stored reads null", () => {
  const offer = {
    ref: 'm1',
    title: 'Hero Quest',
    url: 'https://flea.example/m1',
    priceBase: 1000,
    priceOriginal: 1000,
    currency: 'JPY',
    seller: null,
    category: '111',
    shipping: 'buyer',
    shippingPayerId: 'p1',
  };
  expect(supplyOffers({ offers: null })).toBeNull();
  expect(supplyOffers({ offers: 'x' })).toBeNull();
  expect(supplyOffers({ offers: [] })).toEqual([]);
  expect(
    supplyOffers({
      offers: [
        offer,
        {
          ...offer,
          ref: 'm2',
          shipping: 'free',
          seller: 7,
          category: undefined,
          url: 3,
          shippingPayerId: 2,
        },
        { ...offer, ref: '' },
        { ...offer, priceBase: null },
        { ...offer, priceOriginal: 'NaN' },
        { ...offer, currency: undefined },
        null,
        'm3',
      ],
    }),
  ).toEqual([
    offer,
    {
      ...offer,
      ref: 'm2',
      shipping: 'unknown',
      seller: null,
      category: null,
      url: null,
      shippingPayerId: null,
    },
  ]);
});

it('stores listings and the cap when given, and null in their place otherwise', async () => {
  const g = await card('Hero Quest');
  const offer = {
    ref: 'm1',
    title: 'Hero Quest',
    url: null,
    priceBase: 1000,
    priceOriginal: 1000,
    currency: 'JPY',
    seller: null,
    category: null,
    shipping: 'unknown' as const,
    shippingPayerId: null,
  };
  await saveSupply(db, [
    { ...row(g.id, '2026-10-10', 1000), offers: [offer], listingsCapped: true },
  ]);
  let [r] = await db.select().from(supplyTable);
  expect([supplyOffers(r!), r!.listingsCapped]).toEqual([[offer], 1]);
  await saveSupply(db, [{ ...row(g.id, '2026-10-10', 1000), listingsCapped: false }]);
  [r] = await db.select().from(supplyTable);
  expect([r!.offers, r!.listingsCapped]).toEqual([null, 0]);
  await saveSupply(db, [row(g.id, '2026-10-10', 1000)]);
  [r] = await db.select().from(supplyTable);
  expect([r!.offers, r!.listingsCapped]).toEqual([null, null]);
});

it("a condition where nothing passed tonight reads as today's report: no ask, 0 listings", async () => {
  const g = await card('Hero Quest');
  await saveSupply(db, [row(g.id, '2026-10-10', 1000)]);
  await saveSupply(db, [
    {
      ...row(g.id, '2026-10-11', 0),
      lowestAskBase: null,
      lowestAskOriginal: null,
      listings: 0,
      offers: [],
    },
  ]);
  const rows = (await currentSupply(db, [g.id], new Date('2026-10-11T03:00:00Z'))).get(g.id)!;
  expect(rows.map((r) => [r.day, r.lowestAskBase, r.listings])).toEqual([['2026-10-11', null, 0]]);
  expect([lowestAsk(rows, 'raw:A'), listingsIn(rows, 'raw:A'), supplyOffers(rows[0]!)]).toEqual([
    null,
    0,
    [],
  ]);
  for (const status of ['checked', 'unverified'] as const)
    expect(chooseAsk(rows, 'raw:A', () => status)).toEqual({ ask: null, unverified: null });
});
