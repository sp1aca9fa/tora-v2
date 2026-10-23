import type { CollectorContext, PoliteHttp } from '@tora/collector-sdk';
import type { Product, ProductSource } from '@tora/db';
import { expect, it } from 'vitest';
import { tcgdex } from '../src/tcgdex';

// Synthetic TCGdex answers (same shape as api.tcgdex.net).
const answers: Record<string, unknown> = {
  'sets?abbreviation.official=eq:EVS': [{ id: 'swsh7', name: 'Evolving Skies' }],
  'sets?id=eq:EVS': [],
  'sets/swsh7': {
    id: 'swsh7',
    name: 'Evolving Skies',
    cardCount: { official: 203 },
    cards: [
      { id: 'swsh7-21', localId: '21', name: 'Leafeon', image: 'https://assets.test/21' },
      {
        id: 'swsh7-215',
        localId: '215',
        name: 'Umbreon VMAX',
        image: 'https://assets.test/215',
      },
    ],
  },
  'cards/swsh7-215': {
    id: 'swsh7-215',
    localId: '215',
    name: 'Umbreon VMAX',
    image: 'https://assets.test/215',
    set: { name: 'Evolving Skies', cardCount: { official: 203 } },
    pricing: {
      cardmarket: {
        updated: '2026-10-23T12:51:07.918Z',
        unit: 'EUR',
        idProduct: 574273,
        avg: 1830.92,
        low: 250,
        trend: 1416.73,
        avg1: 220,
        avg7: 1935.33,
        avg30: 1775.7,
      },
    },
  },
  'cards/swsh7-21': {
    id: 'swsh7-21',
    localId: '21',
    name: 'Leafeon',
    set: { name: 'Evolving Skies', cardCount: { official: 203 } },
    pricing: { cardmarket: null },
  },
};
const http = {
  json: async (url: string) => {
    const key = url.replace('https://api.tcgdex.net/v2/en/', '');
    if (!(key in answers)) throw new Error(`unexpected ${url}`);
    return answers[key];
  },
} as unknown as PoliteHttp;

const saved: unknown[] = [];
const ctx: CollectorContext = {
  http,
  now: new Date('2026-10-23T15:00:00Z'),
  log: () => {},
  save: async (rows) => (saved.push(...rows), rows.length),
};
const product = (p: Partial<Product>) =>
  ({
    id: 'P1',
    category: 'tcg',
    franchise: 'pokemon',
    region: 'en',
    kind: 'single',
    setCode: null,
    cardNumber: null,
    ...p,
  }) as Product;

it('finds an international card by its printed set code and number', async () => {
  const card = product({ setCode: 'EVS', cardNumber: '215/203' });
  expect(tcgdex.supports(card)).toBe(true);
  expect(tcgdex.supports(product({ region: 'jp' }))).toBe(false);
  expect(tcgdex.supports(product({ kind: 'booster_box' }))).toBe(false);
  expect(await tcgdex.findCandidates(card, ctx)).toEqual([
    {
      externalId: 'swsh7-215',
      title: 'Umbreon VMAX 215/203 (Evolving Skies)',
      url: 'https://api.tcgdex.net/v2/en/cards/swsh7-215',
      imageUrl: 'https://assets.test/215/low.webp',
      score: 0.9,
    },
  ]);
  // Zero padding does not matter; no number, no search.
  const padded = await tcgdex.findCandidates(product({ setCode: 'EVS', cardNumber: '021' }), ctx);
  expect(padded.map((c) => c.externalId)).toEqual(['swsh7-21']);
  expect(await tcgdex.findCandidates(product({ setCode: 'EVS' }), ctx)).toEqual([]);
});

it("saves Cardmarket's trend as one near-mint sale a day, in euro cents", async () => {
  saved.length = 0;
  const link = { externalId: 'swsh7-215', url: null, state: null } as unknown as ProductSource;
  const result = await tcgdex.collect(link, product({}), ctx);
  expect(result).toMatchObject({ complete: true, title: 'Umbreon VMAX 215/203 (Evolving Skies)' });
  expect(saved).toEqual([
    expect.objectContaining({
      source: 'tcgdex',
      observationType: 'sold',
      bucket: 'raw:A',
      price: 141673,
      currency: 'EUR',
      externalRef: expect.stringMatching(/^574273\|2026-10-2[34]$/),
    }),
  ]);

  // A card without a Cardmarket price saves nothing.
  saved.length = 0;
  await tcgdex.collect({ ...link, externalId: 'swsh7-21' }, product({}), ctx);
  expect(saved).toEqual([]);
});
