import { describe, expect, it } from 'vitest';
import { nameSearch } from './text';

describe('nameSearch', () => {
  it('finds katakana names from romaji or hiragana, long vowels loose', () => {
    const pikachu = nameSearch('pikachu')!;
    expect(pikachu('ピカチュウex SAR')).toBe(true);
    expect(pikachu('ナンジャモ')).toBe(false);
    expect(nameSearch('ぴかちゅう')!('ピカチュウV')).toBe(true);
    expect(nameSearch('nanjamo')!('ナンジャモのカイデン')).toBe(true);
    expect(nameSearch('rizaadon')!('リザードンex')).toBe(true);
    expect(nameSearch('roketto')!('ロケット団')).toBe(true);
  });

  it('needs every word, case- and width-blind', () => {
    expect(nameSearch('pikachu psa')!('ピカチュウ PSA10')).toBe(true);
    expect(nameSearch('pikachu box')!('ピカチュウ PSA10')).toBe(false);
    expect(nameSearch('MEGA')!('ｍｅｇａ ドリーム')).toBe(true);
    expect(nameSearch('  ')).toBeNull();
  });
});
