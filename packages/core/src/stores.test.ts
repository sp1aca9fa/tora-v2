import { describe, expect, it } from 'vitest';
import {
  activeArea,
  codeIndex,
  distanceKm,
  roundPoint,
  storesInArea,
  PLACE,
  productsInPost,
  storesInPost,
  withinHours,
} from './stores';

const umeda = {
  id: 'u',
  chain: 'yodobashi',
  name: 'マルチメディア梅田',
  codes: ['梅田', 'UMD'],
  lat: 34.704,
  lon: 135.496,
};
const akiba = {
  id: 'a',
  chain: 'yodobashi',
  name: 'マルチメディアAkiba',
  codes: ['AKB', 'アキバ'],
  lat: 35.699,
  lon: 139.774,
};
const shinjuku = {
  id: 's',
  chain: 'yodobashi',
  name: '新宿西口本店',
  codes: ['新宿', '新宿西口'],
  lat: 35.692,
  lon: 139.698,
};
const bicShinjuku = {
  id: 'b',
  chain: 'biccamera',
  name: '新宿東口店',
  codes: ['新宿東口'],
  lat: 35.692,
  lon: 139.701,
};
const all = [umeda, akiba, shinjuku, bicShinjuku];

describe('store notices: areas', () => {
  it('measures distances and keeps points rough', () => {
    expect(distanceKm(akiba, shinjuku)).toBeGreaterThan(6);
    expect(distanceKm(akiba, shinjuku)).toBeLessThan(8);
    expect(roundPoint({ lat: 35.6987654, lon: 139.7734567 })).toEqual({
      lat: 35.699,
      lon: 139.773,
    });
  });

  it('takes the stores within the distance, or the ones picked, muted ones aside', () => {
    const home = { mode: 'distance' as const, point: { lat: 35.69, lon: 139.7 }, km: 5 };
    expect([...storesInArea({ home }, all, '2026-10-19')].sort()).toEqual(['b', 's']);
    expect([...storesInArea({ home, muted: ['b'] }, all, '2026-10-19')]).toEqual(['s']);
    // Added by hand: in, wherever it is; muted wins.
    expect([...storesInArea({ home, added: ['u'] }, all, '2026-10-19')].sort()).toEqual([
      'b',
      's',
      'u',
    ]);
    expect(
      [...storesInArea({ home, added: ['u'], muted: ['u'] }, all, '2026-10-19')].sort(),
    ).toEqual(['b', 's']);
    expect([
      ...storesInArea({ home: { mode: 'stores', storeIds: ['u', 'a'] } }, all, '2026-10-19'),
    ]).toEqual(['u', 'a']);
    expect(storesInArea(null, all, '2026-10-19').size).toBe(0);
  });

  it('uses the travel area until its date, then home again', () => {
    const area = {
      home: { mode: 'stores' as const, storeIds: ['a'] },
      travel: { mode: 'stores' as const, storeIds: ['u'], until: '2026-10-21' },
    };
    expect(activeArea(area, '2026-10-21')).toBe(area.travel);
    expect([...storesInArea(area, all, '2026-10-22')]).toEqual(['a']);
  });
});

describe('store notices: posts', () => {
  it("finds the chain's stores a post names, by code or name", () => {
    expect(storesInPost('UMD 30th 店頭販売開始!', all, 'yodobashi')).toEqual([umeda]);
    expect(storesInPost('ｕｍｄ 入荷', all, 'yodobashi')).toEqual([umeda]);
    // A Latin code only as a whole word.
    expect(storesInPost('AKBX は関係なし', all, 'yodobashi')).toEqual([]);
    expect(storesInPost('アキバと梅田で販売中', all, 'yodobashi')).toEqual([umeda, akiba]);
  });

  it('matches emoji codes with or without their variation mark', () => {
    const sunny = { chain: 'yodobashi', name: 'テスト店', codes: ['\u2600\uFE0F'] };
    expect(storesInPost('\u2600 開始', [sunny], 'yodobashi')).toEqual([sunny]);
    expect(
      storesInPost('\u2600\uFE0F 開始', [{ ...sunny, codes: ['\u2600'] }], 'yodobashi'),
    ).toHaveLength(1);
  });

  it('prefers the longer code, and keeps to the board chain', () => {
    expect(storesInPost('新宿西口 整理券配布', all, 'yodobashi')).toEqual([shinjuku]);
    expect(storesInPost('新宿東口 販売', all, 'biccamera')).toEqual([bicShinjuku]);
    // A board mixing chains: places only, never a chain's codes.
    expect(storesInPost('新宿東口 販売', all)).toEqual([]);
  });
});

it('tells hours apart, also past midnight', () => {
  expect(withinHours('21:30', '08:00', '23:00')).toBe(true);
  expect(withinHours('23:00', '08:00', '23:00')).toBe(false);
  expect(withinHours('01:00', '22:00', '02:00')).toBe(true);
  expect(withinHours('12:00', '22:00', '02:00')).toBe(false);
});

it("names a place when no store of the board's chain matched", () => {
  const ikebukuro = { chain: PLACE, name: '池袋', codes: ['⭐'], lat: 35.73, lon: 139.71 };
  const kiba = { chain: PLACE, name: '木場', codes: [], lat: 35.67, lon: 139.81 };
  const list = [...all, ikebukuro, kiba];
  expect(storesInPost('イトヨ木場 カードセット', list)).toEqual([kiba]);
  // On a board mixing chains, ⭐ is the area, not a chain's store.
  expect(storesInPost('⭐🎈 販売', [...list, { ...umeda, codes: ['⭐'] }])).toEqual([ikebukuro]);
  expect(storesInPost('⭐🎈 30th', list, 'biccamera')).toEqual([ikebukuro]);
  // The board's own store wins over the place.
  expect(storesInPost('アキバ 30th', list, 'yodobashi')).toEqual([akiba]);
});

it('lists the codes that are more than the name, with what they stand for', () => {
  const index = codeIndex(all);
  expect(index.map((e) => e.code)).toEqual(['AKB', 'UMD', 'アキバ']);
  expect(index.find((e) => e.code === 'UMD')!.stores).toEqual([umeda]);
});

describe('store notices: products in a post', () => {
  const products = [
    { code: '雪', meaning: 'Snow set', product: true },
    { code: 'b', meaning: 'Black', product: true },
    { code: 'B', meaning: 'Battle', product: true },
    { code: '9種', meaning: '9 card sets', product: true },
    { code: 'XYZ', meaning: 'Expansion XYZ', product: true },
    { code: '🐞', meaning: 'there is some' },
  ];
  const names = (text: string) =>
    productsInPost(text, products, ['🐝', '上野']).map((p) => p.meaning);

  it('reads short codes in runs of codes, numbers and common words', () => {
    expect(names('雪(1) 16:00-')).toEqual(['Snow set']);
    expect(names('上野 9種🐝')).toEqual(['9 card sets']);
    expect(names('雪あり b(5P)')).toEqual(['Snow set', 'Black']);
    // Case matters: b and B are different products.
    expect(names('B 10P')).toEqual(['Battle']);
    // A one-character code inside an ordinary word is no product.
    expect(names('雪だるまを見た')).toEqual([]);
    expect(names('bonus')).toEqual([]);
    // Codes of 3+ characters count anywhere, as whole words.
    expect(names('今日はXYZがあった')).toEqual(['Expansion XYZ']);
    expect(names('XYZW')).toEqual([]);
    // Codes that are no product (emoji states) are never named.
    expect(names('🐞')).toEqual([]);
    expect(names('雪 雪')).toEqual(['Snow set']);
  });

  it("counts an admin's codes and emoji codes anywhere, an admin's first", () => {
    const list = [
      ...products,
      { code: '🌀', meaning: 'Swirl box', product: true },
      { code: '種', meaning: 'feed meaning', product: true },
      { code: '種', meaning: 'Seeds', product: true, byHand: true },
    ];
    const read = (text: string) => productsInPost(text, list).map((p) => p.meaning);
    expect(read('上野🌀継続中')).toEqual(['Swirl box']);
    expect(read('ゼルビア種あり')).toEqual(['Seeds']);
  });
});
