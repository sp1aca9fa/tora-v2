import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localDate, toLocalIso } from '@tora/core';
import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { type Db, createDb } from './client';
import { saveConsole } from './consoles';
import { currentRules, getItemRules, recordItemCheck, saveItemRules } from './item-rules';
import { migrateDb } from './migrate';
import { createProduct } from './mutations';
import {
  itemChecks,
  itemRuleState,
  itemRules,
  notItemMarks,
  priceObservations,
  productSources,
  products,
  saleCoverage,
  watches,
} from './schema';
import { setGameRules } from './rule-marks';
import { createQuerySource, productsWithoutSource } from './sources';
import { type SupplyOffer, saveSupply } from './supply';
import { createUser } from './users';
import { addWatch } from './watches';
import {
  confirmWish,
  markWishListing,
  markWishSale,
  registrationCheck,
  releaseWish,
  rulesApplied,
  saveWishRules,
  saveWishSearch,
  turnOnWishRules,
  unmarkWishSale,
  wordsOf,
} from './wish-check';
import {
  BULK_MAX,
  addBulk,
  addGameWish,
  awaitsRead,
  gameLookAlikes,
  nextWishToCheck,
  ownWish,
  parseBulk,
  previewBulk,
  wishForAction,
  wishOffers,
  wishSales,
  wishState,
  wishStates,
} from './wishes';

let db: Db;
let admin: { id: string; role: 'admin' };
let ann: { id: string; role: 'member' };
let bob: { id: string; role: 'member' };

// Made-up consoles (public test).
const alpha = {
  key: 'alpha',
  names: { en: 'Alpha Station' },
  aliases: ['ALPHA ST'],
  categories: {},
  boxedAllowed: true,
};
const beta = {
  key: 'beta',
  names: { en: 'Beta Box' },
  aliases: [],
  categories: {},
  boxedAllowed: false,
};

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-wishes-'));
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  const creds = { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] };
  admin = { id: (await createUser(db, 'a', creds, 'admin')).user.id, role: 'admin' };
  ann = { id: (await createUser(db, 'ann', creds, 'member')).user.id, role: 'member' };
  bob = { id: (await createUser(db, 'bob', creds, 'member')).user.id, role: 'member' };
  await saveConsole(db, alpha);
  await saveConsole(db, beta);
  return () => rm(dir, { recursive: true, force: true });
});

let n = 0;
const sale = (productId: string, title: string, priceBase: number, over = {}) => ({
  productId,
  source: 'market',
  observationType: 'sold' as const,
  priceBase,
  priceOriginal: priceBase,
  currency: 'JPY',
  title,
  observedAt: toLocalIso(new Date(Date.now() - 86_400_000)),
  fetchedAt: toLocalIso(),
  externalRef: `r${++n}`,
  ...over,
});

const offer = (ref: string, title: string, priceBase: number): SupplyOffer => ({
  ref,
  title,
  url: null,
  priceBase,
  priceOriginal: priceBase,
  currency: 'JPY',
  seller: null,
  category: null,
  shipping: 'unknown',
  shippingPayerId: null,
});

const listings = (productId: string, offers: SupplyOffer[]) =>
  saveSupply(db, [
    {
      productId,
      source: 'market',
      bucket: '',
      day: localDate(),
      lowestAskBase: offers[0]?.priceBase ?? null,
      lowestAskOriginal: null,
      currency: 'JPY',
      fxRate: null,
      listings: offers.length,
      fetchedAt: toLocalIso(),
      offers,
    },
  ]);

/** A read night of the item at the market, recorded after any rule change made so far. */
const readNow = (productId: string) =>
  db
    .insert(saleCoverage)
    .values({
      productId,
      source: 'market',
      nights: [[localDate(), localDate()]],
      updatedAt: toLocalIso(new Date(Date.now() + 1000)),
    })
    .onConflictDoUpdate({
      target: [saleCoverage.productId, saleCoverage.source],
      set: { updatedAt: toLocalIso(new Date(Date.now() + 2000)) },
    });

describe('wishState', () => {
  it('reads check needed for a game until its sales are confirmed and while held', () => {
    expect(wishState({ game: false, salesConfirmed: false, held: true })).toBe('not_game');
    expect(wishState({ game: true, salesConfirmed: false, held: false })).toBe('check_needed');
    expect(wishState({ game: true, salesConfirmed: true, held: true })).toBe('check_needed');
    expect(wishState({ game: true, salesConfirmed: true, held: false })).toBe('confirmed');
  });

  it('a card wish is never check needed; a game wish is until confirmed under today rules', async () => {
    const { watch: w, product: g } = await addGameWish(db, ann.id, {
      name: 'Star Rover',
      console: 'Alpha Station',
      watch: {},
    });
    const { product: card } = await addWatch(
      db,
      ann.id,
      {
        product: {
          category: 'tcg',
          kind: 'single',
          name: 'Blue Dragon',
          franchise: 'pokemon',
          region: 'jp',
        },
      },
      {},
    );
    let states = await wishStates(db, [g, card]);
    expect([states.get(g.id)!.state, states.get(card.id)!.state]).toEqual([
      'check_needed',
      'not_game',
    ]);
    const hash = (await currentRules(db, g.id))!.hashFor('sales', '');
    await confirmWish(db, ann, { wishId: w.id, kind: 'sales', hash });
    states = await wishStates(db, [g]);
    expect(states.get(g.id)!.state).toBe('confirmed');
    // A rule change (by another person who wishes it) brings the check back for everyone.
    const { watch: wb } = await addWatch(db, bob.id, { productId: g.id }, {});
    await saveWishRules(db, bob, { wishId: wb.id, required: 'limited', excluded: '', edition: '' });
    expect((await wishStates(db, [g])).get(g.id)!.state).toBe('check_needed');
    expect((await getItemRules(db, g.id))!.required).toEqual(['limited']);
  });

  it('a held item reads check needed though confirmed', async () => {
    const { watch: w, product: g } = await addGameWish(db, ann.id, {
      name: 'Star Rover',
      console: 'alpha',
      watch: {},
    });
    const hash = (await currentRules(db, g.id))!.hashFor('sales', '');
    await confirmWish(db, ann, { wishId: w.id, kind: 'sales', hash });
    await db.insert(itemRuleState).values({
      productId: g.id,
      held: { would: 12, kept: 20, at: toLocalIso(), hash },
    });
    expect((await wishStates(db, [g])).get(g.id)!.state).toBe('check_needed');
    expect(await releaseWish(db, ann, w.id)).toBe(true);
    expect((await wishStates(db, [g])).get(g.id)!.state).toBe('confirmed');
  });
});

describe('access', () => {
  it('only the owner or an admin acts on a wish; the check page is the owner only', async () => {
    const { watch: w } = await addGameWish(db, ann.id, {
      name: 'Star Rover',
      console: 'alpha',
      watch: {},
    });
    expect((await ownWish(db, ann.id, w.id))?.watch.id).toBe(w.id);
    expect(await ownWish(db, bob.id, w.id)).toBeNull();
    expect(await ownWish(db, admin.id, w.id)).toBeNull();
    await expect(wishForAction(db, bob, w.id)).rejects.toThrow('not_found');
    expect((await wishForAction(db, admin, w.id)).watch.id).toBe(w.id);
    const hash = 'x';
    for (const act of [
      () => confirmWish(db, bob, { wishId: w.id, kind: 'sales', hash }),
      () => saveWishRules(db, bob, { wishId: w.id, required: 'a', excluded: '', edition: '' }),
      () => markWishSale(db, bob, { wishId: w.id, saleId: 'x' }),
      () => markWishListing(db, bob, { wishId: w.id, source: 'market', ref: 'x' }),
      () => releaseWish(db, bob, w.id),
      () => turnOnWishRules(db, bob, w.id),
    ])
      await expect(act()).rejects.toThrow('not_found');
    expect(await db.select().from(itemChecks)).toEqual([]);
  });

  it('refuses a game action on a card wish', async () => {
    const { watch: w } = await addWatch(
      db,
      ann.id,
      {
        product: {
          category: 'tcg',
          kind: 'single',
          name: 'Blue Dragon',
          franchise: 'pokemon',
          region: 'jp',
        },
      },
      {},
    );
    await expect(confirmWish(db, ann, { wishId: w.id, kind: 'sales', hash: 'x' })).rejects.toThrow(
      'forbidden',
    );
  });
});

describe('confirming', () => {
  it('refuses a person after a failed labeled check under the same rules; an admin may', async () => {
    const { watch: w, product: g } = await addGameWish(db, ann.id, {
      name: 'Star Rover',
      console: 'alpha',
      watch: {},
    });
    const hash = (await currentRules(db, g.id))!.hashFor('sales', '');
    await recordItemCheck(db, {
      productId: g.id,
      kind: 'sales',
      source: '',
      outcome: 'failed',
      by: 'check',
      rulesHash: hash,
    });
    const page = await registrationCheck(db, { watch: w, product: g });
    expect(page.salesFailureStands).toBe(true);
    await expect(confirmWish(db, ann, { wishId: w.id, kind: 'sales', hash })).rejects.toThrow(
      'forbidden',
    );
    // A stale hash (the rules changed since the page was read) is refused too.
    await expect(
      confirmWish(db, admin, { wishId: w.id, kind: 'sales', hash: 'old' }),
    ).rejects.toThrow('invalid_input');
    await confirmWish(db, admin, { wishId: w.id, kind: 'sales', hash });
    expect((await wishStates(db, [g])).get(g.id)!.state).toBe('confirmed');
    // After words change the failure is under other rules: the person may confirm, after the read.
    await saveWishRules(db, ann, { wishId: w.id, required: 'rover', excluded: '', edition: '' });
    const next = (await currentRules(db, g.id))!.hashFor('sales', '');
    await readNow(g.id);
    await confirmWish(db, ann, { wishId: w.id, kind: 'sales', hash: next });
    expect((await wishStates(db, [g])).get(g.id)!.state).toBe('confirmed');
  });
});

describe('adding', () => {
  it('adds a game with its rules row, region Japan by default, and refuses an unknown console', async () => {
    const { product: g, watch: w } = await addGameWish(db, ann.id, {
      name: ' Star Rover ',
      console: 'ALPHA ST',
      edition: 'Deluxe',
      watch: {},
    });
    expect([g.name, g.platform, g.region, g.kind, w.bucket]).toEqual([
      'Star Rover',
      'Alpha Station',
      'jp',
      'software',
      'cond:good',
    ]);
    // A game wish with no condition is in no noticeable damage (fix round 1, item 0).
    expect(w.condition).toBe('no_noticeable_damage');
    expect(await getItemRules(db, g.id)).toMatchObject({
      console: 'alpha',
      edition: 'Deluxe',
      required: [],
      excluded: [],
      boxed: false,
    });
    await expect(
      addGameWish(db, ann.id, { name: 'X', console: 'Gamma', watch: {} }),
    ).rejects.toThrow('invalid_input');
    await expect(
      addGameWish(db, ann.id, { name: 'X', console: 'beta', boxed: true, watch: {} }),
    ).rejects.toThrow('invalid_input');
    expect((await db.select().from(products)).length).toBe(1);
  });

  it('a boxed wish is a boxed item of its own, reused, with no marketplace search', async () => {
    const one = await addGameWish(db, ann.id, {
      name: 'Star Rover',
      console: 'alpha',
      boxed: true,
      watch: {},
    });
    expect(one.product.id).not.toBe(one.plain.id);
    expect(await getItemRules(db, one.product.id)).toMatchObject({
      boxed: true,
      boxedOf: one.plain.id,
    });
    const two = await addGameWish(db, bob.id, {
      name: 'Star Rover',
      console: 'alpha',
      boxed: true,
      reuse: one.plain.id,
      watch: {},
    });
    expect(two.product.id).toBe(one.product.id);
    expect((await db.select().from(products)).length).toBe(2);
    // Only the plain item gets a marketplace search set up, though only the boxed one is wished.
    const ids = (await productsWithoutSource(db, 'market')).map((p) => p.id);
    expect(ids).toEqual([one.plain.id]);
    // A boxed item is never reused as a plain item.
    await expect(
      addGameWish(db, ann.id, { name: 'X', console: 'alpha', reuse: one.product.id, watch: {} }),
    ).rejects.toThrow('invalid_input');
  });
});

describe('boxed accessor', () => {
  it("reads the plain item's rows whose title names a box; a sale is stored once", async () => {
    const {
      product: boxed,
      plain,
      watch: w,
    } = await addGameWish(db, ann.id, {
      name: 'Star Rover',
      console: 'alpha',
      boxed: true,
      watch: {},
    });
    await db
      .insert(priceObservations)
      .values([
        sale(plain.id, 'Star Rover 箱付', 3000),
        sale(plain.id, 'Star Rover loose', 1000),
        sale(plain.id, 'Star Rover 箱付 説明書なし', 2000),
      ]);
    expect((await wishSales(db, boxed.id)).map((s) => s.title)).toEqual(['Star Rover 箱付']);
    expect((await wishSales(db, plain.id)).length).toBe(3);
    expect(
      (await db.select().from(priceObservations).where(eq(priceObservations.productId, boxed.id)))
        .length,
    ).toBe(0);
    await listings(plain.id, [
      offer('a', 'Star Rover 箱付', 2500),
      offer('b', 'Star Rover', 900),
      offer('c', 'Star Rover complete in box', 2800),
    ]);
    let rows = await wishOffers(db, boxed.id);
    expect(rows[0]!.offers.map((o) => o.ref)).toEqual(['a', 'c']);
    // A mark on the boxed wish moves the plain item's listing out for it.
    expect(await markWishListing(db, ann, { wishId: w.id, source: 'market', ref: 'c' })).toBe(true);
    rows = await wishOffers(db, boxed.id);
    expect([rows[0]!.offers.map((o) => o.ref), rows[0]!.marked.map((o) => o.ref)]).toEqual([
      ['a'],
      ['c'],
    ]);
    expect((await wishOffers(db, plain.id))[0]!.offers.length).toBe(3);
    // A sale marked "not the item" on the boxed wish is a mark on the boxed item: dropped for it,
    // its stored row (the plain item's) untouched, and still the plain item's sale.
    const [boxedSale] = await wishSales(db, boxed.id);
    await markWishSale(db, ann, { wishId: w.id, saleId: boxedSale!.id });
    expect(await wishSales(db, boxed.id)).toEqual([]);
    expect(
      (await wishSales(db, boxed.id, { withExcluded: true })).map((s) => s.excludedReason),
    ).toEqual(['manual']);
    const [stored] = await db
      .select()
      .from(priceObservations)
      .where(eq(priceObservations.id, boxedSale!.id));
    expect([stored!.excluded, stored!.excludedReason]).toEqual([false, null]);
    expect((await wishSales(db, plain.id)).length).toBe(3);
    // Another item's sale id is refused.
    const other = await createProduct(db, admin.id, {
      category: 'game',
      kind: 'software',
      name: 'Z',
    });
    const [z] = await db
      .insert(priceObservations)
      .values(sale(other.id, 'Z', 10))
      .returning();
    await expect(markWishSale(db, ann, { wishId: w.id, saleId: z!.id })).rejects.toThrow(
      'not_found',
    );
  });
});

describe('a sale whose title is only in its raw row', () => {
  it('reads the raw name as the title: a boxed wish keeps it and the check page names it', async () => {
    const {
      product: boxed,
      plain,
      watch: w,
    } = await addGameWish(db, ann.id, {
      name: 'Star Rover',
      console: 'alpha',
      boxed: true,
      watch: {},
    });
    const rows = await db
      .insert(priceObservations)
      .values([
        sale(plain.id, '', 3000, { title: null, raw: { name: 'Star Rover 箱付' } }),
        sale(plain.id, '', 1000, { title: null, raw: { name: 'Star Rover loose' } }),
        // The column wins when both are there.
        sale(plain.id, 'Star Rover 完品', 2500, { raw: { name: 'other words' } }),
        // No title anywhere, a name that is not a text, a raw row that is not an object.
        sale(plain.id, '', 2000, { title: null, raw: null }),
        sale(plain.id, '', 2100, { title: null, raw: { name: 7 } }),
        sale(plain.id, '', 2200, { title: null, raw: ['Star Rover 箱付'] }),
      ])
      .returning();
    // A raw value that is not JSON at all (an old row) reads with no title, never an error.
    await db.run(
      sql`UPDATE price_observations SET raw = 'not json 箱付' WHERE id = ${rows[3]!.id}`,
    );
    const titles = (await wishSales(db, plain.id)).map((s) => s.title);
    expect(titles.toSorted((a, b) => String(a).localeCompare(String(b)))).toEqual(
      ['Star Rover 箱付', 'Star Rover loose', 'Star Rover 完品', null, null, null].toSorted(
        (a, b) => String(a).localeCompare(String(b)),
      ),
    );
    expect((await wishSales(db, boxed.id)).map((s) => s.title).toSorted()).toEqual([
      'Star Rover 完品',
      'Star Rover 箱付',
    ]);
    const check = await registrationCheck(db, (await ownWish(db, ann.id, w.id))!);
    expect(check.sales[0]!.sample.map((s) => s.title).toSorted()).toEqual([
      'Star Rover 完品',
      'Star Rover 箱付',
    ]);
    // The stored rows are untouched: the title column stays empty.
    const [stored] = await db
      .select({ title: priceObservations.title })
      .from(priceObservations)
      .where(eq(priceObservations.id, rows[0]!.id));
    expect(stored!.title).toBeNull();
  });
});

describe('the search words', () => {
  const searchOf = async (productId: string) =>
    (
      await db
        .select({ query: productSources.query })
        .from(productSources)
        .where(eq(productSources.productId, productId))
    )[0]!.query!;

  it('shows each search as stored and what the rules add when it is sent', async () => {
    await saveConsole(db, {
      ...alpha,
      key: 'gamma',
      names: { en: 'Gamma' },
      categories: { market: '77' },
    });
    const { product: g, watch: w } = await addGameWish(db, ann.id, {
      name: 'Star Rover',
      console: 'gamma',
      watch: {},
    });
    const page = () => ownWish(db, ann.id, w.id).then((wish) => registrationCheck(db, wish!));
    // No search before the first collect made one.
    expect((await page()).searches).toEqual([]);
    await createQuerySource(db, g.id, 'market', {
      keywords: ['Star Rover'],
      extra: { auto: true },
    });
    await saveWishRules(db, ann, {
      wishId: w.id,
      required: 'limited\nrover',
      excluded: 'bad',
      edition: '',
    });
    // The switch off: the search goes as stored.
    expect((await page()).searches).toEqual([
      { source: 'market', words: 'Star Rover', added: [], inCategory: false },
    ]);
    await setGameRules(db, true);
    // On: the required word the stored words lack, inside the console's category; never the
    // excluded words (S36 A1).
    expect((await page()).searches).toEqual([
      { source: 'market', words: 'Star Rover', added: ['limited'], inCategory: true },
    ]);
  });

  it('saves other words: the rows and the confirmations go, and confirming waits for a read', async () => {
    const {
      product: boxed,
      plain,
      watch: wb,
    } = await addGameWish(db, bob.id, {
      name: 'Star Rover',
      console: 'alpha',
      boxed: true,
      watch: {},
    });
    // The plain item the boxed one reads is the item ann wishes.
    const { product: g, watch: w } = await addGameWish(db, ann.id, {
      name: 'Star Rover',
      console: 'alpha',
      reuse: plain.id,
      watch: {},
    });
    expect(g.id).toBe(plain.id);
    await createQuerySource(db, g.id, 'market', {
      keywords: ['Star Rover'],
      excludeKeywords: ['poster'],
      priceMin: 100,
      extra: { auto: true, v: 2, references: ['https://example.test/1'] },
    });
    const [kept, byHand] = await db
      .insert(priceObservations)
      .values([
        sale(g.id, 'Star Rover 箱付', 3000),
        sale(g.id, 'Star Rover poster', 500, { excluded: true, excludedReason: 'manual' }),
      ])
      .returning();
    await listings(g.id, [offer('a', 'Star Rover', 2500)]);
    await readNow(g.id);
    const hashOf = async (id: string, kind: 'sales' | 'listings', source: string) =>
      (await currentRules(db, id))!.hashFor(kind, source);
    await confirmWish(db, ann, {
      wishId: w.id,
      kind: 'sales',
      hash: await hashOf(g.id, 'sales', ''),
    });
    await confirmWish(db, ann, {
      wishId: w.id,
      kind: 'listings',
      source: 'market',
      hash: await hashOf(g.id, 'listings', 'market'),
    });
    await confirmWish(db, bob, {
      wishId: wb.id,
      kind: 'sales',
      hash: await hashOf(boxed.id, 'sales', ''),
    });
    const states = async () => {
      const got = await wishStates(db, [g, boxed]);
      return [got.get(g.id)!.state, got.get(boxed.id)!.state];
    };
    expect(await states()).toEqual(['confirmed', 'confirmed']);

    // Who may: the wish's owner or an admin; a boxed wish has no search of its own; the words.
    await expect(
      saveWishSearch(db, bob, { wishId: w.id, source: 'market', words: 'x' }),
    ).rejects.toThrow('not_found');
    await expect(
      saveWishSearch(db, bob, { wishId: wb.id, source: 'market', words: 'x' }),
    ).rejects.toThrow('forbidden');
    await expect(
      saveWishSearch(db, ann, { wishId: w.id, source: 'other', words: 'x' }),
    ).rejects.toThrow('not_found');
    for (const words of ['', '   ', 'x'.repeat(201)])
      await expect(
        saveWishSearch(db, ann, { wishId: w.id, source: 'market', words }),
      ).rejects.toThrow('invalid_input');
    // The stored words again (spaces and width aside): nothing happens.
    expect(
      await saveWishSearch(db, ann, { wishId: w.id, source: 'market', words: ' Ｓtar  Rover ' }),
    ).toBe(false);
    expect(await states()).toEqual(['confirmed', 'confirmed']);
    expect((await wishSales(db, g.id)).length).toBe(1);
    expect((await searchOf(g.id)).extra).toEqual({
      auto: true,
      v: 2,
      references: ['https://example.test/1'],
    });

    // Other words: saved as typed, the rest of the search kept, marked edited.
    expect(
      await saveWishSearch(db, ann, { wishId: w.id, source: 'market', words: 'スターローバー' }),
    ).toBe(true);
    const saved = await searchOf(g.id);
    expect([saved.keywords, saved.excludeKeywords, saved.priceMin]).toEqual([
      ['スターローバー'],
      ['poster'],
      100,
    ]);
    expect(saved.extra).toMatchObject({
      auto: false,
      edited: true,
      v: 2,
      references: ['https://example.test/1'],
    });
    expect(typeof saved.extra!.editedAt).toBe('string');
    // The rows read under the old words are gone; the sale a person excluded by hand stays.
    const left = await db
      .select()
      .from(priceObservations)
      .where(eq(priceObservations.productId, g.id));
    expect(left.map((r) => r.id)).toEqual([byHand!.id]);
    expect(left.some((r) => r.id === kept!.id)).toBe(false);
    // Nothing confirmed any more, for the item and for the boxed item reading its rows.
    expect(await states()).toEqual(['check_needed', 'check_needed']);
    const rows = await db
      .select()
      .from(itemChecks)
      .orderBy(sql`rowid`);
    expect(
      rows.slice(-3).map((r) => [r.productId, r.kind, r.source, r.outcome, r.by, r.note]),
    ).toEqual([
      [g.id, 'sales', '', 'failed', 'person', 'search edited'],
      [g.id, 'listings', 'market', 'failed', 'person', 'search edited'],
      [boxed.id, 'sales', '', 'failed', 'person', 'search edited'],
    ]);
    // Until Tora reads the item again nobody confirms, the admin included: the stored listings on
    // the page were read under the old words.
    expect(await awaitsRead(db, g.id)).toBe(true);
    expect(await awaitsRead(db, boxed.id)).toBe(true);
    await expect(
      confirmWish(db, admin, {
        wishId: w.id,
        kind: 'listings',
        source: 'market',
        hash: await hashOf(g.id, 'listings', 'market'),
      }),
    ).rejects.toThrow('invalid_input');
    await new Promise((r) => setTimeout(r, 5));
    await readNow(g.id);
    expect(await awaitsRead(db, g.id)).toBe(false);
    // A person's own row never blocks: after the read the person confirms again.
    await db.insert(priceObservations).values(sale(g.id, 'スターローバー', 2800));
    await confirmWish(db, ann, {
      wishId: w.id,
      kind: 'sales',
      hash: await hashOf(g.id, 'sales', ''),
    });
    expect((await states())[0]).toBe('confirmed');
    // Saving again with nothing confirmed at that source writes no row for it.
    const before = (await db.select().from(itemChecks)).length;
    expect(
      await saveWishSearch(db, admin, {
        wishId: w.id,
        source: 'market',
        words: 'スターローバー 64',
      }),
    ).toBe(true);
    const after = await db
      .select()
      .from(itemChecks)
      .orderBy(sql`rowid`);
    expect(after.length).toBe(before + 1);
    expect([after.at(-1)!.kind, after.at(-1)!.by]).toEqual(['sales', 'admin']);
  });
});

describe('the check', () => {
  it('before the first read says so; after, shows kept samples and dropped with reasons', async () => {
    const { product: g, watch: w } = await addGameWish(db, ann.id, {
      name: 'Star Rover',
      console: 'alpha',
      watch: {},
    });
    let page = await registrationCheck(db, { watch: w, product: g });
    expect([page.firstRead, page.sales, page.listings]).toEqual([false, [], []]);
    const rows = Array.from({ length: 30 }, (_, i) =>
      sale(g.id, `Star Rover #${i}`, 1000 + i * 10),
    );
    await db.insert(priceObservations).values([
      ...rows,
      sale(g.id, 'Star Rover guide book', 500, { excluded: true, excludedReason: 'manual' }),
      sale(g.id, 'Star Rover lot', 99, {
        excluded: true,
        excludedReason: 'mismatch',
        ruleMark: 'rules:abc',
      }),
    ]);
    await listings(g.id, [offer('a', 'Star Rover', 1200), offer('b', 'Star Rover guide', 400)]);
    await db.insert(notItemMarks).values({
      productId: g.id,
      source: 'market',
      externalRef: 'b',
      userId: ann.id,
      at: toLocalIso(),
    });
    page = await registrationCheck(db, { watch: w, product: g });
    expect(page.firstRead).toBe(true);
    const [s] = page.sales;
    expect([s!.kept, s!.dropped]).toEqual([30, 2]);
    expect(s!.sample.length).toBeLessThanOrEqual(40);
    expect(s!.sample[0]!.sets).toContain('cheap');
    expect(s!.droppedSample.map((d) => d.reason).sort()).toEqual(['manual', 'rules']);
    expect(page.listings[0]).toMatchObject({ kept: 1, confirmed: false });
    expect(page.listings[0]!.dropped.map((d) => [d.ref, d.reason])).toEqual([['b', 'not_item']]);
    // Words not applied yet: the kept sales they would drop are shown as such, by title.
    await saveWishRules(db, ann, {
      wishId: w.id,
      required: '',
      excluded: '#1',
      edition: '',
    });
    page = await registrationCheck(db, { watch: w, product: g });
    expect(page.applied).toBe(false);
    expect(page.sales[0]!.droppedSample.filter((d) => d.reason === 'would').length).toBe(11);
    expect(page.listings[0]!.confirmed).toBe(false);
    expect(page.awaitsRead).toBe(true);
    await readNow(g.id);
    await confirmWish(db, ann, {
      wishId: w.id,
      kind: 'listings',
      source: 'market',
      hash: page.listings[0]!.hash,
    });
    page = await registrationCheck(db, { watch: w, product: g });
    expect(page.listings[0]!.confirmed).toBe(true);
  });

  it('a game of another kind shows what the rules would drop before they are turned on', async () => {
    const { product: g, watch: w } = await addWatch(
      db,
      ann.id,
      {
        product: {
          category: 'game',
          kind: 'collectors_edition',
          name: 'Alpha Pad',
          platform: 'Alpha Station',
        },
      },
      {},
    );
    expect((await wishStates(db, [g])).get(g.id)!.state).toBe('not_game');
    await db
      .insert(priceObservations)
      .values([sale(g.id, 'Alpha Pad', 3000), sale(g.id, 'Alpha Pad broken', 100)]);
    await saveItemRules(
      db,
      g.id,
      {
        console: 'alpha',
        edition: null,
        required: [],
        excluded: ['broken'],
        boxed: false,
        boxedOf: null,
        gameRules: null,
      },
      admin.id,
    );
    const page = await registrationCheck(db, { watch: w, product: g });
    expect([page.kindOff, page.wouldDrop]).toEqual([true, 1]);
    await turnOnWishRules(db, ann, w.id);
    expect((await wishStates(db, [g])).get(g.id)!.state).toBe('check_needed');
    await expect(turnOnWishRules(db, ann, w.id)).rejects.toThrow('invalid_input');
  });

  it('reads the rules as applied only when every judged source has their hash', async () => {
    const { product: g } = await addGameWish(db, ann.id, {
      name: 'Star Rover',
      console: 'alpha',
      watch: {},
    });
    const { rules } = (await currentRules(db, g.id))!;
    const { rulesHash } = await import('@tora/core');
    expect(rulesApplied(null, rules)).toBe(false);
    expect(rulesApplied(`market=${rulesHash(rules, 'market')}`, rules)).toBe(true);
    expect(rulesApplied(`market=${rulesHash(rules, 'market')} shop=old`, rules)).toBe(false);
  });
});

describe('boxed wishes and their plain item', () => {
  it("a boxed wish's check comes back when the plain item's rules change", async () => {
    const {
      product: boxed,
      plain,
      watch: w,
    } = await addGameWish(db, ann.id, {
      name: 'Star Rover',
      console: 'alpha',
      boxed: true,
      watch: {},
    });
    await readNow(plain.id);
    const hash = (await currentRules(db, boxed.id))!.hashFor('sales', '');
    await confirmWish(db, ann, { wishId: w.id, kind: 'sales', hash });
    expect((await wishStates(db, [boxed])).get(boxed.id)!.state).toBe('confirmed');
    // A plain wisher changes the plain item's words: the boxed wish's rows changed with them.
    const { watch: wb } = await addWatch(db, bob.id, { productId: plain.id }, {});
    await saveWishRules(db, bob, { wishId: wb.id, required: 'rover', excluded: '', edition: '' });
    expect((await wishStates(db, [boxed])).get(boxed.id)!.state).toBe('check_needed');
    expect((await currentRules(db, boxed.id))!.hashFor('sales', '')).not.toBe(hash);
    // The same hash from one item's read and from the batched read.
    const many = (await wishStates(db, [boxed])).get(boxed.id)!.confirmations;
    expect(many.hashFor('sales', '')).toBe(
      (await currentRules(db, boxed.id))!.hashFor('sales', ''),
    );
  });

  it('a held plain item holds its boxed wish too: the list and the check page agree', async () => {
    const {
      product: boxed,
      plain,
      watch: w,
    } = await addGameWish(db, ann.id, {
      name: 'Star Rover',
      console: 'alpha',
      boxed: true,
      watch: {},
    });
    await readNow(plain.id);
    const hash = (await currentRules(db, boxed.id))!.hashFor('sales', '');
    await confirmWish(db, ann, { wishId: w.id, kind: 'sales', hash });
    await db.insert(itemRuleState).values({
      productId: plain.id,
      held: { would: 12, kept: 20, at: toLocalIso(), hash },
    });
    const state = (await wishStates(db, [boxed])).get(boxed.id)!;
    const page = await registrationCheck(db, { watch: w, product: boxed });
    expect([state.state, !!state.held, !!page.held]).toEqual(['check_needed', true, true]);
    expect(await releaseWish(db, ann, w.id)).toBe(true);
    expect((await wishStates(db, [boxed])).get(boxed.id)!.state).toBe('confirmed');
  });

  it('adding one game finds the item already in Tora; a boxed wish hangs on it', async () => {
    const old = await createProduct(db, admin.id, {
      category: 'game',
      kind: 'software',
      name: 'Star Rover',
      platform: 'Alpha Station',
    });
    await db
      .insert(priceObservations)
      .values([sale(old.id, 'Star Rover 箱付', 3000), sale(old.id, 'Star Rover loose', 1000)]);
    const found = await gameLookAlikes(db, ann.id, ' star rover ', 'ALPHA ST');
    expect(found.map((a) => a.id)).toEqual([old.id]);
    expect(await gameLookAlikes(db, ann.id, 'Star Rover', 'beta')).toEqual([]);
    expect(await gameLookAlikes(db, ann.id, 'Star Rover', 'Gamma')).toEqual([]);
    const { product: boxed, plain } = await addGameWish(db, ann.id, {
      name: 'Star Rover',
      console: 'alpha',
      boxed: true,
      reuse: old.id,
      watch: {},
    });
    expect(plain.id).toBe(old.id);
    const games = await db.select().from(products);
    expect(games.filter((p) => !p.id || p.id !== boxed.id).map((p) => p.id)).toEqual([old.id]);
    expect((await wishSales(db, boxed.id)).map((s) => s.title)).toEqual(['Star Rover 箱付']);
    // The boxed item is never offered as a look-alike.
    expect((await gameLookAlikes(db, ann.id, 'Star Rover', 'alpha')).map((a) => a.id)).toEqual([
      old.id,
    ]);
  });

  it("a plain wisher's mark on a sale stays the hand exclusion of the stored row", async () => {
    const { product: g, watch: w } = await addGameWish(db, ann.id, {
      name: 'Star Rover',
      console: 'alpha',
      watch: {},
    });
    const [row] = await db
      .insert(priceObservations)
      .values(sale(g.id, 'Star Rover', 900))
      .returning();
    await markWishSale(db, ann, { wishId: w.id, saleId: row!.id });
    const [stored] = await db
      .select()
      .from(priceObservations)
      .where(eq(priceObservations.id, row!.id));
    expect([stored!.excluded, stored!.excludedReason]).toEqual([true, 'manual']);
    expect(await db.select().from(notItemMarks)).toEqual([]);
  });
});

describe('fix round 2', () => {
  it('a boxed wish reuses only a plain item that is a game by its rules', async () => {
    const old = await createProduct(db, admin.id, {
      category: 'game',
      kind: 'software',
      name: 'Star Rover',
      platform: 'Alpha Station',
    });
    await saveItemRules(
      db,
      old.id,
      {
        console: 'alpha',
        edition: null,
        required: [],
        excluded: [],
        boxed: false,
        boxedOf: null,
        gameRules: 0,
      },
      admin.id,
    );
    expect(
      (await gameLookAlikes(db, ann.id, 'Star Rover', 'alpha', { boxed: true })).map((a) => a.id),
    ).toEqual([]);
    expect((await gameLookAlikes(db, ann.id, 'Star Rover', 'alpha')).map((a) => a.id)).toEqual([
      old.id,
    ]);
    await expect(
      addGameWish(db, ann.id, {
        name: 'Star Rover',
        console: 'alpha',
        boxed: true,
        reuse: old.id,
        watch: {},
      }),
    ).rejects.toThrow('invalid_input');
    expect((await db.select().from(products)).map((p) => p.id)).toEqual([old.id]);
    // A plain wish on it is still allowed (it keeps what the Watchlist does).
    const plain = await addGameWish(db, ann.id, {
      name: 'Star Rover',
      console: 'alpha',
      reuse: old.id,
      watch: {},
    });
    expect(plain.product.id).toBe(old.id);
  });

  it('adding a game already wished keeps its target and note unless new ones are typed', async () => {
    const first = await addGameWish(db, ann.id, {
      name: 'Star Rover',
      console: 'alpha',
      watch: { targetPriceBase: 5000, note: 'mint only' },
    });
    const again = await addGameWish(db, ann.id, {
      name: 'Star Rover',
      console: 'alpha',
      reuse: first.product.id,
      watch: { targetPriceBase: null },
    });
    expect(again.watch.id).toBe(first.watch.id);
    expect([again.watch.targetPriceBase, again.watch.note]).toEqual([5000, 'mint only']);
    const typed = await addGameWish(db, ann.id, {
      name: 'Star Rover',
      console: 'alpha',
      reuse: first.product.id,
      watch: { targetPriceBase: 4000 },
    });
    expect([typed.watch.targetPriceBase, typed.watch.note]).toEqual([4000, 'mint only']);
    // The bulk paste too.
    const done = await addBulk(db, ann.id, 'Star Rover | alpha', { 1: first.product.id });
    expect(done[0]).toMatchObject({ ok: true, wishId: first.watch.id });
    const [kept] = await db.select().from(watches).where(eq(watches.id, first.watch.id));
    expect([kept!.targetPriceBase, kept!.note]).toEqual([4000, 'mint only']);
    // The usual add flow still clears a target left empty.
    const { watch: cleared } = await addWatch(
      db,
      ann.id,
      { productId: first.product.id },
      { condition: 'no_noticeable_damage', targetPriceBase: null },
    );
    expect([cleared.id, cleared.targetPriceBase, cleared.note]).toEqual([
      first.watch.id,
      null,
      null,
    ]);
  });

  it('a game wish has a condition: the default, the one given, an old empty one taken over', async () => {
    const given = await addGameWish(db, ann.id, {
      name: 'Moon Rover',
      console: 'alpha',
      watch: { condition: 'like_new' },
    });
    expect([given.watch.condition, given.watch.bucket]).toEqual(['like_new', 'cond:like_new']);
    // A wish stored before the default (empty bucket) becomes the cond:good wish when the game is
    // added again: one wish, its target and note kept (fix round 1, item 0).
    const { watch: old } = await addWatch(
      db,
      ann.id,
      { productId: given.product.id },
      { targetPriceBase: 3000, note: 'any copy' },
    );
    expect(old.bucket).toBe('');
    const again = await addGameWish(db, ann.id, {
      name: 'Moon Rover',
      console: 'alpha',
      reuse: given.product.id,
      watch: {},
    });
    expect(again.watch.id).toBe(old.id);
    expect([again.watch.bucket, again.watch.targetPriceBase, again.watch.note]).toEqual([
      'cond:good',
      3000,
      'any copy',
    ]);
    const mine = await db.select().from(watches).where(eq(watches.userId, ann.id));
    expect(mine.map((w) => w.bucket).toSorted()).toEqual(['cond:good', 'cond:like_new']);
    // With a cond:good wish there already, an empty one is left as it is.
    const { watch: empty } = await addWatch(db, ann.id, { productId: given.product.id }, {});
    await addGameWish(db, ann.id, {
      name: 'Moon Rover',
      console: 'alpha',
      reuse: given.product.id,
      watch: {},
    });
    const [left] = await db.select().from(watches).where(eq(watches.id, empty.id));
    expect(left!.bucket).toBe('');
    // Bob's empty wish on the item is not touched by Ann's add.
    const { watch: bobs } = await addWatch(db, bob.id, { productId: given.product.id }, {});
    await addGameWish(db, ann.id, {
      name: 'Moon Rover',
      console: 'alpha',
      reuse: given.product.id,
      watch: {},
    });
    const [kept] = await db.select().from(watches).where(eq(watches.id, bobs.id));
    expect(kept!.bucket).toBe('');
  });

  it("undoes a plain wish's hand exclusion on the check page", async () => {
    const { product: g, watch: w } = await addGameWish(db, ann.id, {
      name: 'Star Rover',
      console: 'alpha',
      watch: {},
    });
    const [row] = await db
      .insert(priceObservations)
      .values(sale(g.id, 'Star Rover', 900))
      .returning();
    await markWishSale(db, ann, { wishId: w.id, saleId: row!.id });
    const page = await registrationCheck(db, { watch: w, product: g });
    expect(page.sales[0]!.droppedSample.map((s) => [s.id, s.reason])).toEqual([
      [row!.id, 'manual'],
    ]);
    // Another person's wish id is not found; the owner takes it back.
    await expect(unmarkWishSale(db, bob, { wishId: w.id, saleId: row!.id })).rejects.toThrow(
      'not_found',
    );
    expect(await unmarkWishSale(db, ann, { wishId: w.id, saleId: row!.id })).toBe(true);
    const [stored] = await db
      .select()
      .from(priceObservations)
      .where(eq(priceObservations.id, row!.id));
    expect([stored!.excluded, stored!.excludedReason]).toEqual([false, null]);
    // A kept sale is no undo.
    await expect(unmarkWishSale(db, ann, { wishId: w.id, saleId: row!.id })).rejects.toThrow(
      'not_found',
    );
    // A sale a labeled check excluded reads as dropped by hand, but only an admin takes it back.
    await db
      .update(priceObservations)
      .set({ excluded: true, excludedReason: 'manual' })
      .where(eq(priceObservations.id, row!.id));
    await recordItemCheck(db, {
      productId: g.id,
      kind: 'sales',
      source: '',
      outcome: 'failed',
      by: 'check',
      rulesHash: (await currentRules(db, g.id))!.hashFor('sales', ''),
      counts: { excluded: [row!.id] },
    });
    const checked = await registrationCheck(db, { watch: w, product: g });
    expect(checked.sales[0]!.droppedSample.map((s) => [s.id, s.reason, s.byCheck])).toEqual([
      [row!.id, 'manual', true],
    ]);
    await expect(unmarkWishSale(db, ann, { wishId: w.id, saleId: row!.id })).rejects.toThrow(
      'not_found',
    );
    expect(await unmarkWishSale(db, admin, { wishId: w.id, saleId: row!.id })).toBe(true);
    // An admin may too.
    await markWishSale(db, ann, { wishId: w.id, saleId: row!.id });
    expect(await unmarkWishSale(db, admin, { wishId: w.id, saleId: row!.id })).toBe(true);
  });

  it("undoes a boxed wish's mark: its maker or an admin, never another person", async () => {
    const a = await addGameWish(db, ann.id, {
      name: 'Star Rover',
      console: 'alpha',
      boxed: true,
      watch: {},
    });
    const b = await addGameWish(db, bob.id, {
      name: 'Star Rover',
      console: 'alpha',
      boxed: true,
      reuse: a.plain.id,
      watch: {},
    });
    expect(b.product.id).toBe(a.product.id);
    const [row] = await db
      .insert(priceObservations)
      .values(sale(a.plain.id, 'Star Rover 箱付', 3000))
      .returning();
    await markWishSale(db, ann, { wishId: a.watch.id, saleId: row!.id });
    const page = await registrationCheck(db, b);
    expect(page.sales[0]!.droppedSample.map((s) => [s.reason, s.markedBy])).toEqual([
      ['manual', ann.id],
    ]);
    expect(await unmarkWishSale(db, bob, { wishId: b.watch.id, saleId: row!.id })).toBe(false);
    expect(await db.select().from(notItemMarks)).toHaveLength(1);
    expect(await unmarkWishSale(db, ann, { wishId: a.watch.id, saleId: row!.id })).toBe(true);
    expect((await wishSales(db, a.product.id)).map((s) => s.id)).toEqual([row!.id]);
    // An admin takes back another person's mark; the stored row was never touched.
    await markWishSale(db, bob, { wishId: b.watch.id, saleId: row!.id });
    expect(await unmarkWishSale(db, admin, { wishId: a.watch.id, saleId: row!.id })).toBe(true);
    const [stored] = await db
      .select()
      .from(priceObservations)
      .where(eq(priceObservations.id, row!.id));
    expect(stored!.excluded).toBe(false);
  });

  it("reads a boxed wish's rules as applied by its plain item's own platform and region", async () => {
    const {
      product: boxed,
      plain,
      watch: w,
    } = await addGameWish(db, ann.id, {
      name: 'Star Rover',
      console: 'alpha',
      boxed: true,
      watch: {},
    });
    await db.update(products).set({ region: 'us' }).where(eq(products.id, boxed.id));
    const [moved] = await db.select().from(products).where(eq(products.id, boxed.id));
    const { rules: plainRules } = (await currentRules(db, plain.id))!;
    const { rules: boxedRules } = (await currentRules(db, moved!.id))!;
    expect(plainRules.region).not.toBe(boxedRules.region);
    const { rulesHash } = await import('@tora/core');
    await setGameRules(db, true);
    await db.insert(itemRuleState).values({
      productId: plain.id,
      appliedHash: `market=${rulesHash(plainRules, 'market')}`,
    });
    expect((await registrationCheck(db, { watch: w, product: moved! })).applied).toBe(true);
  });
});

describe('confirming waits for a read after a rule change', () => {
  it('refuses a person and an admin until the item is read under the new rules', async () => {
    const { product: g, watch: w } = await addGameWish(db, ann.id, {
      name: 'Star Rover',
      console: 'alpha',
      watch: {},
    });
    // A new game's row is the same as its platform's rules: nothing to wait for.
    expect(await awaitsRead(db, g.id)).toBe(false);
    await saveWishRules(db, ann, { wishId: w.id, required: 'rover', excluded: '', edition: '' });
    expect(await awaitsRead(db, g.id)).toBe(true);
    const hash = (await currentRules(db, g.id))!.hashFor('sales', '');
    for (const who of [ann, admin])
      await expect(confirmWish(db, who, { wishId: w.id, kind: 'sales', hash })).rejects.toThrow(
        'invalid_input',
      );
    expect((await registrationCheck(db, { watch: w, product: g })).awaitsRead).toBe(true);
    // Saving the same words again is no change.
    await readNow(g.id);
    await saveWishRules(db, ann, { wishId: w.id, required: 'rover', excluded: '', edition: '' });
    expect(await awaitsRead(db, g.id)).toBe(false);
    await confirmWish(db, ann, { wishId: w.id, kind: 'sales', hash });
    expect((await wishStates(db, [g])).get(g.id)!.state).toBe('confirmed');
  });

  it("a boxed wish waits for a read of its plain item after either item's rules change", async () => {
    const {
      product: boxed,
      plain,
      watch: w,
    } = await addGameWish(db, ann.id, {
      name: 'Star Rover',
      console: 'alpha',
      boxed: true,
      watch: {},
    });
    await saveWishRules(db, ann, { wishId: w.id, required: '', excluded: 'loose', edition: '' });
    expect(await awaitsRead(db, boxed.id)).toBe(true);
    await readNow(boxed.id);
    expect(await awaitsRead(db, boxed.id)).toBe(true);
    await readNow(plain.id);
    expect(await awaitsRead(db, boxed.id)).toBe(false);
  });
});

describe('the next game to check', () => {
  it("names the person's next game needing its check, never another person's", async () => {
    const a = await addGameWish(db, ann.id, { name: 'Star Rover', console: 'alpha', watch: {} });
    expect(await nextWishToCheck(db, ann.id, a.watch.id)).toBeNull();
    await addGameWish(db, bob.id, { name: 'Moon Diver', console: 'alpha', watch: {} });
    expect(await nextWishToCheck(db, ann.id, a.watch.id)).toBeNull();
    const b = await addGameWish(db, ann.id, { name: 'Sky Racer', console: 'alpha', watch: {} });
    expect(await nextWishToCheck(db, ann.id, a.watch.id)).toEqual({
      wishId: b.watch.id,
      name: 'Sky Racer',
    });
  });
});

describe('bulk add', () => {
  it('previews without writing; reuses a look-alike; an unknown console is a line error', async () => {
    const old = await createProduct(db, admin.id, {
      category: 'game',
      kind: 'software',
      name: 'Moon Diver',
      platform: 'Alpha Station',
    });
    const text = [
      'Moon Diver | alpha',
      'Sky Racer | Beta Box',
      '',
      'Lost Game | Gamma',
      'no console here',
      'Moon Diver | ALPHA ST',
    ].join('\n');
    const before = await db.select().from(products);
    const preview = await previewBulk(db, ann.id, text);
    expect(preview.lines.map((l) => [l.line, l.error, l.console])).toEqual([
      [1, null, 'alpha'],
      [2, null, 'beta'],
      [3, 'console', null],
      [4, 'format', null],
      [5, 'duplicate', 'alpha'],
    ]);
    expect(preview.lines[0]!.lookAlikes.map((a) => a.id)).toEqual([old.id]);
    expect(await db.select().from(products)).toEqual(before);
    expect(await db.select().from(watches)).toEqual([]);
    expect(await db.select().from(itemRules)).toEqual([]);

    const done = await addBulk(db, ann.id, text, { 1: old.id, 2: 'new', 5: 'new' });
    expect(done.map((r) => [r.line, r.ok, r.ok ? r.reused : r.error])).toEqual([
      [1, true, true],
      [2, true, false],
      [3, false, 'console'],
      [4, false, 'format'],
      [5, false, 'duplicate'],
    ]);
    expect((await db.select().from(products)).length).toBe(2);
    expect((await db.select().from(watches)).length).toBe(2);
  });

  it('a line without a valid choice is reported and the others stand', async () => {
    const done = await addBulk(db, ann.id, 'Moon Diver | alpha\nSky Racer | beta', {
      1: 'not-a-look-alike',
      2: 'new',
    });
    expect(done.map((r) => [r.line, r.ok])).toEqual([
      [1, false],
      [2, true],
    ]);
    expect((await db.select().from(watches)).length).toBe(1);
  });

  it('a line failing after its item is written leaves no item or rules row; the others stand', async () => {
    // Forced: the wish of one game fails inside its transaction, after the item and its rules.
    await db.run(
      sql.raw(`CREATE TRIGGER fail_moon BEFORE INSERT ON watches
        WHEN (SELECT name FROM products WHERE id = NEW.product_id) = 'Moon Diver'
        BEGIN SELECT RAISE(ABORT, 'forced'); END`),
    );
    const done = await addBulk(db, ann.id, 'Moon Diver | alpha\nSky Racer | beta', {
      1: 'new',
      2: 'new',
    });
    expect(done.map((r) => [r.line, r.ok])).toEqual([
      [1, false],
      [2, true],
    ]);
    const items = await db.select().from(products);
    expect(items.map((p) => p.name)).toEqual(['Sky Racer']);
    expect((await db.select().from(itemRules)).map((r) => r.productId)).toEqual([items[0]!.id]);
  });

  it(`refuses more than ${BULK_MAX} lines, and parses only what it may`, async () => {
    const many = Array.from({ length: BULK_MAX + 1 }, (_, i) => `Game ${i} | alpha`).join('\n');
    expect(parseBulk(many, [alpha]).tooMany).toBe(true);
    await expect(addBulk(db, ann.id, many, {})).rejects.toThrow('invalid_input');
    expect(await db.select().from(products)).toEqual([]);
    expect(parseBulk('Name | a | alpha', [alpha]).lines[0]).toMatchObject({
      name: 'Name | a',
      console: 'alpha',
    });
  });
});

describe('words', () => {
  it('splits by line or comma, trims, drops repeats, refuses too many', () => {
    expect(wordsOf(' a, b\nb\n\n、c ')).toEqual(['a', 'b', 'c']);
    expect(() => wordsOf(Array.from({ length: 31 }, (_, i) => `w${i}`).join(','))).toThrow(
      'invalid_input',
    );
  });
});
