import { describe, expect, it } from 'vitest';
import { type OpeningCard, openingValue, tierOf } from './opening';

const card = (key: string, rarity: string, value: number, name = key): OpeningCard => ({
  key,
  name,
  rarity,
  value,
});

describe('box opening value', () => {
  it('puts each card in its rarity, a named part first', () => {
    const tiers = [
      { rarity: 'SAR', perBox: 1, match: 'ex' },
      { rarity: 'SAR', perBox: 0.4 },
      { rarity: 'AR', perBox: 3 },
    ];
    expect(tierOf(tiers, { name: 'ブースターex', rarity: 'sar' })).toBe(0);
    expect(tierOf(tiers, { name: 'ペパー', rarity: 'SAR' })).toBe(1);
    expect(tierOf(tiers, { name: 'ピカチュウ', rarity: 'ＡＲ' })).toBe(2);
    expect(tierOf(tiers, { name: 'ピカチュウ', rarity: 'C' })).toBe(-1);
  });

  it('averages the hits by their rates and shows which cards carry the value', () => {
    const v = openingValue({
      packsPerBox: 30,
      tiers: [
        { rarity: 'SAR', perBox: 0.2 },
        { rarity: 'AR', perBox: 3 },
      ],
      cards: [
        card('a', 'SAR', 20_000),
        card('b', 'SAR', 4_000),
        card('c', 'AR', 1_000),
        card('d', 'AR', 500),
      ],
      boxPrice: 10_000,
    });
    // 0.2 x 12,000 + 3 x 750
    expect(v.expected).toBe(4_650);
    expect(v.tiers.map((t) => [t.cards, t.average])).toEqual([
      [2, 12_000],
      [2, 750],
    ]);
    expect(v.cards[0]).toMatchObject({ key: 'a', perBox: 0.1, expected: 2_000 });
    expect(v.cards[0]!.share).toBeCloseTo(2_000 / 4_650);
    // Most boxes hold no SAR: the median box is a few ARs, and few boxes pay back 10,000.
    expect(v.median).toBeLessThan(v.expected);
    expect(v.chanceBack).toBeGreaterThan(0.05);
    expect(v.chanceBack).toBeLessThan(0.15);
    expect(v.low).toBeLessThanOrEqual(v.median);
    expect(v.high).toBeGreaterThanOrEqual(v.median);
  });

  it('gives the same spread on every view, and nothing for a tier without cards', () => {
    const input = {
      packsPerBox: 10,
      tiers: [
        { rarity: 'SAR', perBox: 1 },
        { rarity: 'UR', perBox: 0.4 },
      ],
      cards: [card('a', 'SAR', 3_000), card('b', 'SAR', 9_000)],
      boxPrice: 5_000,
    };
    const a = openingValue(input);
    expect(openingValue(input)).toEqual(a);
    expect(a.tiers[1]).toMatchObject({ cards: 0, average: null, expected: 0 });
    expect(a.expected).toBe(6_000);
    expect(openingValue({ ...input, boxPrice: null }).chanceBack).toBeNull();
  });
});
