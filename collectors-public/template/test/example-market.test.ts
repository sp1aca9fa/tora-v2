import type { CollectorContext, PoliteHttp, PriceInput } from '@tora/collector-sdk';
import type { Product, ProductSource } from '@tora/db';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { BASE, bucketOf, exampleMarket } from '../src/example-market';

// The site's answers saved as files (fixtures): tests never reach the network. With a real site,
// save a page once by hand (made-up data, nothing personal) and keep it next to the test.
const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8')) as unknown;

const requested: string[] = [];
const http = {
  json: async (url: string) => {
    requested.push(url.replace(BASE, ''));
    if (url.includes('/api/search')) return fixture('search.json');
    const page = new URL(url).searchParams.get('page');
    return fixture(`sales-${page}.json`);
  },
} as unknown as PoliteHttp;

const saved: PriceInput[] = [];
const ctx: CollectorContext = {
  http,
  now: new Date('2026-10-15T03:00:00Z'),
  log: () => {},
  save: async (rows) => (saved.push(...rows), rows.length),
};

const card = {
  id: 'P1',
  category: 'tcg',
  kind: 'single',
  itemType: null,
  name: 'ピカチュウ',
  cardNumber: '025/100',
} as Product;
const link = (state: unknown) =>
  ({
    externalId: 'c-1001',
    url: 'https://example-market.test/items/c-1001',
    state,
  }) as ProductSource;

it('handles cards only', () => {
  expect(exampleMarket.supports(card)).toBe(true);
  expect(exampleMarket.supports({ ...card, kind: 'booster_box' })).toBe(false);
});

it('finds candidates, the same card first', async () => {
  const found = await exampleMarket.findCandidates(card, ctx);
  expect(found.map((c) => [c.externalId, c.score])).toEqual([
    ['c-1001', 1],
    ['c-1002', 0.6],
  ]);
});

it('reads conditions as buckets', () => {
  expect(bucketOf('A')).toBe('raw:A');
  expect(bucketOf('PSA 10')).toBe('graded:PSA:10');
  expect(bucketOf('美品')).toBeNull();
});

it('backfills the history, then only adds new sales', async () => {
  saved.length = 0;
  requested.length = 0;
  const first = await exampleMarket.collect(link(null), card, ctx);
  expect(first).toMatchObject({ complete: true, state: { through: '2026-10-14T21:10:00+09:00' } });
  // Both pages; the sale in an unreadable condition is left out.
  expect(requested).toEqual(['/api/items/c-1001/sales?page=1', '/api/items/c-1001/sales?page=2']);
  expect(saved.map((r) => [r.externalRef, r.bucket, r.price, r.currency])).toEqual([
    ['t-905', 'raw:A', 5200, 'JPY'],
    ['t-904', 'graded:PSA:10', 31000, 'JPY'],
    ['t-903', 'raw:A', 4900, 'JPY'],
    ['t-902', 'raw:B', 3500, 'JPY'],
  ]);

  // Next run: the first page reaches what is saved, so it stops there.
  saved.length = 0;
  requested.length = 0;
  const next = await exampleMarket.collect(link(first.state), card, ctx);
  expect(next).toMatchObject({ complete: true, state: { through: '2026-10-14T21:10:00+09:00' } });
  expect(requested).toEqual(['/api/items/c-1001/sales?page=1']);
  expect(saved).toEqual([]);
});

it('resumes a backfill the page budget cut short', async () => {
  saved.length = 0;
  requested.length = 0;
  const resumed = await exampleMarket.collect(
    link({ resumePage: 2, pendingNewest: '2026-10-14T21:10:00+09:00' }),
    card,
    ctx,
  );
  expect(requested).toEqual(['/api/items/c-1001/sales?page=2']);
  expect(resumed).toMatchObject({
    complete: true,
    state: { through: '2026-10-14T21:10:00+09:00' },
  });
});
