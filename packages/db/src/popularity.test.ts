import { describe, expect, it } from 'vitest';
import { type ItemTrades, rankPopular } from './popularity';

const item = (id: string, over: Partial<ItemTrades>): ItemTrades => ({
  productId: id,
  itemType: 'card',
  sold30: {},
  steady30: 0,
  before90: 0,
  sold365: 0,
  ...over,
});

describe('rankPopular', () => {
  const saved = {
    day: '2026-10-28',
    items: [
      item('busy', { sold30: { a: 50, b: 30 }, steady30: 80, before90: 240, sold365: 900 }),
      item('rising', { sold30: { a: 30 }, steady30: 30, before90: 30, sold365: 100 }),
      // Followed only lately: no history to call it trending.
      item('new', { sold30: { a: 60 }, steady30: 0, before90: 0, sold365: 60 }),
      item('box', { itemType: 'sealed', sold30: { a: 99 }, sold365: 99 }),
    ],
  };

  it('ranks by trades over 30 days on every site, or the year', () => {
    expect(rankPopular(saved, 'card', 'sold').map((i) => i.productId)).toEqual([
      'busy',
      'new',
      'rising',
    ]);
    expect(rankPopular(saved, 'card', 'year')[0]!.productId).toBe('busy');
  });

  it('trending: 1.5x the usual monthly trades, with enough history', () => {
    expect(rankPopular(saved, 'card', 'trending').map((i) => i.productId)).toEqual(['rising']);
  });
});
