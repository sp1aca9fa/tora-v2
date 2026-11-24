import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LevelDay, SourceInfo } from '@tora/core';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { type Db, createDb } from './client';
import { saveConsole } from './consoles';
import { currentRules, recordItemCheck } from './item-rules';
import { migrateDb } from './migrate';
import { saveSetting, saveSourceInfos } from './registry';
import {
  collectorRuns,
  itemFacts,
  marketJobs,
  notItemMarks,
  priceObservations,
  productSources,
  saleCoverage,
  saleSpans,
  watches,
  wishEstimates,
} from './schema';
import { type SupplyOffer, type SupplyRow, saveSupply } from './supply';
import { createUser } from './users';
import { addWatch, removeWatch } from './watches';
import { WISH_RECORD_SHOWN_KEY, saveWishLevel } from './wish-levels';
import {
  freshNight,
  recordItemFact,
  saveWishEstimate,
  setWishCondition,
  setWishTarget,
  wishView,
  wishViews,
  withdrawItemFact,
} from './wish-view';
import { addGameWish } from './wishes';

// Made-up sources and console (public test): an identity shop, two marketplaces, a new-copy source.
const SOURCES: SourceInfo[] = [
  {
    key: 'shop',
    market: 'jp',
    label: 'Shop',
    priority: 10,
    roles: { game: 'reference' },
    identity: ['game'],
    links: [{ pattern: 'shop\\.test/item/(\\w+)', url: 'https://shop.test/item/{id}' }],
  },
  { key: 'marketa', market: 'jp', label: 'Market A', priority: 20, roles: { game: 'supporting' } },
  { key: 'marketb', market: 'jp', label: 'Market B', priority: 30, roles: { game: 'supporting' } },
  {
    key: 'newcopy',
    market: 'jp',
    label: 'New Copy',
    priority: 40,
    roles: { game: 'comparison' },
    credit: { text: 'Data by New Copy', url: 'https://newcopy.test/' },
  },
];

// Fixed clock: 2026-06-15 noon in the app's zone; the last nightly read ran that day.
const NOW = new Date('2026-06-15T03:00:00Z');
const NIGHT = '2026-06-15';
const BEFORE = '2026-06-13';

let db: Db;
let ann: { id: string; role: 'member' };
let bob: { id: string; role: 'member' };
let admin: { id: string; role: 'admin' };

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-wish-view-'));
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  const creds = { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] };
  admin = { id: (await createUser(db, 'a', creds, 'admin')).user.id, role: 'admin' };
  ann = { id: (await createUser(db, 'ann', creds, 'member')).user.id, role: 'member' };
  bob = { id: (await createUser(db, 'bob', creds, 'member')).user.id, role: 'member' };
  await saveConsole(db, {
    key: 'alpha',
    names: { en: 'Alpha Station' },
    aliases: [],
    categories: {},
    boxedAllowed: true,
  });
  await saveSourceInfos(db, SOURCES);
  await db
    .insert(collectorRuns)
    .values({ source: 'marketa', startedAt: '2026-06-15T00:10:00+09:00', status: 'ok' });
  return () => rm(dir, { recursive: true, force: true });
});

const offer = (ref: string, price: number, over: Partial<SupplyOffer> = {}): SupplyOffer => ({
  ref,
  title: `Star Rover ${ref}`,
  url: `https://example.test/${ref}`,
  priceBase: price,
  priceOriginal: price,
  currency: 'JPY',
  seller: `seller-${ref}`,
  category: null,
  shipping: 'unknown',
  shippingPayerId: null,
  ...over,
});

const row = (
  productId: string,
  source: string,
  bucket: string,
  day: string,
  offers: SupplyOffer[] | null,
  over: Partial<SupplyRow> = {},
): SupplyRow => ({
  productId,
  source,
  bucket,
  day,
  lowestAskBase: offers?.length ? Math.min(...offers.map((o) => o.priceBase)) : null,
  lowestAskOriginal: null,
  currency: 'JPY',
  fxRate: null,
  listings: offers?.length ?? 0,
  fetchedAt: `${day}T00:30:00+09:00`,
  offers,
  ...over,
});

/**
 * A game wish of Ann's, its sales confirmed (or not), linked: the shop and marketa by page, marketb
 * by search, newcopy by the shop's product code.
 */
async function gameWish(confirmed = true, condition?: 'like_new' | 'no_noticeable_damage') {
  const { watch, product } = await addGameWish(db, ann.id, {
    name: 'Star Rover',
    console: 'alpha',
    watch: condition ? { condition } : {},
  });
  await db.insert(productSources).values([
    {
      productId: product.id,
      source: 'shop',
      externalId: 'g1',
      url: 'https://shop.test/item/g1',
      // The shop's product code: newcopy's link is by it.
      facts: { jan: '4900000000001', seenAt: NIGHT },
    },
    { productId: product.id, source: 'marketa', externalId: 'p1', url: 'https://a.test/p1' },
    { productId: product.id, source: 'marketb', externalId: 'search', query: { keywords: ['x'] } },
    { productId: product.id, source: 'newcopy', externalId: '4900000000001' },
  ]);
  if (confirmed) {
    const hash = (await currentRules(db, product.id))!.hashFor('sales', '');
    await recordItemCheck(db, {
      productId: product.id,
      kind: 'sales',
      source: '',
      outcome: 'confirmed',
      by: 'person',
      rulesHash: hash,
      userId: ann.id,
    });
  }
  return { watch, product };
}

/** The item's stored nights at a source, as the runner stamps them (the day the collect ran). */
const nights = (productId: string, source: string, ranges: [string, string][]) =>
  db
    .insert(saleCoverage)
    .values({ productId, source, nights: ranges, updatedAt: NOW.toISOString() });

const level = (day: string, value: number | null, n = 12): LevelDay =>
  value === null
    ? {
        day,
        level: null,
        n,
        window: null,
        low: null,
        high: null,
        unknownCost: 0,
        reason: 'too_few',
        wholeFrom: null,
        wholeOn: null,
        sources: ['marketa'],
      }
    : { day, level: value, n, window: 30, sources: ['marketa'], left: { marketb: 'hole' } };

describe('wishView: buyable tonight', () => {
  it('lists tonight copies in the wish condition or better; never a worse one', async () => {
    const { watch, product } = await gameWish();
    expect(watch.bucket).toBe('cond:good');
    await saveSupply(db, [
      row(product.id, 'marketa', 'cond:good', NIGHT, [offer('g1', 3000), offer('g2', 3400)]),
      row(product.id, 'marketa', 'cond:new', NIGHT, [offer('n1', 3200)]),
      row(product.id, 'marketa', 'cond:fair', NIGHT, [offer('f1', 1500)]),
      row(product.id, 'marketa', 'cond:used', NIGHT, [offer('u1', 1800)]),
    ]);
    const v = (await wishView(db, ann.id, watch.id, { now: NOW }))!;
    expect(v.night).toBe(NIGHT);
    const a = v.sources.find((s) => s.source === 'marketa')!;
    expect([a.current, a.status, a.day]).toEqual([true, 'checked', NIGHT]);
    expect(a.copies.map((c) => c.ref)).toEqual(['g1', 'n1', 'g2']);
    expect(a.count).toBe(3);
    // The grade not stated is apart; the worse condition is nowhere.
    expect(a.apart.map((c) => c.ref)).toEqual(['u1']);
    expect(JSON.stringify(v)).not.toContain('"f1"');
    expect(v.cheapest).toMatchObject({ source: 'marketa', day: NIGHT, price: 3000, counted: 3000 });
  });

  it('keeps the cheapest five, and a capped count says so', async () => {
    const { watch, product } = await gameWish();
    const offers = [5, 1, 4, 2, 6, 3].map((i) => offer(`o${i}`, 1000 * i));
    await saveSupply(db, [
      row(product.id, 'marketa', 'cond:good', NIGHT, offers, {
        listings: 40,
        listingsCapped: true,
      }),
    ]);
    const a = (await wishView(db, ann.id, watch.id, { now: NOW }))!.sources[0]!;
    expect(a.copies.map((c) => c.ref)).toEqual(['o1', 'o2', 'o3', 'o4', 'o5']);
    expect([a.count, a.capped]).toEqual([40, true]);
  });

  it('a source not read on N shows its last read day; the cheapest is from N only', async () => {
    const { watch, product } = await gameWish();
    await saveSupply(db, [
      row(product.id, 'marketa', 'cond:good', BEFORE, [offer('old', 2000)]),
      row(product.id, 'marketa', 'cond:good', '2026-06-10', [offer('older', 1000)]),
      row(product.id, 'shop', 'cond:good', NIGHT, [
        offer('s', 2600, { own: 'own', stock: 1, shipping: 'included' }),
      ]),
    ]);
    const v = (await wishView(db, ann.id, watch.id, { now: NOW }))!;
    const a = v.sources.find((s) => s.source === 'marketa')!;
    expect([a.current, a.none, a.day, a.copies.map((c) => c.ref)]).toEqual([
      false,
      false,
      BEFORE,
      ['old'],
    ]);
    // The cheapest copy is N's, though an older read had a cheaper one.
    expect(v.cheapest).toMatchObject({ source: 'shop', day: NIGHT, price: 2600 });
    expect(v.cheapest!.paid).toEqual({ known: true, amount: 2600 });
  });

  it('two reads the same day: only the newer read counts, an older row of the day is gone', async () => {
    const { watch, product } = await gameWish();
    // The nightly found a good copy; a "collect now" at 14:00 found only a fair one, so only the
    // fair row was rewritten and the good row of 00:30 is still stored.
    await saveSupply(db, [
      row(product.id, 'marketa', 'cond:good', NIGHT, [offer('g1', 3000)]),
      row(product.id, 'marketa', 'cond:fair', NIGHT, [offer('f1', 2000)], {
        fetchedAt: `${NIGHT}T14:00:00+09:00`,
      }),
    ]);
    const page = (await wishView(db, ann.id, watch.id, { now: NOW }))!;
    const card = (await wishViews(db, ann.id, [watch.id], { now: NOW })).get(watch.id)!;
    for (const v of [page, card]) {
      expect(v.sources[0]).toMatchObject({ source: 'marketa', current: true, none: true });
      expect(v.cheapest).toBeNull();
    }
  });

  it('a boxed wish linked at the shop reads its own shop rows, on the page and the list alike', async () => {
    const plain = (await gameWish()).product;
    const { watch, product: boxed } = await addGameWish(db, ann.id, {
      name: 'Star Rover',
      console: 'alpha',
      reuse: plain.id,
      boxed: true,
      watch: { targetPriceBase: 3000 },
    });
    expect(boxed.id).not.toBe(plain.id);
    await db.insert(productSources).values({
      productId: boxed.id,
      source: 'shop',
      externalId: 'b1',
      url: 'https://shop.test/item/b1',
    });
    const own = { own: 'own' as const, stock: 1 };
    await saveSupply(db, [
      // The boxed item's own copy, read two days ago and not on N; the plain item's loose copy on N.
      row(boxed.id, 'shop', 'cond:good', BEFORE, [offer('b', 9000, own)]),
      row(plain.id, 'shop', 'cond:good', NIGHT, [offer('p', 2000, own)]),
    ]);
    const page = (await wishView(db, ann.id, watch.id, { now: NOW }))!;
    const card = (await wishViews(db, ann.id, [watch.id], { now: NOW })).get(watch.id)!;
    // Never the loose copy at 2,000 as the boxed wish's cheapest.
    expect(page.cheapest).toBeNull();
    expect(card.cheapest).toBeNull();
  });

  it('with no run recorded, nothing reads as N: copies under their day, no cheapest', async () => {
    await db.delete(collectorRuns);
    const { watch, product } = await gameWish();
    await saveSupply(db, [row(product.id, 'marketa', 'cond:good', NIGHT, [offer('g1', 3000)])]);
    const v = (await wishView(db, ann.id, watch.id, { now: NOW }))!;
    expect([v.night, v.lastRun]).toEqual([null, null]);
    expect([v.sources[0]!.current, v.sources[0]!.day]).toEqual([false, NIGHT]);
    expect(v.cheapest).toBeNull();
  });

  it('a night 4 days old is N but not last night: shown by its date (round 2, item 1)', async () => {
    const { watch, product } = await gameWish();
    await saveSupply(db, [row(product.id, 'marketa', 'cond:good', NIGHT, [offer('g1', 3000)])]);
    const later = new Date('2026-06-19T03:00:00Z');
    const v = (await wishView(db, ann.id, watch.id, { now: later }))!;
    expect([v.night, v.lastRun]).toEqual([null, NIGHT]);
    expect([v.sources[0]!.current, v.sources[0]!.day]).toEqual([true, NIGHT]);
    expect(v.cheapest).toMatchObject({ day: NIGHT, price: 3000 });
    // Past a week, no run is read at all.
    const v2 = (await wishView(db, ann.id, watch.id, { now: new Date('2026-06-23T03:00:00Z') }))!;
    expect([v2.night, v2.lastRun]).toEqual([null, null]);
  });

  it('a source read on N whose search found nothing at all says none found (no row of N)', async () => {
    const { watch, product } = await gameWish();
    await saveSupply(db, [row(product.id, 'marketa', 'cond:good', BEFORE, [offer('old', 2000)])]);
    // The runner records the run's day as the item's night at the source, also when it found nothing.
    await nights(product.id, 'marketa', [[BEFORE, NIGHT]]);
    const v = (await wishView(db, ann.id, watch.id, { now: NOW }))!;
    const a = v.sources.find((s) => s.source === 'marketa')!;
    expect([a.none, a.current, a.day, a.copies, a.count]).toEqual([true, true, NIGHT, [], 0]);
    // Sources with no supply row for the item are not listed (the shop, marketb).
    expect([v.sources.map((s) => s.source), v.shop]).toEqual([['marketa'], []]);
    expect(v.cheapest).toBeNull();
  });

  it('a run started before midnight: its rows show under their day, never "none found"', async () => {
    const { watch, product } = await gameWish();
    // "Collect now" started 23:40 on D-1 and read the link after midnight: rows and night dated
    // D-1 (the run's start day). The nightly of D (the run in beforeEach) skipped the link.
    const before = '2026-06-14';
    await db
      .insert(collectorRuns)
      .values({ source: 'marketa', startedAt: `${before}T23:40:00+09:00`, status: 'ok' });
    await saveSupply(db, [
      row(product.id, 'marketa', 'cond:good', before, [offer('late', 2500)], {
        fetchedAt: `${NIGHT}T00:20:00+09:00`,
      }),
    ]);
    await nights(product.id, 'marketa', [[before, before]]);
    const v = (await wishView(db, ann.id, watch.id, { now: NOW }))!;
    const a = v.sources.find((s) => s.source === 'marketa')!;
    expect([v.lastRun, a.current, a.none, a.day, a.copies.map((c) => c.ref)]).toEqual([
      NIGHT,
      false,
      false,
      before,
      ['late'],
    ]);
    // Not N's: not the cheapest checked copy.
    expect(v.cheapest).toBeNull();
  });

  it('a sales-only source (nights, no supply row) is never listed under the copies', async () => {
    const { watch, product } = await gameWish();
    await saveSupply(db, [row(product.id, 'marketa', 'cond:good', NIGHT, [offer('g', 3000)])]);
    await nights(product.id, 'marketb', [[BEFORE, NIGHT]]);
    const v = (await wishView(db, ann.id, watch.id, { now: NOW }))!;
    expect(v.sources.map((s) => s.source)).toEqual(['marketa']);
  });

  it('a missed night: last night at 05:00 the next day, shown by its date at 07:00', async () => {
    const { watch, product } = await gameWish();
    await saveSupply(db, [row(product.id, 'marketa', 'cond:good', NIGHT, [offer('g', 3000)])]);
    // 2026-06-16 05:00 and 07:00 in the app's zone (Tokyo); no run on the 16th.
    const at5 = new Date('2026-06-15T20:00:00Z');
    const at7 = new Date('2026-06-15T22:00:00Z');
    expect([freshNight(NIGHT, at5), freshNight(NIGHT, at7)]).toEqual([NIGHT, null]);
    expect(freshNight('2026-06-14', at5)).toBeNull();
    const v5 = (await wishView(db, ann.id, watch.id, { now: at5 }))!;
    const v7 = (await wishView(db, ann.id, watch.id, { now: at7 }))!;
    expect([v5.night, v5.lastRun, v7.night, v7.lastRun]).toEqual([NIGHT, NIGHT, null, NIGHT]);
    // Either way the copies and the cheapest are N's.
    expect([v7.sources[0]!.current, v7.cheapest!.day]).toEqual([true, NIGHT]);
  });

  it('a plus-shipping copy counts on its stored price: 2,900 beats a known 3,000 (C2, C3)', async () => {
    const { watch, product } = await gameWish();
    await setWishTarget(db, ann.id, watch.id, 3000);
    await saveSupply(db, [
      row(product.id, 'marketa', 'cond:good', NIGHT, [
        offer('known', 3000, { shipping: 'included' }),
        offer('plus', 2900, { shipping: 'buyer' }),
      ]),
    ]);
    for (const v of [
      (await wishView(db, ann.id, watch.id, { now: NOW }))!,
      (await wishViews(db, ann.id, [watch.id], { now: NOW })).get(watch.id)!,
    ]) {
      expect(v.cheapest).toMatchObject({
        price: 2900,
        counted: 2900,
        paid: { known: false, amount: null },
      });
      expect(v.cheapest!.counted <= v.watch.targetPriceBase!).toBe(true);
    }
  });

  it('every source read on N with nothing in the condition: no checked copy, page and list', async () => {
    const { watch, product } = await gameWish();
    await saveSupply(db, [
      row(product.id, 'marketa', 'cond:fair', NIGHT, [offer('worse', 900)]),
      row(product.id, 'shop', 'cond:good', NIGHT, null),
      // An older read at another (checked) source.
      row(product.id, 'newcopy', 'cond:good', BEFORE, [offer('older', 1000)]),
    ]);
    const page = (await wishView(db, ann.id, watch.id, { now: NOW }))!;
    const list = (await wishViews(db, ann.id, [watch.id], { now: NOW })).get(watch.id)!;
    expect([page.cheapest, list.cheapest]).toEqual([null, null]);
    expect(page.sources.find((s) => s.source === 'marketa')).toMatchObject({
      current: true,
      none: true,
    });
    expect(page.sources.find((s) => s.source === 'newcopy')).toMatchObject({
      current: false,
      day: BEFORE,
    });
    expect(page.shop[0]).toMatchObject({ current: true, none: false, outOfStock: true });
  });

  it('the count leaves out stored listings marked not the item (item 4)', async () => {
    const { watch, product } = await gameWish();
    await saveSupply(db, [
      row(product.id, 'marketa', 'cond:good', NIGHT, [offer('a', 1000), offer('b', 1200)], {
        listings: 9,
      }),
    ]);
    await db
      .insert(notItemMarks)
      .values({ productId: product.id, source: 'marketa', externalRef: 'a', at: NIGHT });
    const a = (await wishView(db, ann.id, watch.id, { now: NOW }))!.sources[0]!;
    expect([a.copies.map((c) => c.ref), a.count]).toEqual([['b'], 8]);
  });

  it('an unknown added cost is "plus shipping", never the bare price as paid', async () => {
    const { watch, product } = await gameWish();
    await saveSupply(db, [
      row(product.id, 'marketa', 'cond:good', NIGHT, [
        offer('u', 2000),
        offer('b', 2100, { shipping: 'buyer' }),
        offer('i', 2200, { shipping: 'included' }),
      ]),
    ]);
    const copies = (await wishView(db, ann.id, watch.id, { now: NOW }))!.sources[0]!.copies;
    expect(copies.map((c) => [c.ref, c.price, c.paid])).toEqual([
      ['u', 2000, { known: false, amount: null }],
      ['b', 2100, { known: false, amount: null }],
      ['i', 2200, { known: true, amount: 2200 }],
    ]);
  });

  it('an unchecked search shows no copies, only its count and a muted price', async () => {
    const { watch, product } = await gameWish();
    await saveSupply(db, [row(product.id, 'marketb', 'cond:good', NIGHT, [offer('x', 900)])]);
    const b = (await wishView(db, ann.id, watch.id, { now: NOW }))!.sources[0]!;
    expect([b.status, b.copies, b.apart, b.count, b.unverifiedPrice]).toEqual([
      'unverified',
      [],
      [],
      1,
      900,
    ]);
  });

  it('the shop: its own copy and outside sellers apart, out of stock said', async () => {
    const { watch, product } = await gameWish();
    await saveSupply(db, [
      row(product.id, 'shop', 'cond:good', NIGHT, [
        offer('own', 2800, { own: 'own', stock: 2 }),
        offer('out', 2500, { own: 'outside', count: 3, condition: 'used' }),
      ]),
    ]);
    let s = (await wishView(db, ann.id, watch.id, { now: NOW }))!.shop[0]!;
    expect(s.entries.map((e) => [e.kind, e.price, e.stock, e.count])).toEqual([
      ['outside', 2500, null, 3],
      ['own', 2800, 2, null],
    ]);
    expect(s.outOfStock).toBe(false);
    await saveSupply(db, [
      row(product.id, 'shop', 'cond:good', '2026-06-16', null, { lowestAskBase: null }),
    ]);
    await db
      .insert(collectorRuns)
      .values({ source: 'shop', startedAt: '2026-06-16T00:10:00+09:00', status: 'ok' });
    s = (await wishView(db, ann.id, watch.id, { now: new Date('2026-06-16T03:00:00Z') }))!.shop[0]!;
    expect([s.day, s.entries, s.outOfStock]).toEqual(['2026-06-16', [], true]);
  });
});

describe('wishView: check needed, cards, access', () => {
  it('check needed: shop copies only; no level, sources, bounds or estimate score', async () => {
    const { watch, product } = await gameWish(false);
    await saveSupply(db, [
      row(product.id, 'marketa', 'cond:good', NIGHT, [offer('g1', 3000)]),
      row(product.id, 'shop', 'cond:good', NIGHT, [offer('own', 2800, { own: 'own' })]),
    ]);
    await saveWishLevel(db, {
      productId: product.id,
      bucket: watch.bucket,
      series: [level('2026-06-14', 3000)],
      record: null,
      bornOn: null,
      inputsHash: 'h',
      computedAt: NOW.toISOString(),
    });
    await saveWishEstimate(db, ann.id, watch.id, { low: 2000, high: 3000, settleBy: '2026-05' });
    const v = (await wishView(db, ann.id, watch.id, { now: NOW }))!;
    expect(v.state).toBe('check_needed');
    expect([v.sources, v.level, v.bounds, v.facts, v.history]).toEqual([[], null, null, [], []]);
    expect(v.shop[0]!.entries.map((e) => e.price)).toEqual([2800]);
    expect(v.estimates[0]!.outcome).toBeNull();
  });

  it("another person's wish is not read, and every action refuses it", async () => {
    const { watch } = await gameWish();
    expect(await wishView(db, bob.id, watch.id, { now: NOW })).toBeNull();
    expect((await wishViews(db, bob.id, [watch.id])).size).toBe(0);
    for (const act of [
      () => saveWishEstimate(db, bob.id, watch.id, { low: 1, high: 2 }),
      () => recordItemFact(db, bob.id, watch.id, { day: NIGHT, kind: 'port', text: 'x' }),
      () => setWishCondition(db, bob.id, watch.id, 'like_new'),
      () => setWishTarget(db, bob.id, watch.id, 1000),
    ])
      await expect(act()).rejects.toMatchObject({ code: 'not_found' });
    // Not even an admin opens another person's wish here.
    expect(await wishView(db, admin.id, watch.id, { now: NOW })).toBeNull();
  });

  it('a card wish reads not_game and has nothing of a game', async () => {
    const { watch } = await addWatch(
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
    const v = (await wishView(db, ann.id, watch.id, { now: NOW }))!;
    expect([v.state, v.shop, v.sources, v.level]).toEqual(['not_game', [], [], null]);
    await expect(saveWishEstimate(db, ann.id, watch.id, { low: 1, high: 2 })).rejects.toMatchObject(
      { code: 'not_found' },
    );
  });
});

describe('wishView: level, record, bounds, facts', () => {
  const series = (days: number, value: (i: number) => number | null) =>
    Array.from({ length: days }, (_, i) => {
      const d = new Date(Date.UTC(2026, 3, 1 + i)).toISOString().slice(0, 10);
      return level(d, value(i));
    });

  it('the level with its change; the record and "near the low" only when shown', async () => {
    const { watch, product } = await gameWish();
    const days = series(70, (i) => 4000 - i * 10);
    await saveWishLevel(db, {
      productId: product.id,
      bucket: watch.bucket,
      series: days,
      record: { level: 3320, day: days.at(-1)!.day, window: 30 },
      bornOn: '2025-01-01',
      inputsHash: 'h',
      computedAt: NOW.toISOString(),
    });
    let v = (await wishView(db, ann.id, watch.id, { now: NOW }))!;
    expect(v.level!.current).toMatchObject({ day: '2026-06-09', level: 3310, window: 30, n: 12 });
    expect(v.level!.change).toMatchObject({ amount: -280 });
    expect([v.level!.record, v.level!.nearLow]).toEqual([null, false]);
    expect(v.level!.young).toEqual({ young: false, ageDays: 524 });
    await saveSetting(db, WISH_RECORD_SHOWN_KEY, true);
    v = (await wishView(db, ann.id, watch.id, { now: NOW }))!;
    expect(v.level!.record!.level).toBe(3320);
    expect(v.level!.nearLow).toBe(true);
    // The change shows in the level only, never as a fact too (fix round 1, item 15).
    expect(v.facts.map((f) => f.kind)).not.toContain('level_change');
  });

  it('no stored level: none, and said so', async () => {
    const { watch } = await gameWish();
    const v = (await wishView(db, ann.id, watch.id, { now: NOW }))!;
    expect([v.level, v.levelStored]).toEqual([null, false]);
  });

  it('bounds: buyback with its change, the cheaper new copy, the list price; unknown left out', async () => {
    const { watch, product } = await gameWish();
    let v = (await wishView(db, ann.id, watch.id, { now: NOW }))!;
    expect(v.bounds).toEqual({ buyback: null, newCopy: null, listPrice: null });
    const buy = (day: string, price: number) => ({
      productId: product.id,
      source: 'shop',
      observationType: 'buylist' as const,
      bucket: null,
      priceBase: price,
      priceOriginal: price,
      currency: 'JPY',
      observedAt: `${day}T01:00:00+09:00`,
      fetchedAt: `${day}T01:00:00+09:00`,
      externalRef: `buy-${day}`,
    });
    await db.insert(priceObservations).values([buy('2026-05-18', 1000), buy(NIGHT, 1200)]);
    await saveSupply(db, [
      row(product.id, 'shop', 'cond:new', NIGHT, [offer('sn', 5200, { own: 'own' })]),
      row(product.id, 'newcopy', 'cond:new', NIGHT, [offer('nc', 4800)]),
      row(product.id, 'marketb', 'cond:new', NIGHT, [offer('cheap', 100)]),
    ]);
    await db
      .update(productSources)
      .set({
        facts: {
          listPrice: { amount: 6800, currency: 'JPY', tax: 'included', seenAt: NIGHT },
          jan: '4900000000001',
          seenAt: NIGHT,
        },
      })
      .where(eq(productSources.source, 'shop'));
    v = (await wishView(db, ann.id, watch.id, { now: NOW }))!;
    expect(v.bounds!.buyback).toMatchObject({ price: 1200, day: NIGHT, change: { amount: 200 } });
    // The unchecked search's cheaper new ask is not a bound.
    expect(v.bounds!.newCopy).toMatchObject({ source: 'newcopy', price: 4800 });
    expect(v.bounds!.listPrice).toMatchObject({ amount: 6800, tax: 'included', source: 'shop' });
    expect(v.credits).toEqual([
      { source: 'newcopy', text: 'Data by New Copy', url: 'https://newcopy.test/' },
    ]);
    expect(v.facts.map((f) => f.kind)).toContain('buyback_change');
  });

  it('a new copy only from the shop itself or the source linked by its product code (item 10)', async () => {
    const { watch, product } = await gameWish();
    await saveSupply(db, [
      row(product.id, 'shop', 'cond:new', NIGHT, [
        offer('sn', 5200, { own: 'own' }),
        offer('so', 3000, { own: 'outside', count: 1 }),
      ]),
      row(product.id, 'newcopy', 'cond:new', NIGHT, [offer('nc', 4800)]),
      // marketa is checked (an item page), but a marketplace listing is never a new-copy bound.
      row(product.id, 'marketa', 'cond:new', NIGHT, [offer('ma', 2000)]),
    ]);
    let v = (await wishView(db, ann.id, watch.id, { now: NOW }))!;
    expect(v.bounds!.newCopy).toMatchObject({ source: 'newcopy', price: 4800 });
    // A link whose id is not the shop's code is not read by the code: the shop's own copy only.
    await db
      .update(productSources)
      .set({ externalId: '4900000000002' })
      .where(eq(productSources.source, 'newcopy'));
    v = (await wishView(db, ann.id, watch.id, { now: NOW }))!;
    expect(v.bounds!.newCopy).toMatchObject({ source: 'shop', price: 5200 });
  });

  it('the buyback bound never reads a row marked excluded (item 5)', async () => {
    const { watch, product } = await gameWish();
    await db.insert(priceObservations).values({
      productId: product.id,
      source: 'shop',
      observationType: 'buylist',
      bucket: null,
      priceBase: 9000,
      priceOriginal: 9000,
      currency: 'JPY',
      observedAt: `${NIGHT}T01:00:00+09:00`,
      fetchedAt: `${NIGHT}T01:00:00+09:00`,
      externalRef: 'buy-x',
      excluded: true,
    });
    const v = (await wishView(db, ann.id, watch.id, { now: NOW }))!;
    expect(v.bounds!.buyback).toBeNull();
  });

  it('out of stock and no new copy for 5 read nights running; a night not read is skipped', async () => {
    const { watch, product } = await gameWish();
    const nights = ['2026-06-08', '2026-06-09', '2026-06-11', '2026-06-12', '2026-06-13'];
    await saveSupply(db, [
      row(product.id, 'shop', 'cond:good', '2026-06-07', [offer('o', 2000, { own: 'own' })]),
      ...nights.map((d) => row(product.id, 'shop', 'cond:good', d, null)),
      ...nights.map((d) => row(product.id, 'newcopy', 'cond:new', d, null)),
    ]);
    let v = (await wishView(db, ann.id, watch.id, { now: NOW }))!;
    expect(v.facts).toEqual([
      { kind: 'shop_out', source: 'shop', nights: 5, since: '2026-06-08' },
      { kind: 'no_new_copy', nights: 5, since: '2026-06-08' },
    ]);
    // Four nights are not a fact yet.
    await saveSupply(db, [
      row(product.id, 'shop', 'cond:good', '2026-06-08', [offer('o', 2000, { own: 'own' })]),
    ]);
    v = (await wishView(db, ann.id, watch.id, { now: NOW }))!;
    expect(v.facts.map((f) => f.kind)).toEqual(['no_new_copy']);
  });
});

describe('wishView: history', () => {
  it('covered days per source, by how; a deep read running, one asked for again', async () => {
    const { watch, product } = await gameWish();
    await db.insert(saleCoverage).values({
      productId: product.id,
      source: 'marketa',
      nights: [['2026-06-10', '2026-06-15']],
      updatedAt: NOW.toISOString(),
    });
    await db.insert(saleSpans).values({
      productId: product.id,
      source: 'marketa',
      fromDay: '2026-03-01',
      toDay: '2026-06-08',
      how: 'deep',
    });
    await db.insert(marketJobs).values([
      { source: 'marketa', productId: product.id, kind: 'deep', status: 'running' },
      // A 12-month read that made requests and goes on another day.
      {
        source: 'marketc',
        productId: product.id,
        kind: 'deep',
        status: 'waiting',
        requests: 3,
      },
      // Asked for again: the job before it says its search was edited.
      {
        source: 'marketd',
        productId: product.id,
        kind: 'deep',
        status: 'done',
        createdAt: '2026-06-01T00:00:00+09:00',
        result: { why: 'search_edited' },
      },
      {
        source: 'marketd',
        productId: product.id,
        kind: 'deep',
        status: 'waiting',
        createdAt: '2026-06-14T00:00:00+09:00',
      },
      {
        source: 'marketb',
        productId: product.id,
        kind: 'readback',
        status: 'done',
        createdAt: '2026-06-01T00:00:00+09:00',
      },
      {
        source: 'marketb',
        productId: product.id,
        kind: 'readback',
        status: 'waiting',
        createdAt: '2026-06-14T00:00:00+09:00',
      },
    ]);
    const h = (await wishView(db, ann.id, watch.id, { now: NOW }))!.history;
    expect(h.map((l) => [l.source, l.first, l.days, l.job])).toEqual([
      ['marketa', '2026-03-01', 106, { state: 'running', kind: 'deep' }],
      // The weekly read's next job after the last one is waiting, not asked again (item 3).
      ['marketb', null, 0, { state: 'waiting', kind: 'readback' }],
      ['marketc', null, 0, { state: 'several_days', kind: 'deep' }],
      ['marketd', null, 0, { state: 'asked_again', kind: 'deep' }],
    ]);
    expect(h[0]!.by.map((b) => b.how)).toEqual(['night', 'deep']);
    expect(h[0]!.by[0]!.ranges).toEqual([['2026-06-09', '2026-06-14']]);
  });
});

describe('estimates', () => {
  it('append-only, per user, with what happened since', async () => {
    const { watch, product } = await gameWish();
    await saveWishLevel(db, {
      productId: product.id,
      bucket: watch.bucket,
      series: [level('2026-04-30', 2500), level('2026-05-31', null), level('2026-06-14', 3000)],
      record: null,
      bornOn: null,
      inputsHash: 'h',
      computedAt: NOW.toISOString(),
    });
    await saveWishEstimate(db, ann.id, watch.id, {
      low: 2000,
      high: 2400,
      settleBy: '2026-04',
      risks: [{ kind: 'rerelease' }, { kind: 'other', text: 'a port is rumored' }],
      basis: 'own_history',
      sources: ['https://example.test/a'],
    });
    await saveWishEstimate(db, ann.id, watch.id, { low: 2000, high: 3000, settleBy: '2026-05' });
    await saveWishEstimate(db, ann.id, watch.id, { low: 2000, high: 3000, settleBy: '2026-07' });
    await saveWishEstimate(db, ann.id, watch.id, { low: 2000, high: 3000 });
    const v = (await wishView(db, ann.id, watch.id, { now: NOW }))!;
    expect(v.estimates).toHaveLength(4);
    const by = new Map(v.estimates.map((e) => [e.settleBy, e]));
    expect(by.get('2026-04')!.outcome).toEqual({ is: 'over', day: '2026-04-30', level: 2500 });
    expect(by.get('2026-04')!.risks).toEqual([
      { kind: 'rerelease' },
      { kind: 'other', text: 'a port is rumored' },
    ]);
    expect(by.get('2026-04')!.author).toBe('ann');
    // A month over with no level on its last day is unknown, never pending (item 6).
    expect(by.get('2026-05')!.outcome).toEqual({
      is: 'unknown',
      day: '2026-05-31',
      level: null,
      why: 'no_level',
    });
    expect(by.get('2026-07')!.outcome!.is).toBe('pending');
    expect(by.get(null)!.outcome).toMatchObject({ is: 'unknown', why: 'no_month' });
  });

  it("pending only until its month's last day is read; scored in its own condition only (items 6, 9)", async () => {
    const { watch, product } = await gameWish();
    await saveWishLevel(db, {
      productId: product.id,
      bucket: watch.bucket,
      series: [level('2026-05-31', 2600)],
      record: null,
      bornOn: null,
      inputsHash: 'h',
      computedAt: NOW.toISOString(),
    });
    await saveWishEstimate(db, ann.id, watch.id, { low: 2000, high: 3000, settleBy: '2026-05' });
    // On June 1 the night of May 31 is not read yet: pending.
    let v = (await wishView(db, ann.id, watch.id, { now: new Date('2026-05-31T23:00:00Z') }))!;
    expect(v.estimates[0]!.outcome!.is).toBe('pending');
    v = (await wishView(db, ann.id, watch.id, { now: NOW }))!;
    expect(v.estimates[0]!.bucket).toBe('cond:good');
    expect(v.estimates[0]!.outcome).toEqual({ is: 'inside', day: '2026-05-31', level: 2600 });
    // After a change of condition, the estimate is not scored against the new level.
    await setWishCondition(db, ann.id, watch.id, 'like_new');
    await saveWishLevel(db, {
      productId: product.id,
      bucket: 'cond:like_new',
      series: [level('2026-05-31', 9000)],
      record: null,
      bornOn: null,
      inputsHash: 'h',
      computedAt: NOW.toISOString(),
    });
    v = (await wishView(db, ann.id, watch.id, { now: NOW }))!;
    expect(v.estimates[0]!.outcome).toEqual({
      is: 'other_condition',
      day: '2026-05-31',
      level: null,
    });
    // One stored before the bucket was kept is never scored either.
    await db.update(wishEstimates).set({ bucket: null });
    v = (await wishView(db, ann.id, watch.id, { now: NOW }))!;
    expect([v.estimates[0]!.bucket, v.estimates[0]!.outcome!.is]).toEqual([
      null,
      'other_condition',
    ]);
  });

  it('refuses a range that cannot be right', async () => {
    const { watch } = await gameWish();
    for (const input of [
      { low: 0, high: 10 },
      { low: 20, high: 10 },
      { low: 1.5, high: 10 },
      { low: 1, high: 10, settleBy: '2026-13' },
      { low: 1, high: 10, basis: 'luck' },
      { low: 1, high: 10, risks: [{ kind: 'weather' }] },
    ])
      await expect(saveWishEstimate(db, ann.id, watch.id, input)).rejects.toMatchObject({
        code: 'invalid_input',
      });
  });

  it("removing the wish removes its estimates; another person's stay", async () => {
    const { watch, product } = await gameWish();
    const { watch: bobs } = await addWatch(db, bob.id, { productId: product.id }, {});
    await db.update(watches).set({ bucket: 'cond:good' }).where(eq(watches.id, bobs.id));
    await saveWishEstimate(db, ann.id, watch.id, { low: 1, high: 2 });
    await saveWishEstimate(db, bob.id, bobs.id, { low: 3, high: 4 });
    await removeWatch(db, ann.id, watch.id);
    const left = await db.select().from(wishEstimates);
    expect(left.map((e) => e.userId)).toEqual([bob.id]);
  });
});

describe('facts', () => {
  it('shared per item; taken back by its author or an admin only, never deleted', async () => {
    const { watch, product } = await gameWish();
    const { watch: bobs } = await addWatch(db, bob.id, { productId: product.id }, {});
    const { watch: admins } = await addWatch(db, admin.id, { productId: product.id }, {});
    const fact = await recordItemFact(db, ann.id, watch.id, {
      day: '2026-06-01',
      kind: 'port',
      text: 'announced for Beta Box',
      sourceUrl: 'https://example.test/news',
    });
    const seen = (await wishView(db, bob.id, bobs.id, { now: NOW }))!.recorded;
    expect(seen.map((f) => [f.text, f.recordedByName, f.mayDelete])).toEqual([
      ['announced for Beta Box', 'ann', false],
    ]);
    await expect(withdrawItemFact(db, bob, bobs.id, fact.id)).rejects.toMatchObject({
      code: 'forbidden',
    });
    expect(
      (await wishView(db, admin.id, admins.id, { now: NOW, role: 'admin' }))!.recorded[0]!
        .mayDelete,
    ).toBe(true);
    await withdrawItemFact(db, admin, admins.id, fact.id);
    expect((await wishView(db, ann.id, watch.id, { now: NOW }))!.recorded).toEqual([]);
    // Append-only: the fact is kept, a later row takes it back.
    expect(await db.select().from(itemFacts)).toHaveLength(2);
    // The author may take back their own.
    const own = await recordItemFact(db, ann.id, watch.id, { day: NIGHT, kind: 'price_cut' });
    await withdrawItemFact(db, ann, watch.id, own.id);
    expect((await wishView(db, ann.id, watch.id, { now: NOW }))!.recorded).toEqual([]);
  });

  it('refuses a bad day, kind or link', async () => {
    const { watch } = await gameWish();
    for (const input of [
      { day: '2026-02-30', kind: 'port' },
      { day: NIGHT, kind: 'gossip' },
      { day: NIGHT, kind: 'other' },
      { day: NIGHT, kind: 'port', sourceUrl: 'javascript:alert(1)' },
    ])
      await expect(recordItemFact(db, ann.id, watch.id, input)).rejects.toMatchObject({
        code: 'invalid_input',
      });
  });
});

describe('the wish condition and price', () => {
  it('a change follows the bucket and keeps the target; a collision is refused', async () => {
    const { watch, product } = await gameWish();
    await setWishTarget(db, ann.id, watch.id, 2500);
    const changed = await setWishCondition(db, ann.id, watch.id, 'like_new');
    expect([changed.bucket, changed.targetPriceBase]).toEqual(['cond:like_new', 2500]);
    await addGameWish(db, ann.id, {
      name: 'Star Rover',
      console: 'alpha',
      reuse: product.id,
      watch: { condition: 'new_unused' },
    });
    await expect(setWishCondition(db, ann.id, watch.id, 'new_unused')).rejects.toMatchObject({
      code: 'duplicate_watch',
    });
    await expect(setWishCondition(db, ann.id, watch.id, 'poor')).rejects.toMatchObject({
      code: 'invalid_input',
    });
  });

  it('a stored damaged condition saved as fair is kept; no condition has no level (item 8)', async () => {
    const { watch } = await gameWish();
    await db
      .update(watches)
      .set({ condition: 'damaged', bucket: 'cond:fair' })
      .where(eq(watches.id, watch.id));
    const same = await setWishCondition(db, ann.id, watch.id, 'minor_damage');
    expect([same.condition, same.bucket]).toEqual(['damaged', 'cond:fair']);
    await db.update(watches).set({ condition: null, bucket: '' }).where(eq(watches.id, watch.id));
    const v = (await wishView(db, ann.id, watch.id, { now: NOW }))!;
    expect([v.needsCondition, v.level, v.levelStored]).toEqual([true, null, false]);
    const set = await setWishCondition(db, ann.id, watch.id, 'like_new');
    expect(set.bucket).toBe('cond:like_new');
  });
});
