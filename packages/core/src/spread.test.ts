import { expect, it } from 'vitest';
import {
  type SpreadLot,
  eraOf,
  heldLittle,
  priceLevelOf,
  spreadLots,
  spreadOf,
  spreadSetName,
} from './spread';

const lot = (over: Partial<SpreadLot>): SpreadLot => ({
  productId: 'p',
  value: 1000,
  atCost: false,
  units: 1,
  type: 'card',
  franchise: 'pokemon',
  set: 'Set A',
  released: '2024-03-01',
  ...over,
});

it('shares the value by group, biggest first, and flags heavy groups and items', () => {
  const s = spreadOf([
    lot({ productId: 'a', value: 60_000, units: 2, type: 'sealed', set: 'Set A' }),
    lot({ productId: 'b', value: 30_000, set: 'Set B', released: '2019-01-01' }),
    lot({ productId: 'c', value: 10_000, units: 2, set: null, released: null, franchise: null }),
    lot({ productId: 'd', value: 0 }),
  ]);
  expect(s.total).toBe(100_000);
  expect(s.dimensions.set.map((g) => [g.key, g.share, g.heavy])).toEqual([
    ['Set A', 0.6, true],
    ['Set B', 0.3, false],
    ['', 0.1, false],
  ]);
  // One franchise is normal: never heavy.
  expect(s.dimensions.franchise[0]).toMatchObject({ key: 'pokemon', share: 0.9, heavy: false });
  expect(s.dimensions.era.map((g) => g.key)).toEqual(['2024', '2016-2019', '']);
  // A unit's value: 30,000 each for a's two units.
  expect(s.dimensions.price.map((g) => [g.key, g.value])).toEqual([
    ['lt100k', 90_000],
    ['lt10k', 10_000],
  ]);
  expect(s.heavyItems.map((i) => i.productId)).toEqual(['a', 'b']);
});

it('reads eras and price levels at their edges', () => {
  expect(['2015-12-31', '2016', '2022-12-31', '2023-01-01', null, 'x'].map(eraOf)).toEqual([
    'before2016',
    '2016-2019',
    '2020-2022',
    '2023',
    '',
    '',
  ]);
  expect([999, 1_000, 99_999, 100_000].map(priceLevelOf)).toEqual([
    'lt1k',
    'lt10k',
    'lt100k',
    'gte100k',
  ]);
});

it('points to groups held little that have items worth a look', () => {
  const groups = spreadOf([
    lot({ productId: 'a', value: 97_000, type: 'card' }),
    lot({ productId: 'b', value: 3_000, type: 'sealed' }),
  ]).dimensions.type;
  const worth = new Map([
    ['card', 5],
    ['sealed', 2],
    ['other', 4],
    ['', 9],
  ]);
  expect(heldLittle(groups, worth)).toEqual([
    { key: 'other', share: 0, worth: 4 },
    { key: 'sealed', share: 0.03, worth: 2 },
  ]);
});

it('has nothing to say about an empty collection', () => {
  const s = spreadOf([]);
  expect([s.total, s.dimensions.type, s.heavyItems]).toEqual([0, [], []]);
});

it('counts lots counted in value, at cost with no market price, sets apart by franchise', () => {
  const product = (id: string, franchise: string | null, setName: string | null) => ({
    id,
    franchise,
    setName,
    setCode: null,
    releaseDate: null,
  });
  const holding = { quantity: 1, costTotalBase: 4000, countInValue: true };
  const type = 'sealed';
  const lots = spreadLots(
    [
      { holding, product: product('a', 'pokemon', 'Promo'), valueBase: 6000, type },
      { holding, product: product('b', 'ポケモン', 'Promo'), valueBase: null, type },
      { holding, product: product('c', 'one_piece', 'Promo'), valueBase: 5000, type },
      {
        holding: { ...holding, countInValue: false },
        product: product('d', null, null),
        valueBase: 9,
        type,
      },
    ],
    (f) => (f === 'ポケモン' ? 'pokemon' : f),
  );
  expect(lots.map((l) => [l.productId, l.value, l.atCost, l.franchise, l.set])).toEqual([
    ['a', 6000, false, 'pokemon', 'pokemon|Promo'],
    ['b', 4000, true, 'pokemon', 'pokemon|Promo'],
    ['c', 5000, false, 'one_piece', 'one_piece|Promo'],
  ]);
  const s = spreadOf(lots);
  expect([s.atCost, s.atCostLots]).toEqual([4000, 1]);
  expect(s.dimensions.set.map((g) => [spreadSetName(g.key), g.value])).toEqual([
    ['Promo', 10_000],
    ['Promo', 5000],
  ]);
  // The only item type there is: not heavy.
  expect(s.dimensions.type).toMatchObject([{ key: 'sealed', share: 1, heavy: false }]);
});
