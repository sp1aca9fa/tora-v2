import type { CollectorContext, PoliteHttp } from '@tora/collector-sdk';
import type { Product, ProductSource } from '@tora/db';
import { expect, it } from 'vitest';
import { groupSlug, tcgcsv } from '../src/tcgcsv';

// Synthetic TCGCSV files (same shape as tcgcsv.com).
const files: Record<string, unknown> = {
  '/85/groups': {
    results: [
      {
        groupId: 1,
        name: 'SV9: Battle Partners',
        abbreviation: 'SV9',
        publishedOn: '2025-01-24T00:00:00',
      },
      {
        groupId: 2,
        name: 'SV-P Promotional Cards',
        abbreviation: 'SV-P',
        publishedOn: '2022-12-02T00:00:00',
      },
    ],
  },
  '/85/1/products': {
    results: [
      {
        productId: 11,
        name: "Lillie's Ribombee - 105/100",
        url: 'https://www.tcgplayer.com/product/11/pokemon-japan-sv9-battle-partners-lillies-ribombee',
        imageUrl: 'i11',
        extendedData: [{ name: 'Number', value: '105/100' }],
      },
      {
        productId: 12,
        name: 'Battle Partners Booster Box',
        url: 'u12',
        imageUrl: 'i12',
        extendedData: [],
      },
      {
        productId: 13,
        name: 'Battle Partner Booster Pack',
        url: 'u13',
        imageUrl: 'i13',
        extendedData: [],
      },
    ],
  },
  '/85/1/prices': {
    results: [
      {
        productId: 11,
        lowPrice: 20,
        midPrice: 25,
        highPrice: 40,
        marketPrice: 23.5,
        subTypeName: 'Holofoil',
      },
      {
        productId: 12,
        lowPrice: 90,
        midPrice: 100,
        highPrice: 150,
        marketPrice: null,
        subTypeName: 'Normal',
      },
    ],
  },
};
const http = {
  json: async (url: string) => {
    const key = url.replace('https://tcgcsv.com/tcgplayer', '');
    if (!(key in files)) throw new Error(`unexpected ${url}`);
    return files[key];
  },
  text: async () => '2026-10-10T20:06:02+0000',
} as unknown as PoliteHttp;

const saved: unknown[] = [];
const ctx: CollectorContext = {
  http,
  now: new Date('2026-10-11T03:00:00Z'),
  log: () => {},
  save: async (rows) => (saved.push(...rows), rows.length),
  fx: async () => ({ date: '2026-10-09', rate: 150 }),
  setOf: async (p) =>
    p.setName === 'バトルパートナーズ' ? { code: 'SV9', releaseDate: '2025-01-24' } : null,
};
const product = (p: Partial<Product>) =>
  ({
    id: 'P1',
    category: 'tcg',
    franchise: 'pokemon',
    region: 'jp',
    setCode: null,
    setName: null,
    cardNumber: null,
    releaseDate: null,
    ...p,
  }) as Product;

it('finds a card by set code and number, and a box by its catalog set', async () => {
  const card = product({ kind: 'single', setCode: 'sv9', cardNumber: '105/100' });
  expect(tcgcsv.supports(card)).toBe(true);
  expect(tcgcsv.supports(product({ kind: 'single', region: 'zh_tw' }))).toBe(false);
  const [found] = await tcgcsv.findCandidates(card, ctx);
  expect(found).toMatchObject({
    externalId: '11',
    title: "Lillie's Ribombee - 105/100 (SV9: Battle Partners)",
    score: 0.9,
  });

  const box = product({ kind: 'booster_box', setName: 'バトルパートナーズ' });
  const list = await tcgcsv.findCandidates(box, ctx);
  // The box only: not its packs, nor the cards.
  expect(list).toEqual([expect.objectContaining({ externalId: '12', score: 0.8 })]);
  const pack = await tcgcsv.findCandidates(
    product({ kind: 'booster_pack', setName: 'バトルパートナーズ' }),
    ctx,
  );
  expect(pack.map((c) => c.externalId)).toEqual(['13']);
});

it('saves the market price in dollars and yen, finding the set from the listing link', async () => {
  const link = {
    externalId: '11',
    url: 'https://www.tcgplayer.com/product/11/pokemon-japan-sv9-battle-partners-lillies-ribombee',
    state: null,
  } as unknown as ProductSource;
  const result = await tcgcsv.collect(link, product({ kind: 'single' }), ctx);
  expect(result).toMatchObject({ state: { groupId: 1 }, title: "Lillie's Ribombee - 105/100" });
  expect(saved).toEqual([
    expect.objectContaining({
      source: 'tcgcsv',
      observationType: 'listing',
      priceJpy: 3525,
      priceOriginal: 2350,
      currency: 'USD',
      fxRate: 150,
      externalRef: '11|Holofoil|2026-10-11',
    }),
  ]);
});

it('slugs group names like TCGplayer URLs', () => {
  expect(groupSlug('S-P: Sword & Shield Promos')).toBe('s-p-sword-and-shield-promos');
});
