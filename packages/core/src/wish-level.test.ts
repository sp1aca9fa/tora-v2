import { describe, expect, it } from 'vitest';
import {
  type CoveredRange,
  type LevelSale,
  asPaid,
  bornOn,
  changeOver,
  levelOn,
  levelSeries,
  recordOf,
  rowShipping,
  salesRule,
  sampleIncludes,
  youngGame,
} from './wish-level';

const DAY = '2026-06-30';
const BUCKET = 'cond:good';
const opts = { sources: ['marketa', 'marketb'], bucket: BUCKET };
const cover = (entries: Record<string, CoveredRange[]>) => new Map(Object.entries(entries));
const allYear = cover({ marketa: [['2025-06-01', DAY]], marketb: [['2025-06-01', DAY]] });

/** `prices` sold at `source` on consecutive days ending at `last`. */
const sold = (prices: (number | null)[], last = DAY, source = 'marketa', bucket = BUCKET) =>
  prices.map((paid, i): LevelSale => ({
    day: new Date(Date.parse(`${last}T00:00:00Z`) - i * 86_400_000).toISOString().slice(0, 10),
    source,
    bucket,
    paid,
  }));
const steps = (n: number, from = 1000) => Array.from({ length: n }, (_, i) => from + i * 1000);

describe('asPaid (S36 C1)', () => {
  it('takes the price as paid only when the added cost is known', () => {
    expect(asPaid({ price: 3000 }, 'included')).toEqual({ known: true, amount: 3000 });
    expect(asPaid({ price: 3000 }, 'unknown')).toEqual({ known: false, amount: null });
    // Per row: shipping included, the buyer paid a known amount, or not told.
    expect(asPaid({ price: 3000, shipping: 'included' }, 'per_row').amount).toBe(3000);
    expect(asPaid({ price: 3000, shipping: 'buyer', shippingAmount: 750 }, 'per_row').amount).toBe(
      3750,
    );
    expect(asPaid({ price: 3000, shipping: 'buyer', shippingAmount: null }, 'per_row').known).toBe(
      false,
    );
    expect(asPaid({ price: 3000, shipping: 'unknown' }, 'per_row').known).toBe(false);
    expect(asPaid({ price: 3000 }, 'per_row').known).toBe(false);
    // A row that does not tell counts as included only once a sample showed it.
    expect(asPaid({ price: 3000 }, { rule: 'per_row', unstated: 'included' }).amount).toBe(3000);
    expect(asPaid({ price: 0 }, 'included').known).toBe(false);
    expect(asPaid({ price: Number.NaN }, 'included').known).toBe(false);
  });

  it('turns included on only at 95 of 100 or more', () => {
    const at = '2026-11-24T00:00:00.000+09:00';
    expect(sampleIncludes({ counted: 100, included: 95, how: 'hand', at })).toBe(true);
    expect(sampleIncludes({ counted: 100, included: 94, how: 'hand', at })).toBe(false);
    expect(sampleIncludes({ counted: 99, included: 99, how: 'hand', at })).toBe(false);
    expect(sampleIncludes({ counted: 1000, included: 960, how: 'search', at })).toBe(true);
    expect(sampleIncludes({ counted: 100, included: 101, how: 'hand', at })).toBe(false);
    expect(sampleIncludes(null)).toBe(false);
    // No declaration is unknown; a sample lifts unknown and per-row's unstated rows.
    expect(salesRule(undefined, null)).toEqual({ rule: 'unknown', unstated: 'unknown' });
    const sample = { counted: 100, included: 97, how: 'hand' as const, at };
    // A declared-unknown source with a passing sample is read per row (fix round 1, item 5): a row
    // whose raw says the buyer pays, with no amount, stays out; one that does not tell counts.
    const sampled = salesRule(undefined, sample);
    expect(sampled).toEqual({ rule: 'per_row', unstated: 'included' });
    expect(salesRule({ sales: 'unknown', listings: 'unknown' }, sample)).toEqual(sampled);
    expect(asPaid({ price: 1000, shipping: 'buyer', shippingAmount: null }, sampled)).toEqual({
      known: false,
      amount: null,
    });
    expect(asPaid({ price: 1000, shipping: 'buyer', shippingAmount: 300 }, sampled)).toEqual({
      known: true,
      amount: 1300,
    });
    expect(asPaid({ price: 1000 }, sampled)).toEqual({ known: true, amount: 1000 });
    expect(
      asPaid({ price: 1000, ...rowShipping({ shipping: 'buyer' }, 'JPY', 'JPY') }, sampled).known,
    ).toBe(false);
    expect(salesRule({ sales: 'per_row', listings: 'unknown' }, sample)).toEqual({
      rule: 'per_row',
      unstated: 'included',
    });
  });

  it('reads a stored row shipping, amounts in the base currency only', () => {
    expect(rowShipping({ shipping: 'buyer', shippingAmount: 500 }, 'JPY', 'JPY')).toEqual({
      shipping: 'buyer',
      shippingAmount: 500,
    });
    expect(rowShipping({ shipping: 'buyer', shippingAmount: 500 }, 'USD', 'JPY')).toEqual({
      shipping: 'buyer',
      shippingAmount: null,
    });
    expect(rowShipping({ shipping: 'free' }, 'JPY', 'JPY')).toEqual({
      shipping: null,
      shippingAmount: null,
    });
    expect(rowShipping(null, 'JPY', 'JPY').shipping).toBeNull();
  });
});

describe('levelOn (S36 Terms "Level")', () => {
  it('needs 10 sales: 9 give no level, 10 and 11 do', () => {
    const nine = levelOn(DAY, sold(steps(9)), allYear, opts);
    expect(nine).toMatchObject({ level: null, n: 9, reason: 'too_few', low: 1000, high: 9000 });
    // 10 sales 1000..10000: position (10 - 1) * 0.25 = 2.25, so 3000 + 0.25 * (4000 - 3000) = 3250.
    expect(levelOn(DAY, sold(steps(10)), allYear, opts)).toEqual({
      day: DAY,
      level: 3250,
      n: 10,
      window: 30,
      sources: ['marketa', 'marketb'],
    });
    // 11 sales 1000..11000: position (11 - 1) * 0.25 = 2.5, so 3000 + 0.5 * 1000 = 3500.
    expect(levelOn(DAY, sold(steps(11)), allYear, opts).level).toBe(3500);
  });

  it('interpolates as hand-computed', () => {
    // 12 sales, sorted 500 800 1200 1500 2000 2100 2500 3000 3200 4000 4100 5000: position
    // (12 - 1) * 0.25 = 2.75, so 1200 + 0.75 * (1500 - 1200) = 1425.
    const prices = [3000, 500, 4100, 1200, 2100, 800, 5000, 1500, 3200, 2000, 4000, 2500];
    expect(levelOn(DAY, sold(prices), allYear, opts).level).toBe(1425);
    // Two sources pooled: 5 at marketa (1000..5000) and 5 at marketb (1500..5500), sorted
    // 1000 1500 2000 2500 3000 3500 4000 4500 5000 5500: position 2.25, 2000 + 0.25 * 500 = 2125.
    const both = [...sold(steps(5)), ...sold(steps(5, 1500), DAY, 'marketb')];
    expect(levelOn(DAY, both, allYear, opts).level).toBe(2125);
    // Ten equal prices: 4000.
    expect(levelOn(DAY, sold(Array(10).fill(4000)), allYear, opts).level).toBe(4000);
  });

  it('falls back to 90 days with fewer than 10 in 30', () => {
    // 5 sales in the last 30 days, 6 more between 31 and 90 days back.
    const sales = [...sold(steps(5)), ...sold(steps(6, 20_000), '2026-05-15')];
    const day = levelOn(DAY, sales, allYear, opts);
    expect(day).toMatchObject({ level: expect.any(Number), n: 11, window: 90 });
    // Sorted 1000..5000, 20000..25000: position 2.5, 3000 + 0.5 * 1000 = 3500.
    expect(day.level).toBe(3500);
    // Sales 91 days back never count.
    const old = [...sold(steps(5)), ...sold(steps(6, 20_000), '2026-03-31')];
    expect(levelOn(DAY, old, allYear, opts)).toMatchObject({ level: null, n: 5 });
  });

  it('an uncovered day inside the window voids it', () => {
    const holed = cover({
      marketa: [
        ['2025-06-01', '2026-06-14'],
        ['2026-06-16', DAY],
      ],
    });
    const day = levelOn(DAY, sold(steps(12)), holed, opts);
    expect(day).toMatchObject({
      level: null,
      reason: 'not_covered',
      wholeFrom: '2026-06-16',
      wholeOn: '2026-07-15',
      n: 12,
    });
    // Ranges that touch are one run.
    const touching = cover({
      marketa: [
        ['2025-06-01', '2026-06-14'],
        ['2026-06-15', DAY],
      ],
    });
    expect(levelOn(DAY, sold(steps(12)), touching, opts).level).toBe(3750);
  });

  it('an uncovered source is not counted though another is covered', () => {
    // Terms: "from every source ... whose days in the window are all covered": marketb's hole leaves
    // its sales out; marketa's 10 alone give the level.
    const covered = cover({ marketa: [['2025-06-01', DAY]], marketb: [['2026-06-20', DAY]] });
    const sales = [...sold(steps(10)), ...sold(Array(10).fill(100), DAY, 'marketb')];
    expect(levelOn(DAY, sales, covered, opts)).toMatchObject({
      level: 3250,
      n: 10,
      sources: ['marketa'],
    });
    // marketa with 9: no level at 30 or 90, marketb never counts.
    expect(
      levelOn(
        DAY,
        [...sold(steps(9)), ...sold(Array(10).fill(100), DAY, 'marketb')],
        covered,
        opts,
      ),
    ).toMatchObject({ level: null, reason: 'too_few' });
  });

  it('names only the sources counted and stores the left-out ones with the reason', () => {
    // The reviewer's probe: 12 known sales at marketa, 5 at marketb whose added cost is unknown,
    // both covered. Sorted 1000..12000: position 2.75, 3000 + 0.75 * 1000 = 3750.
    const probe = [...sold(steps(12)), ...sold(steps(5, 500), DAY, 'marketb')];
    expect(levelOn(DAY, probe, allYear, { ...opts, costUnknown: ['marketb'] })).toEqual({
      day: DAY,
      level: 3750,
      n: 12,
      window: 30,
      sources: ['marketa'],
      left: { marketb: 'cost_unknown' },
    });
    // A hole leaves a source out as such, also one that sold nothing; unknown cost wins over it.
    const holed = cover({ marketa: [['2025-06-01', DAY]], marketb: [['2026-06-20', DAY]] });
    expect(levelOn(DAY, sold(steps(12)), holed, opts)).toMatchObject({
      sources: ['marketa'],
      left: { marketb: 'hole' },
    });
    expect(
      levelOn(DAY, sold(steps(12)), holed, { ...opts, costUnknown: ['marketb'] }),
    ).toMatchObject({ left: { marketb: 'cost_unknown' } });
    // A counted source that sold nothing in the window is still named; nothing left: no members.
    const day = levelOn(DAY, sold(steps(12)), allYear, opts);
    expect(day.sources).toEqual(['marketa', 'marketb']);
    expect(day).not.toHaveProperty('left');
    expect(day).not.toHaveProperty('rowsUnknown');
    // A counted per-row source's rows that do not tell the cost are counted per source.
    const rows = [...sold(steps(10)), ...sold([null, null], DAY, 'marketb')];
    expect(levelOn(DAY, rows, allYear, opts)).toMatchObject({
      level: 3250,
      sources: ['marketa', 'marketb'],
      rowsUnknown: { marketb: 2 },
    });
    // No source whole: no level, both named left out.
    const none = cover({ marketa: [['2026-06-20', DAY]] });
    expect(levelOn(DAY, sold(steps(12)), none, opts)).toMatchObject({
      level: null,
      sources: [],
      left: { marketa: 'hole', marketb: 'hole' },
    });
  });

  it('leaves out sales whose added cost is unknown', () => {
    const sales = sold([...steps(9), null, null, null]);
    expect(levelOn(DAY, sales, allYear, opts)).toMatchObject({
      level: null,
      n: 9,
      unknownCost: 3,
      reason: 'cost_unknown',
      low: 1000,
      high: 9000,
    });
    expect(levelOn(DAY, sold(Array(12).fill(null)), allYear, opts)).toMatchObject({
      n: 0,
      low: null,
      high: null,
      unknownCost: 12,
    });
  });

  it('leaves out a source outside the home market and better buckets', () => {
    const foreign = sold(Array(10).fill(100), DAY, 'abroad');
    const better = sold(Array(10).fill(100), DAY, 'marketa', 'cond:like_new');
    const covered = cover({ marketa: [['2025-06-01', DAY]], abroad: [['2025-06-01', DAY]] });
    expect(levelOn(DAY, [...sold(steps(10)), ...foreign, ...better], covered, opts).level).toBe(
      3250,
    );
  });

  it('never looks ahead', () => {
    // Ten sales, the last five after the day asked: only five are read.
    const sales = sold(steps(10), '2026-07-05');
    expect(levelOn(DAY, sales, allYear, opts)).toMatchObject({ level: null, n: 5 });
    expect(
      levelOn('2026-07-05', sales, cover({ marketa: [['2025-06-01', '2026-07-05']] }), opts).level,
    ).toBe(3250);
  });

  it('says from which day the sales are whole when nothing is covered long enough', () => {
    const fresh = cover({ marketa: [['2026-06-21', DAY]] });
    expect(levelOn(DAY, sold(steps(3)), fresh, opts)).toMatchObject({
      level: null,
      reason: 'not_covered',
      wholeFrom: '2026-06-21',
      wholeOn: '2026-07-20',
    });
    expect(levelOn(DAY, [], new Map(), opts)).toMatchObject({
      level: null,
      n: 0,
      reason: 'not_covered',
      wholeFrom: null,
      wholeOn: null,
    });
  });
});

describe('recordOf, youngGame, changeOver (S36 Terms "Record", "Young game")', () => {
  const days = [
    { day: '2026-01-01', level: 2000, window: 30 as const },
    { day: '2026-04-05', level: 1500, window: 90 as const },
    { day: '2026-05-01', level: null, window: null },
    { day: '2026-05-03', level: 1800, window: 30 as const },
    { day: '2026-05-31', level: 2700, window: 30 as const },
  ];

  it('is the lowest level of a day the game was 90 days old or more', () => {
    expect(recordOf(days, '2025-09-01')).toEqual({ level: 1500, day: '2026-04-05', window: 90 });
    // Born 2026-01-10: days before 2026-04-10 do not count.
    expect(recordOf(days, '2026-01-10')).toEqual({ level: 1800, day: '2026-05-03', window: 30 });
    // Age unknown: no day counts.
    expect(recordOf(days, null)).toBeNull();
    expect(recordOf([], '2025-01-01')).toBeNull();
  });

  it('follows the levels given (recomputed), not a running minimum', () => {
    const after = days.map((d) => (d.day === '2026-04-05' ? { ...d, level: 2100 } : d));
    expect(recordOf(after, '2025-09-01')).toEqual({ level: 1800, day: '2026-05-03', window: 30 });
  });

  it('reads a young game from its release date, else its first clean sale', () => {
    expect(bornOn('2026-05-01', '2026-04-20')).toBe('2026-05-01');
    expect(bornOn('2026-05', '2026-05-12')).toBe('2026-05-12');
    expect(bornOn(null, null)).toBeNull();
    expect(youngGame('2026-05-01', DAY)).toEqual({ young: true, ageDays: 60 });
    expect(youngGame('2026-04-01', DAY)).toEqual({ young: false, ageDays: 90 });
    expect(youngGame(null, DAY)).toBeNull();
  });

  it('changes over 4 weeks only when both days have a level', () => {
    expect(changeOver(days, 28)).toEqual({
      from: { day: '2026-05-03', level: 1800 },
      to: { day: '2026-05-31', level: 2700 },
      amount: 900,
      share: 0.5,
    });
    expect(changeOver(days.slice(0, 3), 26)).toBeNull();
    expect(changeOver([...days.slice(0, 2), { ...days[3]!, level: null }], 28)).toBeNull();
    expect(changeOver([], 28)).toBeNull();
  });

  it('a series is levelOn for each day', () => {
    const series = levelSeries('2026-06-28', DAY, sold(steps(12)), allYear, opts);
    expect(series.map((d) => d.day)).toEqual(['2026-06-28', '2026-06-29', DAY]);
    expect(series.at(-1)).toEqual(levelOn(DAY, sold(steps(12)), allYear, opts));
    expect(levelSeries(DAY, '2026-06-01', [], allYear, opts)).toEqual([]);
  });
});
