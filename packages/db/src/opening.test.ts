import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, it } from 'vitest';
import { type Db, createDb } from './client';
import { migrateDb } from './migrate';
import { createProduct } from './mutations';
import {
  markOpeningRead,
  openingCardsOf,
  openingRates,
  openingSetsDue,
  saveCardSales,
  saveOpeningCards,
  saveOpeningRates,
  trackedBoxes,
} from './opening';
import { tcgSets } from './schema';
import { createUser } from './users';
import { addWatch } from './watches';

let db: Db;
let uid: string;
let other: string;

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-opening-'));
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  const creds = { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] };
  uid = (await createUser(db, 'a', creds)).user.id;
  other = (await createUser(db, 'b', creds)).user.id;
  return () => rm(dir, { recursive: true, force: true });
});

async function set(name: string, code: string) {
  const [row] = await db
    .insert(tcgSets)
    .values({
      franchise: 'pokemon',
      region: 'jp',
      code,
      name,
      setType: 'expansion',
      source: 't',
      sourceKey: name,
    })
    .returning();
  return row!;
}

const box = (setId: string) =>
  createProduct(db, uid, {
    category: 'tcg',
    kind: 'booster_box',
    name: 'box',
    franchise: 'pokemon',
    region: 'jp',
    setId,
  });

const card = (externalId: string, ask: number) => ({
  externalId,
  name: externalId,
  number: null,
  rarity: 'SAR',
  currency: 'JPY',
  ask,
  url: null,
});

it("uses the admin's rates, else the suggested ones, else none", async () => {
  const s151 = await set('ポケモンカード151(イチゴーイチ)', 'SV2A');
  const other = await set('どこにもないセット', 'X1');
  let rates = await openingRates(db, [s151.id, other.id]);
  expect(rates.get(s151.id)).toMatchObject({
    saved: false,
    rates: { code: 'SV2a', packsPerBox: 20 },
  });
  expect(rates.has(other.id)).toBe(false);
  await saveOpeningRates(
    db,
    other.id,
    { code: 'X1', packsPerBox: 30, tiers: [{ rarity: 'SAR', perBox: 0.2 }], source: null },
    uid,
  );
  rates = await openingRates(db, [other.id]);
  expect(rates.get(other.id)).toMatchObject({
    saved: true,
    rates: { tiers: [{ rarity: 'SAR', perBox: 0.2 }] },
  });
});

it('reads cards once a week, and again when the code or rarities change', async () => {
  const s = await set('ポケモンカード151', 'SV2A');
  await box(s.id);
  const now = new Date('2026-10-19T12:00:00+09:00');
  const [due] = await openingSetsDue(db, now);
  expect(due!.set.id).toBe(s.id);
  await markOpeningRead(db, due!, now);
  expect(await openingSetsDue(db, new Date('2026-10-25T12:00:00+09:00'))).toEqual([]);
  expect(await openingSetsDue(db, new Date('2026-10-26T12:00:00+09:00'))).toHaveLength(1);
  await saveOpeningRates(
    db,
    s.id,
    { ...due!.rates, tiers: [{ rarity: 'MUR', perBox: 0.02 }] },
    uid,
  );
  expect(await openingSetsDue(db, now)).toHaveLength(1);
});

it('keeps the cards just read, drops the ones gone, and reads sales again', async () => {
  const s = await set('X', 'X1');
  await saveOpeningCards(db, s.id, 'snkrdunk', [card('a', 1000), card('b', 2000)]);
  const a = (await openingCardsOf(db, [s.id])).get(s.id)!.find((c) => c.externalId === 'a')!;
  await saveCardSales(db, a.id, 1500, 4);
  await saveOpeningCards(db, s.id, 'snkrdunk', [card('a', 1100)]);
  const rows = (await openingCardsOf(db, [s.id])).get(s.id)!;
  expect(rows.map((r) => [r.externalId, r.ask, r.sold])).toEqual([['a', 1100, null]]);
});

it("lists a person's boxes held or watched, not others'", async () => {
  const s = await set('X', 'X1');
  const p = await box(s.id);
  expect(await trackedBoxes(db, uid)).toEqual([]);
  await addWatch(db, uid, { productId: p.id }, {});
  expect((await trackedBoxes(db, uid)).map((b) => b.id)).toEqual([p.id]);
  expect(await trackedBoxes(db, other)).toEqual([]);
});
