import type { CollectorContext, PoliteHttp } from '@tora/collector-sdk';
import type { Product, ProductSource } from '@tora/db';
import { afterEach, expect, it, vi } from 'vitest';
import { ebay, gradeOf, groupListings, resetEbayToken } from '../src/ebay';

const product = {
  id: 'P1',
  category: 'tcg',
  kind: 'single',
  name: 'ピカチュウ',
  franchise: 'pokemon',
  region: 'jp',
  setCode: 'S-P',
  cardNumber: '208',
  setName: 'YU NAGABA×ポケモンカードゲーム',
} as Product;
const item = (id: string, title: string, usd: string) => ({
  itemId: id,
  title,
  price: { value: usd, currency: 'USD' },
  itemWebUrl: `https://www.ebay.com/itm/${id}`,
});
const items = [
  item('1', 'Pokemon Card Pikachu 208/S-P Yu Nagaba Japanese Promo NM', '45.00'),
  item('2', 'Yu Nagaba Pikachu 208/S-P Japanese promo sealed', '50.00'),
  item('3', 'PSA 10 Pikachu Yu Nagaba 208/S-P Japanese', '180.00'),
  item('4', 'Pikachu Yu Nagaba Japanese Promo 208 lot of 5', '200.00'),
  item('5', 'Pikachu Yu Nagaba English promo 208', '20.00'),
  item('6', 'Eevee Yu Nagaba 209/S-P Japanese', '30.00'),
];

afterEach(() => {
  vi.unstubAllGlobals();
  resetEbayToken();
});

it('reads grades and keeps only listings of this one card, per condition', () => {
  expect(gradeOf('PSA 10 Pikachu')).toBe('graded:PSA:10');
  expect(gradeOf('BGS 9.5 Gem Mint')).toBe('graded:BGS:9.5');
  expect(gradeOf('Pikachu NM')).toBeNull();
  const groups = groupListings(product, items);
  expect([...groups.keys()]).toEqual([null, 'graded:PSA:10']);
  expect(groups.get(null)!.map((i) => i.itemId)).toEqual(['1', '2']);
});

it('saves the median ask per condition in dollars and yen, with the search it built', async () => {
  vi.stubEnv('EBAY_CLIENT_ID', 'id');
  vi.stubEnv('EBAY_CLIENT_SECRET', 'secret');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ access_token: 'T', expires_in: 7200 })),
  );
  const asked: { url: string; headers: Record<string, string> }[] = [];
  const http = {
    json: async (url: string, headers: Record<string, string>) => {
      asked.push({ url, headers });
      return { itemSummaries: items, total: 6 };
    },
  } as unknown as PoliteHttp;
  const saved: Record<string, unknown>[] = [];
  const ctx: CollectorContext = {
    http,
    now: new Date('2026-10-12T03:00:00Z'),
    log: () => {},
    save: async (rows) => (saved.push(...(rows as never[])), rows.length),
    fx: async () => ({ date: '2026-10-09', rate: 150 }),
    linkedListings: async () => [{ source: 'tcgcsv', title: 'Pikachu - 208/S-P' }],
  };
  const link = {
    id: 'L1',
    query: { keywords: [], extra: { auto: true, v: 1 } },
  } as unknown as ProductSource;
  const result = await ebay.collect(link, product, ctx);
  expect(new URL(asked[0]!.url).searchParams.get('q')).toBe('Pikachu 208/S-P japanese');
  expect(asked[0]!.headers).toMatchObject({
    Authorization: 'Bearer T',
    'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
  });
  expect(result.query?.keywords).toEqual(['Pikachu 208/S-P japanese']);
  expect(saved).toEqual([
    expect.objectContaining({
      bucket: null,
      priceOriginal: 4750,
      priceJpy: 7125,
      currency: 'USD',
      observationType: 'listing',
      externalRef: 'P1|ungraded|2026-10-12',
      raw: expect.objectContaining({ count: 2, min: 45, ids: ['1', '2'], subType: 'Ungraded' }),
    }),
    expect.objectContaining({ bucket: 'graded:PSA:10', priceOriginal: 18000 }),
  ]);
});
