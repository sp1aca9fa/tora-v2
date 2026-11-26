import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localDate } from '@tora/core';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { askChecks, askStatus, chooseAsk } from './ask-check';
import { type Db, createDb } from './client';
import { confirmations, currentRules, recordItemCheck, saveItemRules } from './item-rules';
import { migrateDb } from './migrate';
import { createProduct } from './mutations';
import { refreshOpportunities } from './opportunities';
import { priceObservations, productSources, products, trackedGames } from './schema';
import { refreshSignals } from './signals';
import { saveSupply } from './supply';
import { createUser } from './users';
import { addWatch } from './watches';

let db: Db;
let uid: string;

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-ask-check-'));
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  const creds = { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] };
  uid = (await createUser(db, 'a', creds, 'admin')).user.id;
  return () => rm(dir, { recursive: true, force: true });
});

const NOW = new Date('2026-10-21T12:00:00+09:00');
const DAY = 86_400_000;
const TODAY = localDate(NOW);
const BUCKET = 'sealed:shrink';

// Made-up items (public test).
const card = (name: string) =>
  createProduct(db, uid, {
    category: 'tcg',
    kind: 'single',
    name,
    franchise: 'pokemon',
    region: 'jp',
  });
const sealed = (name: string) =>
  createProduct(db, uid, {
    category: 'tcg',
    kind: 'booster_box',
    name,
    franchise: 'pokemon',
    region: 'jp',
  });
const game = (name: string, kind = 'software') =>
  createProduct(db, uid, { category: 'game', kind, name, platform: 'Alpha Station', region: 'jp' });

/** The item's link at `source`: a saved search, or its own page there. */
const link = (productId: string, source: string, by: 'search' | 'page') =>
  db
    .insert(productSources)
    .values(
      by === 'search'
        ? { productId, source, externalId: 'search', query: { keywords: ['x'] } }
        : { productId, source, externalId: `page-${productId}`, url: 'https://example.test/item' },
    );

/** A lowest ask reported today. */
const ask = (productId: string, source: string, price: number, bucket = BUCKET) => ({
  productId,
  source,
  bucket,
  day: TODAY,
  lowestAskBase: price,
  lowestAskOriginal: price,
  currency: 'JPY',
  fxRate: null,
  listings: 2,
  url: `https://example.test/${source}`,
  fetchedAt: NOW.toISOString(),
});

/** Two sales a day for `days` days up to NOW at `source`. */
async function sales(
  productId: string,
  days: number,
  price: number,
  source = 'shop',
  bucket = BUCKET,
) {
  const rows = Array.from({ length: days * 2 }, (_, i) => {
    const at = new Date(NOW.getTime() - Math.floor(i / 2) * DAY - (i % 2) * 3_600_000);
    return {
      productId,
      source,
      observationType: 'sold' as const,
      bucket,
      priceBase: price,
      priceOriginal: price,
      currency: 'JPY',
      observedAt: at.toISOString(),
      fetchedAt: at.toISOString(),
      externalRef: `${productId}-${source}-${i}`,
    };
  });
  for (let i = 0; i < rows.length; i += 200) {
    await db.insert(priceObservations).values(rows.slice(i, i + 200));
  }
}

/** Confirms the item's listings at `source` by a passed labeled check. */
async function confirmListings(productId: string, source: string) {
  const current = (await currentRules(db, productId))!;
  await recordItemCheck(db, {
    productId,
    kind: 'listings',
    source,
    outcome: 'passed',
    by: 'check',
    rulesHash: current.hashFor('listings', source),
  });
}

describe('askStatus', () => {
  const sw = { category: 'game', kind: 'software' };
  const search = {
    source: 'market',
    externalId: 'search',
    query: { keywords: ['x'] },
    active: true,
  };
  const page = { source: 'shop', externalId: 'item-1', query: null, active: true };
  const row = (source: string) => ({ source });
  const confirmed = (yes: boolean) => ({ isConfirmed: () => yes });

  it('leaves cards, sealed and switched-off games alone', () => {
    expect(
      askStatus({ category: 'tcg', kind: 'single' }, null, row('market'), [search], null),
    ).toBe('not_game');
    expect(
      askStatus(
        { category: 'tcg', kind: 'booster_box' },
        { gameRules: 1 },
        row('market'),
        [],
        null,
      ),
    ).toBe('not_game');
    expect(askStatus(sw, { gameRules: 0 }, row('market'), [search], null)).toBe('not_game');
    // Another game kind only when its rules turn the game rules on.
    const amiibo = { category: 'game', kind: 'figure' };
    expect(askStatus(amiibo, null, row('market'), [search], null)).toBe('not_game');
    expect(askStatus(amiibo, { gameRules: 1 }, row('market'), [search], null)).toBe('unverified');
  });

  it("checks a game's ask by its page link or by a confirmation of that source", () => {
    expect(askStatus(sw, null, row('shop'), [search, page], null)).toBe('checked');
    expect(askStatus(sw, null, row('market'), [search, page], null)).toBe('unverified');
    expect(askStatus(sw, null, row('market'), [search, page], confirmed(false))).toBe('unverified');
    expect(askStatus(sw, null, row('market'), [search, page], confirmed(true))).toBe('checked');
    // A search beside a page at the same source, or no link there (unknown): unverified.
    expect(
      askStatus(
        sw,
        null,
        row('shop'),
        [page, { ...page, externalId: 'item-2', query: { keywords: [] } }],
        null,
      ),
    ).toBe('unverified');
    expect(askStatus(sw, null, row('elsewhere'), [search, page], null)).toBe('unverified');
  });

  it('reads a search by its id or its stored query, and only active links', () => {
    // A saved search with no stored query is still a search; an item page the runner searched with
    // (a query written onto it) is one too.
    const bare = { ...search, source: 'shop', query: null };
    expect(askStatus(sw, null, row('shop'), [page, bare], null)).toBe('unverified');
    const searched = { ...page, query: { keywords: ['x'] } };
    expect(askStatus(sw, null, row('shop'), [searched], null)).toBe('unverified');
    // A search set aside beside the page does not count; a page set aside checks nothing.
    const asideSearch = { ...search, source: 'shop', active: false };
    expect(askStatus(sw, null, row('shop'), [page, asideSearch], null)).toBe('checked');
    expect(askStatus(sw, null, row('shop'), [{ ...page, active: false }], null)).toBe('unverified');
  });
});

describe('chooseAsk', () => {
  const row = (source: string, price: number | null, bucket = BUCKET) => ({
    source,
    bucket,
    lowestAskBase: price,
  });
  const by =
    (unverified: string[], game = true) =>
    (r: { source: string }) =>
      !game ? 'not_game' : unverified.includes(r.source) ? 'unverified' : 'checked';

  it('gives a card or a sealed item its cheapest ask, as lowestAsk, and nothing to mention', () => {
    // Both are "not_game" for every row: the first of the cheapest in the bucket, as before.
    const rows = [row('shop', 900), row('market', 500), row('other', 500), row('x', 1, 'other')];
    const choice = chooseAsk(rows, BUCKET, by([], false));
    expect(choice.ask).toBe(rows[1]);
    expect(choice.unverified).toBeNull();
    expect(chooseAsk([row('shop', null)], BUCKET, by([], false))).toEqual({
      ask: null,
      unverified: null,
    });
    expect(chooseAsk([], BUCKET, by([], false))).toEqual({ ask: null, unverified: null });
  });

  it("acts on a game's cheapest checked ask and mentions a cheaper unverified one", () => {
    const only = [row('market', 2_500), row('auction', 2_000)];
    expect(chooseAsk(only, BUCKET, by(['market', 'auction']))).toEqual({
      ask: null,
      unverified: only[1],
    });
    const both = [row('market', 2_500), row('shop', 3_200)];
    expect(chooseAsk(both, BUCKET, by(['market']))).toEqual({ ask: both[1], unverified: both[0] });
    // An unverified ask at or over the checked one says nothing more.
    const dearer = [row('market', 3_200), row('shop', 3_200)];
    expect(chooseAsk(dearer, BUCKET, by(['market']))).toEqual({ ask: dearer[1], unverified: null });
    // Another condition's rows are never looked at.
    expect(chooseAsk([row('market', 1, 'loose')], BUCKET, by(['market']))).toEqual({
      ask: null,
      unverified: null,
    });
  });
});

describe('askChecks', () => {
  it('reads nothing for cards and sealed, and a fixed few batched reads for games', async () => {
    const c = await card('Card');
    const s = await sealed('Box');
    let reads = 0;
    const counting = {
      select: ((...args: Parameters<Db['select']>) => {
        reads++;
        return db.select(...args);
      }) as Db['select'],
    };
    const plain = await askChecks(counting, [c, s]);
    expect(reads).toBe(0);
    expect(plain.status({ productId: c.id, source: 'market' })).toBe('not_game');
    expect(plain.status({ productId: s.id, source: 'market' })).toBe('not_game');
    const rows = [ask(c.id, 'market', 100), ask(s.id, 'market', 200)];
    expect(plain.usable(rows)).toEqual(rows);

    const games: Awaited<ReturnType<typeof game>>[] = [];
    for (let i = 0; i < 6; i++) {
      const g = await game(`Game ${i}`);
      await link(g.id, 'market', 'search');
      games.push(g);
    }
    reads = 0;
    await askChecks(counting, games.slice(0, 1));
    const one = reads;
    reads = 0;
    await askChecks(counting, [c, ...games]);
    expect(reads).toBe(one);
    expect(() => plain.status({ productId: games[0]!.id, source: 'market' })).toThrow();
  });

  it('says unverified until the source is confirmed, checked by a page link, and follows the switch', async () => {
    const g = await game('Game');
    await link(g.id, 'market', 'search');
    await link(g.id, 'shop', 'page');
    const figure = await game('Figure', 'figure');
    await link(figure.id, 'market', 'search');
    const off = await game('Off');
    await link(off.id, 'market', 'search');
    await saveItemRules(
      db,
      off.id,
      {
        console: null,
        edition: null,
        required: [],
        excluded: [],
        boxed: false,
        boxedOf: null,
        gameRules: 0,
      },
      uid,
    );
    const read = async () => askChecks(db, [g, figure, off]);
    let checks = await read();
    expect(checks.status({ productId: g.id, source: 'market' })).toBe('unverified');
    expect(checks.status({ productId: g.id, source: 'shop' })).toBe('checked');
    expect(checks.status({ productId: figure.id, source: 'market' })).toBe('not_game');
    expect(checks.status({ productId: off.id, source: 'market' })).toBe('not_game');
    const rows = [ask(g.id, 'market', 100), ask(g.id, 'shop', 900)];
    expect(checks.usable(rows).map((r) => r.source)).toEqual(['shop']);

    await confirmListings(g.id, 'market');
    checks = await read();
    expect(checks.status({ productId: g.id, source: 'market' })).toBe('checked');
    // A rules change after the confirmation takes it away (another hash): unverified again.
    await saveItemRules(
      db,
      g.id,
      {
        console: null,
        edition: null,
        required: ['limited'],
        excluded: [],
        boxed: false,
        boxedOf: null,
        gameRules: null,
      },
      uid,
    );
    expect((await read()).status({ productId: g.id, source: 'market' })).toBe('unverified');
    await confirmListings(g.id, 'market');
    expect((await read()).status({ productId: g.id, source: 'market' })).toBe('checked');
    // The region is part of the rules too; the batched read and the single one agree on it.
    await db.update(products).set({ region: 'us' }).where(eq(products.id, g.id));
    const moved = await askChecks(db, [{ ...g, region: 'us' }]);
    expect(moved.status({ productId: g.id, source: 'market' })).toBe('unverified');
    expect((await confirmations(db, g.id))!.isConfirmed('listings', 'market')).toBe(false);
    await db.update(products).set({ region: 'jp' }).where(eq(products.id, g.id));
    expect((await read()).status({ productId: g.id, source: 'market' })).toBe('checked');
    expect((await confirmations(db, g.id))!.isConfirmed('listings', 'market')).toBe(true);
    // Sales confirmed say nothing about listings; a confirmation at one source not of another.
    await link(g.id, 'other', 'search');
    expect((await read()).status({ productId: g.id, source: 'other' })).toBe('unverified');
  });
});

describe('readers', () => {
  it("signals: a game's unverified ask is no ask; cards, sealed and page-linked games keep theirs", async () => {
    const c = await card('Card');
    const s = await sealed('Box');
    const onlySearch = await game('Only search');
    const withShop = await game('With shop');
    for (const p of [c, s, onlySearch, withShop]) await link(p.id, 'market', 'search');
    await link(withShop.id, 'shop', 'page');
    const buckets = new Map<string, string>();
    for (const p of [c, s, onlySearch, withShop]) {
      const { watch } = await addWatch(db, uid, { productId: p.id }, {});
      buckets.set(p.id, watch.bucket);
    }
    const at = (id: string, source: string, price: number) =>
      ask(id, source, price, buckets.get(id)!);
    // Daily prices at the source whose ask is read (with none anywhere there is no ask, case B8).
    for (const p of [c, s, onlySearch]) await sales(p.id, 10, 1000, 'market', buckets.get(p.id)!);
    await sales(withShop.id, 10, 1000, 'shop', buckets.get(withShop.id)!);
    await saveSupply(db, [
      at(c.id, 'market', 500),
      at(s.id, 'market', 600),
      at(onlySearch.id, 'market', 700),
      at(withShop.id, 'market', 300),
      at(withShop.id, 'shop', 800),
    ]);
    const { rows } = await refreshSignals(db, NOW, false);
    const askOf = (id: string) => rows.find((r) => r.productId === id)!.stats.ask;
    expect(askOf(c.id)).toBe(500);
    expect(askOf(s.id)).toBe(600);
    expect(askOf(onlySearch.id)).toBeNull();
    expect(askOf(withShop.id)).toBe(800);
  });

  it('opportunities leave out a tracked game no one holds or wishes (S36 step D)', async () => {
    const plain = await game('Plain');
    const tracked = await game('Tracked');
    const wished = await game('Tracked and wished');
    for (const p of [plain, tracked, wished]) {
      await sales(p.id, 40, 10_000, 'market');
      await link(p.id, 'market', 'search');
      if (p !== plain) await db.insert(trackedGames).values({ productId: p.id, shopSlot: 0 });
    }
    await addWatch(db, uid, { productId: wished.id }, {});
    const ids = (await refreshOpportunities(db, NOW, false)).items.map((o) => o.productId);
    expect(ids).toContain(plain.id);
    expect(ids).toContain(wished.id);
    expect(ids).not.toContain(tracked.id);
  });

  it("opportunities: a game's unverified ask is dropped before the under-value test", async () => {
    const c = await card('Card');
    const s = await sealed('Box');
    const unchecked = await game('Unchecked');
    const confirmed = await game('Confirmed');
    for (const p of [c, s, unchecked, confirmed]) {
      await sales(p.id, 40, 10_000, 'market');
      await link(p.id, 'market', 'search');
    }
    await confirmListings(confirmed.id, 'market');
    await saveSupply(db, [
      ask(c.id, 'market', 8_000),
      ask(s.id, 'market', 8_000),
      ask(unchecked.id, 'market', 8_000),
      ask(confirmed.id, 'market', 8_000),
    ]);
    const saved = await refreshOpportunities(db, NOW, false);
    const of = (id: string) => saved.items.find((o) => o.productId === id);
    expect(of(c.id)?.ask).toMatchObject({ price: 8_000, source: 'market' });
    expect(of(s.id)?.ask).toMatchObject({ price: 8_000, source: 'market' });
    expect(of(unchecked.id)).toBeDefined();
    expect(of(unchecked.id)!.ask).toBeNull();
    expect(of(confirmed.id)?.ask).toMatchObject({ price: 8_000, source: 'market' });
  });
});
