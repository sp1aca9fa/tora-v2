import { describe, expect, it } from 'vitest';
import {
  activeArea,
  codeIndex,
  codesInPost,
  locationsOf,
  distanceKm,
  roundPoint,
  storesInArea,
  PLACE,
  productsInPost,
  storeLabelIn,
  storesInPost,
  withinHours,
} from './stores';

const chuo = {
  id: 'u',
  chain: 'megastore',
  name: 'メガストア中央',
  codes: ['中央', 'MID'],
  lat: 34.704,
  lon: 135.496,
};
const kita = {
  id: 'a',
  chain: 'megastore',
  name: 'メガストアKita',
  codes: ['KTA', 'キタ'],
  lat: 35.699,
  lon: 139.774,
};
const shinjuku = {
  id: 's',
  chain: 'megastore',
  name: '新宿西口本店',
  codes: ['新宿', '新宿西口'],
  lat: 35.692,
  lon: 139.698,
};
const bicShinjuku = {
  id: 'b',
  chain: 'arcade',
  name: '新宿東口店',
  codes: ['新宿東口'],
  lat: 35.692,
  lon: 139.701,
};
const all = [chuo, kita, shinjuku, bicShinjuku];

describe('store notices: areas', () => {
  it('measures distances and keeps points rough', () => {
    expect(distanceKm(kita, shinjuku)).toBeGreaterThan(6);
    expect(distanceKm(kita, shinjuku)).toBeLessThan(8);
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
    expect(storesInPost('MID 30th 店頭販売開始!', all, 'megastore')).toEqual([chuo]);
    expect(storesInPost('ｍｉｄ 入荷', all, 'megastore')).toEqual([chuo]);
    // A Latin code only as a whole word.
    expect(storesInPost('KTAX は関係なし', all, 'megastore')).toEqual([]);
    expect(storesInPost('キタと中央で販売中', all, 'megastore')).toEqual([chuo, kita]);
  });

  it('matches emoji codes with or without their variation mark', () => {
    const sunny = { chain: 'megastore', name: 'テスト店', codes: ['\u2600\uFE0F'] };
    expect(storesInPost('\u2600 開始', [sunny], 'megastore')).toEqual([sunny]);
    expect(
      storesInPost('\u2600\uFE0F 開始', [{ ...sunny, codes: ['\u2600'] }], 'megastore'),
    ).toHaveLength(1);
  });

  it('prefers the longer code, and keeps to the board chain', () => {
    expect(storesInPost('新宿西口 整理券配布', all, 'megastore')).toEqual([shinjuku]);
    expect(storesInPost('新宿東口 販売', all, 'arcade')).toEqual([bicShinjuku]);
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
  const ekimae = { chain: PLACE, name: '駅前', codes: ['◆'], lat: 35.73, lon: 139.71 };
  const kiba = { chain: PLACE, name: '木場', codes: [], lat: 35.67, lon: 139.81 };
  const list = [...all, ekimae, kiba];
  expect(storesInPost('イトヨ木場 カードセット', list)).toEqual([kiba]);
  // On a board mixing chains, ◆ is the area, not a chain's store.
  expect(storesInPost('◆■ 販売', [...list, { ...chuo, codes: ['◆'] }])).toEqual([ekimae]);
  expect(storesInPost('◆■ 30th', list, 'arcade')).toEqual([ekimae]);
  // The board's own store wins over the place.
  expect(storesInPost('キタ 30th', list, 'megastore')).toEqual([kita]);
});

it('puts each store in the nearest place within 1.5 km, else on its own', () => {
  const west = { id: 'w', chain: PLACE, name: '新宿', codes: [], lat: 35.6905, lon: 139.6995 };
  const far = { id: 'f', chain: PLACE, name: '木場', codes: [], lat: 35.67, lon: 139.81 };
  const at = locationsOf([...all, west, far]);
  expect(Object.fromEntries(at)).toEqual({ u: 'u', a: 'a', s: 'w', b: 'w', w: 'w', f: 'f' });
});

it('spells out the codes of a post in the order written, the longer code first', () => {
  const codes = [
    { code: '🍐', meaning: 'none' },
    { code: '🦏🥚', meaning: 'Saitama' },
    { code: '🥚', meaning: 'Egg town' },
    { code: 'KTA', meaning: 'Megastore Kita' },
  ];
  expect(codesInPost('KTA 🦏🥚 カードセット 🍐 KTA', codes)).toEqual([
    codes[3],
    codes[1],
    codes[0],
  ]);
  expect(codesInPost('KTAX', codes)).toEqual([]);
});

it('lists the codes that are more than the name, with what they stand for', () => {
  const index = codeIndex(all);
  expect(index.map((e) => e.code)).toEqual(['KTA', 'MID', 'キタ']);
  expect(index.find((e) => e.code === 'MID')!.stores).toEqual([chuo]);
});

describe('store notices: products in a post', () => {
  const products = [
    { code: '雪', meaning: 'Snow set', product: true },
    { code: 'b', meaning: 'Black', product: true },
    { code: 'B', meaning: 'Battle', product: true },
    { code: '9種', meaning: '9 card sets', product: true },
    { code: 'XYZ', meaning: 'Expansion XYZ', product: true },
    { code: '○', meaning: 'there is some' },
  ];
  const names = (text: string) =>
    productsInPost(text, products, ['◇', '港町']).map((p) => p.meaning);

  it('reads short codes in runs of codes, numbers and common words', () => {
    expect(names('雪(1) 16:00-')).toEqual(['Snow set']);
    expect(names('港町 9種◇')).toEqual(['9 card sets']);
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
    expect(names('○')).toEqual([]);
    expect(names('雪 雪')).toEqual(['Snow set']);
  });

  it("counts an admin's codes and emoji codes anywhere, an admin's first", () => {
    const list = [
      ...products,
      { code: '△', meaning: 'Swirl box', product: true },
      { code: '種', meaning: 'feed meaning', product: true },
      { code: '種', meaning: 'Seeds', product: true, byHand: true },
    ];
    const read = (text: string) => productsInPost(text, list).map((p) => p.meaning);
    expect(read('港町△継続中')).toEqual(['Swirl box']);
    expect(read('ゼルビア種あり')).toEqual(['Seeds']);
  });
});

describe('store labels', () => {
  it("names a store in the reader's language, English when theirs has none", () => {
    const store = { language: 'ja', labels: { en: 'Megastore Kita', fr: 'Mégastore Kita' } };
    expect(storeLabelIn(store, 'ja')).toBeNull();
    expect(storeLabelIn(store, 'fr')).toBe('Mégastore Kita');
    expect(storeLabelIn({ ...store, labels: { en: 'Megastore Kita' } }, 'fr')).toBe(
      'Megastore Kita',
    );
    // A name in an unknown language stays as written unless the reader's language has a label.
    expect(storeLabelIn({ labels: { en: 'Kita' } }, 'fr')).toBeNull();
    expect(storeLabelIn({ labels: { en: 'Kita' } }, 'en')).toBe('Kita');
  });
});
