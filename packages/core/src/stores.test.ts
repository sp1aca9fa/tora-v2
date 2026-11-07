import { describe, expect, it } from 'vitest';
import { toLocalIso } from './time';
import {
  type NoticePost,
  activeArea,
  burstAuthors,
  codeIndex,
  confirmedLottery,
  firstLineOf,
  hasSaleStart,
  isWordOnly,
  lotteryPostIds,
  postRef,
  salesStarting,
  startLineOf,
  startsPosts,
  startsReadSince,
  storeNoticeModeOf,
  chainsInPost,
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
  // The same time twice: all day.
  expect(withinHours('12:00', '00:00', '00:00')).toBe(true);
  expect(withinHours('00:00', '08:00', '08:00')).toBe(true);
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

it('finds the chains a post names, once each', () => {
  const glossary = [
    { code: '▲', meaning: 'Arcade', chain: true },
    { code: 'アーケード', meaning: 'Arcade', chain: true },
    { code: '🍐', meaning: 'none' },
  ];
  expect(chainsInPost('▲港町 アーケード 🍐', glossary)).toEqual(['Arcade']);
  expect(chainsInPost('港町 🍐', glossary)).toEqual([]);
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

describe('sales starting and confirmed lotteries (S29)', () => {
  const glossary = [
    { code: 'started', meaning: 'x', saleStart: true },
    { code: 'not started yet', meaning: 'x', notSaleStart: true },
    { code: 'raffle', meaning: 'x', lottery: true },
    { code: 'only the raffle', meaning: 'x', notLottery: true },
    { code: 'apply', meaning: 'x', lotteryCue: true },
  ];
  const at = (minute: number) => `2026-11-01T12:${String(minute).padStart(2, '0')}:00.000+09:00`;
  const now = new Date(at(30));
  let n = 0;
  const post = (over: Partial<NoticePost> = {}): NoticePost => ({
    id: `p${String(++n).padStart(4, '0')}`,
    source: 'b',
    externalId: `e${n}`,
    text: 'hello',
    author: `person${n}`,
    postedAt: at(29),
    receivedAt: at(30),
    storeIds: ['s1'],
    replyTo: null,
    thread: null,
    ...over,
  });
  const run = (fresh: NoticePost[], more: Partial<Parameters<typeof salesStarting>[0]> = {}) =>
    salesStarting({
      fresh,
      recent: fresh,
      area: new Set(['s1']),
      places: new Set(),
      lottery: new Set(),
      last: new Map(),
      glossary,
      now,
      ...more,
    });

  it('takes a start word unless a not-start phrase is there, in any width or case', () => {
    expect(hasSaleStart('KTA started', glossary)).toBe(true);
    expect(hasSaleStart('ＳＴＡＲＴＥＤ now', glossary)).toBe(true);
    expect(hasSaleStart('KTA not started yet', glossary)).toBe(false);
    expect(hasSaleStart('restarted later', glossary)).toBe(false);
    expect(hasSaleStart('', glossary)).toBe(false);
    expect(hasSaleStart('started', [])).toBe(false);
  });

  it('confirms a lottery only on a first post with a word and a cue and no "not" phrase', () => {
    expect(confirmedLottery({ text: 'raffle, apply here' }, glossary)).toBe(true);
    expect(confirmedLottery({ text: 'a raffle at the store' }, glossary)).toBe(false);
    expect(confirmedLottery({ text: 'apply here' }, glossary)).toBe(false);
    expect(confirmedLottery({ text: 'only the raffle, apply' }, glossary)).toBe(false);
    expect(confirmedLottery({ text: 'raffle, apply', replyTo: 'x' }, glossary)).toBe(false);
    // Also says a sale is on: it stays. A start ruled out by a not-start phrase does not count.
    expect(confirmedLottery({ text: 'raffle, apply\nX started' }, glossary)).toBe(false);
    expect(confirmedLottery({ text: 'raffle, apply, not started yet' }, glossary)).toBe(true);
  });

  it('finds a confirmed lottery from its replies; an unknown first post stays unsure', () => {
    const first = post({ externalId: 'r', text: 'raffle, apply' });
    const reply = post({ externalId: 'r2', replyTo: 'r', thread: 'r' });
    const deep = post({ externalId: 'r3', replyTo: 'r2', thread: 'r2' });
    const lost = post({ externalId: 'r4', replyTo: 'gone', thread: 'gone' });
    const a = post({ externalId: 'a', replyTo: 'b', thread: 'b' });
    const b = post({ externalId: 'b', replyTo: 'a', thread: 'a' });
    const list = [first, reply, deep, lost, a, b];
    const known = new Map(list.map((p) => [postRef(p), p]));
    expect(lotteryPostIds(list, known, glossary)).toEqual(new Set([first.id, reply.id, deep.id]));
    // Without both kinds of word nothing is confirmed.
    const noCue = glossary.filter((g) => !g.lotteryCue);
    expect(lotteryPostIds(list, known, noCue).size).toBe(0);
  });

  it('counts different authors within 15 minutes; a missing author is one author', () => {
    const p = (author: string | null, minute: number) => ({ author, postedAt: at(minute) });
    expect(burstAuthors([], at(0))).toBe(0);
    expect(burstAuthors([p('a', 0)], at(0))).toBe(1);
    expect(burstAuthors([p('a', 0), p('a', 1), p('b', 2)], at(2))).toBe(2);
    expect(burstAuthors([p(null, 0), p(null, 1), p(null, 2)], at(2))).toBe(1);
    expect(burstAuthors([p(null, 0), p('', 1), p('a', 2)], at(2))).toBe(2);
    expect(burstAuthors([p('a', 0), p('b', 10), p('c', 15)], at(15))).toBe(3);
    expect(burstAuthors([p('a', 0), p('b', 10), p('c', 16)], at(16))).toBe(2);
    // A late arrival inside a window of later posts counts.
    expect(burstAuthors([p('a', 0), p('b', 10), p('c', 15)], at(0))).toBe(3);
    expect(burstAuthors([p('a', 0)], 'not a time')).toBe(0);
    expect(burstAuthors([{ author: 'a', postedAt: 'bad' }], at(0))).toBe(0);
  });

  it('tells a store once for a word, outside the area never', () => {
    const word = post({ text: 'started' });
    expect(run([word, post()])).toMatchObject([{ storeId: 's1', post: word, why: 'word' }]);
    expect(run([word], { area: new Set(['other']) })).toEqual([]);
    expect(run([post({ text: 'not started yet' })])).toEqual([]);
    expect(run([post()])).toEqual([]);
    expect(run([post({ storeIds: [] })])).toEqual([]);
    // A reply counts as a post does.
    expect(run([post({ text: 'started', replyTo: 'x', thread: 'x' })])).toHaveLength(1);
    // Ten saying so: one for the store, the latest.
    const ten = Array.from({ length: 10 }, () => post({ text: 'started' }));
    expect(run(ten)).toMatchObject([{ post: ten.at(-1) }]);
  });

  it('tells a burst of 3 different authors, whatever the words, reading stored posts', () => {
    const two = [post({ postedAt: at(20) }), post({ postedAt: at(25) })];
    const third = post();
    expect(run([third], { recent: two })).toMatchObject([{ post: third, why: 'burst', people: 3 }]);
    expect(run([third], { recent: [two[0]!] })).toEqual([]);
    const same = post({ author: two[0]!.author });
    expect(run([same], { recent: two })).toEqual([]);
    const none = [
      post({ author: null, postedAt: at(20) }),
      post({ author: null, postedAt: at(25) }),
      post({ author: null }),
    ];
    expect(run([none[2]!], { recent: none })).toEqual([]);
    const elsewhere = two.map((p) => ({ ...p, storeIds: ['s2'] }));
    expect(run([third], { recent: elsewhere })).toEqual([]);
  });

  it("leaves a confirmed lottery's posts out of the words and the burst", () => {
    const word = post({ text: 'started' });
    expect(run([word], { lottery: new Set([word.id]) })).toEqual([]);
    const two = [post({ postedAt: at(20) }), post({ postedAt: at(25) })];
    const third = post();
    expect(run([third], { recent: two, lottery: new Set([two[0]!.id]) })).toEqual([]);
    // A store woken by a lottery post alone stays asleep, a start word stored or not.
    const old = post({ text: 'started', receivedAt: at(20), postedAt: at(20) });
    expect(run([word], { recent: [old], lottery: new Set([word.id]) })).toEqual([]);
  });

  it('keeps one notice per store per quiet time, a failed send going again', () => {
    const word = post({ text: 'started' });
    const told = post({ text: 'started', postedAt: at(9), receivedAt: at(10) });
    expect(run([word], { recent: [told], last: new Map([['s1', at(10)]]) })).toEqual([]);
    expect(run([word], { last: new Map([['s1', at(0)]]) })).toHaveLength(1);
    // Failed: the start word stored and untold goes with the next post about the store.
    const failed = post({ text: 'started', postedAt: at(20), receivedAt: at(20) });
    const next = post();
    expect(run([next], { recent: [failed] })).toMatchObject([{ post: failed, why: 'word' }]);
    // Told, and said again during the quiet time: it does not fire once the quiet time is over.
    const late = new Date('2026-11-01T12:50:00.000+09:00');
    const during = post({ text: 'started', postedAt: at(40), receivedAt: at(40) });
    const after = post({ postedAt: at(49), receivedAt: late.toISOString() });
    const before = post({ text: 'started', postedAt: at(14), receivedAt: at(15) });
    expect(
      run([after], { recent: [before, during], last: new Map([['s1', at(15)]]), now: late }),
    ).toEqual([]);
  });

  it('lets a start word through once when a burst opened the quiet time', () => {
    const notice = new Map([['s1', at(20)]]);
    const chatter = post({ postedAt: at(18), receivedAt: at(19) });
    const word = post({ text: 'started', postedAt: at(29), receivedAt: at(30) });
    expect(run([word], { recent: [chatter], last: notice })).toMatchObject([
      { post: word, why: 'word' },
    ]);
    // Told now, its own quiet time holds: a second word does not go.
    const second = post({ text: 'started' });
    expect(run([second], { recent: [word], last: new Map([['s1', at(30)]]) })).toEqual([]);
    // Ordinary posts in that quiet time stay quiet.
    expect(run([post()], { recent: [chatter], last: notice })).toEqual([]);
  });

  it('counts only posts in after the last quiet time toward a burst', () => {
    const later = new Date('2026-11-01T12:55:00.000+09:00');
    const old = (minute: number) => post({ postedAt: at(minute), receivedAt: at(minute) });
    const chatter = [old(30), old(32), old(34)];
    const anew = (minute: number) => post({ postedAt: at(minute), receivedAt: at(minute) });
    const notice = new Map([['s1', at(20)]]);
    // Sustained chatter in the quiet time, then one new post: nothing.
    const one = anew(52);
    expect(run([one], { recent: chatter, last: notice, now: later })).toEqual([]);
    const two = anew(53);
    expect(run([two], { recent: [...chatter, one], last: notice, now: later })).toEqual([]);
    // Three people anew: a burst, showing the newest.
    const three = anew(54);
    expect(
      run([three], { recent: [...chatter, one, two], last: notice, now: later }),
    ).toMatchObject([{ post: three, why: 'burst', people: 3 }]);
  });

  it('accepts a start word up to 2 hours late, bursts only fresh', () => {
    const noon = (hour: number, minute: number) =>
      `2026-11-01T${hour}:${String(minute).padStart(2, '0')}:00.000+09:00`;
    const nowAt = new Date(noon(14, 0));
    const late = (minutes: number, over: Partial<NoticePost> = {}) => {
      const when = new Date(nowAt.getTime() - minutes * 60_000);
      return post({
        postedAt: toLocalIso(when),
        receivedAt: nowAt.toISOString(),
        ...over,
      });
    };
    const zone = { now: nowAt };
    const word = late(119, { text: 'X\nstarted' });
    expect(run([word], zone)).toMatchObject([{ post: word, why: 'word', line: 'started' }]);
    // Past 2 hours: too old.
    expect(run([late(121, { text: 'started' })], zone)).toEqual([]);
    // The quiet time holds for it too.
    const said = post({ text: 'started', postedAt: noon(13, 40), receivedAt: noon(13, 45) });
    expect(run([word], { ...zone, recent: [said], last: new Map([['s1', noon(13, 45)]]) })).toEqual(
      [],
    );
    // Three people an hour late are no burst.
    const three = [late(60), late(61), late(62)];
    expect(run(three, zone)).toEqual([]);
  });

  it('does not tell a store again for a late word posted before the last notice', () => {
    const clockAt = (hour: number, minute: number) =>
      `2026-11-01T${hour}:${String(minute).padStart(2, '0')}:00.000+09:00`;
    const nowAt = new Date(clockAt(14, 0));
    const notice = new Map([['s1', clockAt(13, 20)]]);
    const old = post({ text: 'started', postedAt: clockAt(13, 0), receivedAt: clockAt(14, 0) });
    expect(run([old], { now: nowAt, last: notice })).toEqual([]);
    const newer = post({ text: 'started', postedAt: clockAt(13, 21), receivedAt: clockAt(14, 0) });
    expect(run([newer], { now: nowAt, last: notice })).toMatchObject([{ post: newer }]);
  });

  it('still sees a word 2 hours late that opened the quiet time', () => {
    const clockAt = (hour: number, minute: number) =>
      `2026-11-01T${hour}:${String(minute).padStart(2, '0')}:00.000+09:00`;
    const nowAt = new Date(clockAt(14, 0));
    expect(startsReadSince(nowAt)).toBe(toLocalIso(new Date(clockAt(11, 30))));
    // Posted 11:35, in at 13:50 when it opened the quiet time: no burst's, so a new word waits.
    const opened = post({
      text: 'started',
      postedAt: clockAt(11, 35),
      receivedAt: clockAt(13, 50),
    });
    const word = post({ text: 'started', postedAt: clockAt(13, 59), receivedAt: clockAt(14, 0) });
    const last = new Map([['s1', clockAt(13, 50)]]);
    expect(run([word], { now: nowAt, recent: [opened], last })).toEqual([]);
    // It is too old to be told itself, and a new post reading it does not make it so.
    expect(startsPosts([opened], nowAt)).toEqual([]);
    expect(run([post()], { now: nowAt, recent: [opened] })).toEqual([]);
  });

  it('makes no burst on a place; a word there still tells', () => {
    const two = [post({ postedAt: at(20) }), post({ postedAt: at(25) })];
    const places = new Set(['s1']);
    expect(run([post()], { recent: two, places })).toEqual([]);
    expect(run([post({ text: 'started' })], { recent: two, places })).toHaveLength(1);
  });

  it('shows the line with the start word; a burst the newest post first line', () => {
    expect(startLineOf('KTA\n\nX started now\nmore', glossary)).toBe('X started now');
    expect(startLineOf('no word here\nsecond', glossary)).toBe('no word here');
    expect(startLineOf('', glossary)).toBe('');
    const word = post({ text: 'KTA\nX started' });
    expect(run([word])[0]!.line).toBe('X started');
    const two = [post({ postedAt: at(20) }), post({ postedAt: at(25) })];
    const third = post({ text: 'newest\nsecond' });
    expect(run([third], { recent: two })[0]!.line).toBe('newest');
  });

  it('reads the first line of a post, cut to about 80 characters', () => {
    expect(firstLineOf('\n  first  \nsecond')).toBe('first');
    expect(firstLineOf('')).toBe('');
    expect(firstLineOf('🦉'.repeat(100))).toBe(`${'🦉'.repeat(80)}…`);
    expect(firstLineOf('a'.repeat(80))).toBe('a'.repeat(80));
  });

  it("a person's choice defaults to everything; an unknown one too", () => {
    expect(storeNoticeModeOf(null)).toBe('all');
    expect(storeNoticeModeOf({})).toBe('all');
    expect(storeNoticeModeOf({ storeNoticeMode: 'nonsense' })).toBe('all');
    expect(storeNoticeModeOf({ storeNoticeMode: 'starts' })).toBe('starts');
    expect(storeNoticeModeOf({ storeNoticeMode: 'off' })).toBe('off');
  });

  it('marks the word kinds so they are never a code', () => {
    expect(glossary.filter(isWordOnly).map((g) => g.code)).toEqual([
      'started',
      'not started yet',
      'only the raffle',
      'apply',
    ]);
  });
});
