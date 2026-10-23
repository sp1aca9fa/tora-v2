import { describe, expect, it } from 'vitest';
import {
  type SourceRegistry,
  parseListingUrl,
  referenceSource,
  shopOf,
  valuationOrder,
  marketsInUse,
} from './sources';
import { orderSourceOf, singleItemOrders } from './text';
import { valueUnit } from './valuation';

// Example sources (any plug-in describes its own the same way).
const registry: SourceRegistry = {
  sources: [
    {
      key: 'cards',
      label: 'Card Market',
      priority: 10,
      links: [
        { pattern: 'cards\\.example/(?:en/)?item/(\\d+)', url: 'https://cards.example/item/{id}' },
      ],
      aliases: ['Card Market', 'カードマーケット'],
      singleItemOrders: true,
    },
    { key: 'flea', label: 'Flea', priority: 20, aliases: ['フリマ'] },
    { key: 'games', label: 'Game Shop', priority: 30 },
    {
      key: 'abroad',
      label: 'Abroad',
      priority: 40,
      links: [
        {
          pattern: 'abroad\\.example/p/(\\d+)(/[\\w-]*)?',
          url: 'https://abroad.example/p/{id}{rest}',
        },
      ],
    },
    { key: 'retail', label: 'Retail', shopOnly: true, aliases: ['ヨドバシ', 'yodobashi'] },
  ],
  roles: {
    cards: { card: 'reference', sealed: 'reference' },
    flea: { card: 'supporting', sealed: 'supporting', item: 'supporting' },
    games: { sealed: 'supporting', item: 'reference' },
    abroad: { card: 'comparison' },
  },
};

describe('source registry', () => {
  it('orders sources for valuation by role, then priority; comparison ones are not valued', () => {
    expect(valuationOrder(registry, 'card')).toEqual(['cards', 'flea']);
    expect(valuationOrder(registry, 'sealed')).toEqual(['cards', 'flea', 'games']);
    expect(valuationOrder(registry, 'item')).toEqual(['games', 'flea']);
    expect(referenceSource(registry, 'item')).toBe('games');
    expect(
      referenceSource({ ...registry, roles: { flea: { item: 'supporting' } } }, 'item'),
    ).toBeNull();
  });

  it('values from the order: a comparison source never counts', () => {
    const sale = (source: string, priceBase: number) => ({
      source,
      bucket: 'raw:A',
      priceBase,
      observedAt: new Date(Date.now() - 86_400_000).toISOString(),
      observationType: 'sold' as const,
    });
    const observations = [1, 2, 3].flatMap((i) => [
      sale('abroad', 9_000 + i),
      sale('flea', 1_000 + i),
    ]);
    const v = valueUnit({
      bucket: 'raw:A',
      observations,
      sources: valuationOrder(registry, 'card'),
    });
    expect(v).toMatchObject({ source: 'flea', unitBase: 1_002 });
  });

  it('reads pasted listing links', () => {
    expect(
      parseListingUrl(registry, ' https://www.cards.example/en/item/484952?slide=right '),
    ).toEqual({
      source: 'cards',
      externalId: '484952',
      url: 'https://cards.example/item/484952',
    });
    expect(parseListingUrl(registry, 'https://abroad.example/p/12/some-set')?.url).toBe(
      'https://abroad.example/p/12/some-set',
    );
    expect(parseListingUrl(registry, 'https://other.example/item/1')).toBeNull();
    expect(parseListingUrl(registry, 'cards 484952')).toBeNull();
  });

  it('recognises shops in purchase texts', () => {
    expect(shopOf(registry, 'カードマーケット 注文')).toBe('cards');
    expect(orderSourceOf(registry, ' ヨドバシ ')).toBe('retail');
    expect(orderSourceOf(registry, ' Some Shop ')).toBe('some shop');
    expect(orderSourceOf(registry, '')).toBeNull();
    expect(singleItemOrders(registry, 'cards')).toBe(true);
    expect(singleItemOrders(registry, 'retail')).toBe(false);
  });
});

it('collects only the markets in use: primary and secondary, or all when comparing all', () => {
  const sources = [
    { key: 'a', label: 'A', market: 'eu' },
    { key: 'b', label: 'B', market: 'br' },
    { key: 'c', label: 'C', market: 'us' },
  ];
  const markets = { primary: 'eu', secondary: 'br', compare: 'secondary' as const };
  expect([...marketsInUse(sources, markets)].sort()).toEqual(['br', 'eu']);
  expect([...marketsInUse(sources, { ...markets, secondary: null })]).toEqual(['eu']);
  expect([...marketsInUse(sources, { ...markets, compare: 'all' })].sort()).toEqual([
    'br',
    'eu',
    'us',
  ]);
  expect(marketsInUse(sources, undefined).size).toBe(3);
});
