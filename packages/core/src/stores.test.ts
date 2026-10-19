import { describe, expect, it } from 'vitest';
import {
  activeArea,
  distanceKm,
  roundPoint,
  storesInArea,
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
    const kawasaki = { chain: 'yodobashi', name: '川崎', codes: ['\u{1F3CD}\uFE0F'] };
    expect(storesInPost('\u{1F3CD} 開始', [kawasaki])).toEqual([kawasaki]);
    expect(
      storesInPost('\u{1F3CD}\uFE0F 開始', [{ ...kawasaki, codes: ['\u{1F3CD}'] }]),
    ).toHaveLength(1);
  });

  it('prefers the longer code, and keeps to the board chain', () => {
    expect(storesInPost('新宿西口 整理券配布', all, 'yodobashi')).toEqual([shinjuku]);
    expect(storesInPost('新宿東口 販売', all, 'biccamera')).toEqual([bicShinjuku]);
    expect(storesInPost('新宿東口 販売', all)).toEqual([bicShinjuku]);
  });
});

it('tells hours apart, also past midnight', () => {
  expect(withinHours('21:30', '08:00', '23:00')).toBe(true);
  expect(withinHours('23:00', '08:00', '23:00')).toBe(false);
  expect(withinHours('01:00', '22:00', '02:00')).toBe(true);
  expect(withinHours('12:00', '22:00', '02:00')).toBe(false);
});
