import type { EffectiveRules } from '@tora/core';
import { describe, expect, it } from 'vitest';
import {
  OFFERS_CONFIRMED,
  OFFERS_UNCONFIRMED,
  passingListings,
  storedOffer,
  supplyWithOffers,
} from './offers';
import type { FoundListing, FoundSearch, ItemRulesContext } from './types';

// Made-up console, category and titles only (no real marketplace category number).
const itemRules = (over: Partial<ItemRulesContext> = {}): ItemRulesContext => ({
  rules: {
    console: 'alpha',
    region: null,
    edition: null,
    required: [],
    excluded: ['lot'],
    boxed: false,
    boxedOf: null,
    categories: { flea: '111' },
    own: true,
  } as EffectiveRules,
  hash: 'h',
  listingsConfirmed: false,
  notItemRefs: new Set(),
  ...over,
});
const listing = (ref: string, price: number, over: Partial<FoundListing> = {}): FoundListing => ({
  ref,
  title: 'Hero Quest',
  url: `https://flea.example/${ref}`,
  price,
  currency: 'JPY',
  seller: null,
  category: '111',
  shippingPayerId: null,
  ...over,
});
const search = (found: FoundListing[], over: Partial<FoundSearch> = {}): FoundSearch => ({
  buckets: [{ bucket: 'used', found, foundFloor: null }],
  foundCapped: false,
  currency: 'JPY',
  raw: { more: false },
  ...over,
});
const floored = (found: FoundListing[], foundFloor: number): FoundSearch => ({
  ...search(found),
  buckets: [{ bucket: 'used', found, foundFloor }],
});

describe('passingListings', () => {
  it('keeps what passes the words, the category, the marks and the line, cheapest first', () => {
    const found = [
      listing('e', 3000),
      listing('a', 900, { title: 'Hero Quest lot' }),
      listing('b', 950, { category: '999' }),
      listing('c', 1000, { category: null }),
      listing('d', 400),
      listing('f', 2000),
      listing('g', 2000),
      listing('m', 1200),
    ];
    const kept = passingListings(found, 500, itemRules({ notItemRefs: new Set(['m']) }), 'flea');
    // Unknown category: judged on the title only; under the line (400 < 500) left out.
    expect(kept.map((l) => l.ref)).toEqual(['c', 'f', 'g', 'e']);
  });

  it('takes a price on the line, and no line when the plug-in has none', () => {
    expect(passingListings([listing('a', 500)], 500, itemRules(), 'flea')).toHaveLength(1);
    expect(passingListings([listing('a', 1)], null, itemRules(), 'flea')).toHaveLength(1);
    expect(passingListings([], 500, itemRules(), 'flea')).toEqual([]);
  });

  it('a source without a console category judges the title only', () => {
    const kept = passingListings(
      [listing('a', 1000, { category: '999' })],
      null,
      itemRules(),
      'auction',
    );
    expect(kept).toHaveLength(1);
  });
});

describe('supplyWithOffers', () => {
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) => listing(`r${String(i).padStart(2, '0')}`, 1000 + i * 10));

  it('stores the cheapest 20 until confirmed, then 5; the count is how many passed', () => {
    const [open] = supplyWithOffers(search(many(30), { foundCapped: true }), itemRules(), 'flea');
    expect(open!.offers).toHaveLength(OFFERS_UNCONFIRMED);
    expect(open!.listings).toBe(30);
    expect(open!.lowestAsk).toBe(1000);
    expect(open!.url).toBe('https://flea.example/r00');
    expect(open!.listingsCapped).toBe(true);
    expect(open!.raw).toEqual({ more: false });
    const [done] = supplyWithOffers(
      search(many(30)),
      itemRules({ listingsConfirmed: true }),
      'flea',
    );
    expect(done!.offers!.map((o) => o.ref)).toEqual(['r00', 'r01', 'r02', 'r03', 'r04']);
    expect(done!.offers).toHaveLength(OFFERS_CONFIRMED);
    expect(done!.listings).toBe(30);
    expect(done!.listingsCapped).toBe(false);
  });

  it('5 marked cheapest listings and a real sixth: the sixth is stored and is the ask', () => {
    const found = many(6);
    const marked = new Set(found.slice(0, 5).map((l) => l.ref));
    const [out] = supplyWithOffers(
      search(found),
      itemRules({ listingsConfirmed: true, notItemRefs: marked }),
      'flea',
    );
    expect(out!.offers!.map((o) => o.ref)).toEqual(['r05']);
    expect(out!.lowestAsk).toBe(1050);
    expect(out!.listings).toBe(1);
  });

  it('keeps the line as the plug-in gave it', () => {
    const [out] = supplyWithOffers(
      floored([listing('cheap', 299), listing('ok', 300)], 300),
      itemRules(),
      'flea',
    );
    expect(out!.offers!.map((o) => o.ref)).toEqual(['ok']);
  });

  it("equal prices keep the plug-in's order: its first is the ask", () => {
    const [out] = supplyWithOffers(
      search([listing('z', 1000), listing('a', 1000)]),
      itemRules(),
      'flea',
    );
    expect([out!.url, out!.offers!.map((o) => o.ref)]).toEqual([
      'https://flea.example/z',
      ['z', 'a'],
    ]);
  });

  it('a condition where none passed: no ask, no offers; 0 listings only when the search showed all', () => {
    const lots = [listing('a', 1000, { title: 'Hero Quest lot' })];
    const empty = (listings: number | null, listingsCapped: boolean | null) => ({
      bucket: 'used',
      lowestAsk: null,
      currency: 'JPY',
      listings,
      url: null,
      raw: { more: false },
      offers: [],
      listingsCapped,
    });
    expect(supplyWithOffers(search(lots), itemRules(), 'flea')).toEqual([empty(0, false)]);
    // The search may hold more (real copies past what was read): the count is unknown, not 0.
    expect(supplyWithOffers(search(lots, { foundCapped: true }), itemRules(), 'flea')).toEqual([
      empty(null, true),
    ]);
    expect(supplyWithOffers(search(lots, { foundCapped: null }), itemRules(), 'flea')).toEqual([
      empty(null, null),
    ]);
  });

  it('a condition the search found nothing in gets no row', () => {
    expect(supplyWithOffers(search([], { buckets: [] }), itemRules(), 'flea')).toEqual([]);
  });

  it('an unknown cap stays unknown', () => {
    const [out] = supplyWithOffers(
      search([listing('a', 1000)], { foundCapped: null }),
      itemRules(),
      'flea',
    );
    expect(out!.listingsCapped).toBeNull();
  });
});

describe('storedOffer', () => {
  it('keeps the payer id as given and shipping unknown; seller and category stay unknown', () => {
    expect(
      storedOffer(listing('a', 1000, { shippingPayerId: '2', seller: 's9' }), 1000),
    ).toMatchObject({
      seller: 's9',
      shipping: 'unknown',
      shippingPayerId: '2',
    });
    expect(storedOffer(listing('a', 1000, { category: null }), 7)).toEqual({
      ref: 'a',
      title: 'Hero Quest',
      url: 'https://flea.example/a',
      priceBase: 7,
      priceOriginal: 1000,
      currency: 'JPY',
      seller: null,
      category: null,
      shipping: 'unknown',
      shippingPayerId: null,
    });
  });
});
