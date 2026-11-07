import { describe, expect, it } from 'vitest';
import { cleanPotential, hasPotential, potentialHits } from './potential';

const item = (more = {}) => ({
  name: 'Dragon Knight Box',
  nameAlias: 'ドラゴン',
  rarity: 'XR',
  reprint: null,
  ranked: false,
  ...more,
});

describe('cleanPotential', () => {
  it('limits words: 10, 40 characters, trimmed, once whatever the case, only strings', () => {
    const long = 'x'.repeat(50);
    const c = cleanPotential(
      { subjects: [' Dragon ', 'dragon', '', '  ', 3, null, long, ...'abcdefghijkl'] },
      [],
    );
    expect(c.subjects).toEqual(['Dragon', 'x'.repeat(40), ...'abcdefgh']);
    expect(c.subjects).toHaveLength(10);
  });
  it('keeps only rarities in use, the switches only when exactly true', () => {
    const c = cleanPotential(
      { rarities: ['XR', 'XR', 'made up', 1], outOfPrint: 'true', ranked: true },
      ['XR', 'R'],
    );
    expect(c).toEqual({ subjects: [], rarities: ['XR'], outOfPrint: false, ranked: true });
  });
  it('makes nothing of input that is not criteria', () => {
    const empty = { subjects: [], rarities: [], outOfPrint: false, ranked: false };
    for (const input of [null, undefined, 'x', 3, [], { subjects: 'Dragon' }]) {
      expect(cleanPotential(input, ['XR'])).toEqual(empty);
    }
    expect(hasPotential(cleanPotential(null, []))).toBe(false);
  });
});

describe('potentialHits', () => {
  it('has no hits without criteria', () => {
    expect(potentialHits(null, item())).toEqual([]);
    expect(potentialHits({}, item({ ranked: true, reprint: 'none' }))).toEqual([]);
    expect(hasPotential({})).toBe(false);
    expect(hasPotential({ subjects: [], rarities: [], outOfPrint: false, ranked: false })).toBe(
      false,
    );
    expect(hasPotential({ ranked: true })).toBe(true);
  });
  it('matches a word in the name or alias whatever its case or width', () => {
    const value = (word: string, more = {}) =>
      potentialHits({ subjects: [word] }, item(more)).length;
    expect(value('dragon')).toBe(1);
    expect(value('KNIGHT')).toBe(1);
    expect(value('ドラゴン')).toBe(1);
    expect(value('Ｄｒａｇｏｎ')).toBe(1);
    expect(value('wizard')).toBe(0);
    expect(value('dragon', { name: 'Other', nameAlias: null })).toBe(0);
    // Inside a word too: names in Japanese have no word breaks.
    expect(value('rag')).toBe(1);
  });
  it('counts each criterion met, and an unknown value meets none', () => {
    const c = {
      subjects: ['dragon', 'knight', 'wizard'],
      rarities: ['XR', 'R'],
      outOfPrint: true,
      ranked: true,
    };
    expect(potentialHits(c, item({ reprint: 'none', ranked: true }))).toEqual([
      { kind: 'subject', value: 'dragon' },
      { kind: 'subject', value: 'knight' },
      { kind: 'rarity', value: 'XR' },
      { kind: 'out_of_print' },
      { kind: 'ranked' },
    ]);
    const unknown = potentialHits(
      c,
      item({ rarity: null, reprint: null, name: 'Plain', nameAlias: null }),
    );
    expect(unknown).toEqual([]);
    // A reprint coming is not out of print; a switch left off counts nothing.
    expect(potentialHits({ outOfPrint: true }, item({ reprint: 'likely' }))).toEqual([]);
    expect(
      potentialHits({ outOfPrint: false, ranked: false }, item({ reprint: 'none', ranked: true })),
    ).toEqual([]);
  });
});
