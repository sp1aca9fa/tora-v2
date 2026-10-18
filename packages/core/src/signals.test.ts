import { describe, expect, it } from 'vitest';
import {
  type DayPrice,
  type SignalStats,
  buyZone,
  dailyPrices,
  fittedChange,
  judge,
  marketTrend,
  newSetPattern,
  quantile,
  replay,
  seriesStats,
  suggestedStrategy,
  typicalLowAge,
} from './signals';
import { byLine, lineFromTitle } from './lines';
import { STRATEGY_EXAMPLES, replayExample, strategyExamples } from './strategy-examples';

/** Daily prices from `start` for `n` days, by a function of the day index. */
function days(start: string, n: number, price: (i: number) => number): DayPrice[] {
  const t0 = Date.parse(`${start}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => ({
    day: new Date(t0 + i * 86_400_000).toISOString().slice(0, 10),
    price: price(i),
    count: 2,
  }));
}

const stats = (over: Partial<SignalStats>): SignalStats => ({
  fair: 10000,
  sales30: 20,
  days180: 100,
  days365: 200,
  usual180: 10000,
  q25d180: 9000,
  q75d180: 11000,
  q10d365: 8000,
  cheaperThan180: 0.5,
  trend14: 0,
  trend28: 0,
  trend84: 0,
  ask: null,
  ageDays: null,
  releaseFrom: null,
  market: null,
  pattern: null,
  ...over,
});

describe('numbers', () => {
  it('takes daily medians and quantiles', () => {
    expect(
      dailyPrices([
        { day: '2026-01-02T10:00', price: 300 },
        { day: '2026-01-01T09:00', price: 100 },
        { day: '2026-01-01T12:00', price: 200 },
      ]),
    ).toEqual([
      { day: '2026-01-01', price: 150, count: 2 },
      { day: '2026-01-02', price: 300, count: 1 },
    ]);
    expect(quantile([1, 2, 3, 4, 5], 0.25)).toBe(2);
  });

  it('fits the change over a window, only with enough spread days', () => {
    const rising = days('2026-01-01', 28, (i) => 1000 * 1.01 ** i);
    expect(fittedChange(rising, Date.parse('2026-01-28') / 86_400_000, 14)).toBeCloseTo(
      1.01 ** 14 - 1,
      5,
    );
    expect(fittedChange(rising.slice(-2), Date.parse('2026-01-28') / 86_400_000, 14)).toBeNull();
  });

  it('works out the ranges, and leaves them out with too few days', () => {
    const s = seriesStats(
      days('2026-01-01', 200, (i) => 1000 + i),
      '2026-07-19',
    );
    expect(s.days180).toBe(180);
    expect(s.q25d180).toBeGreaterThan(1000);
    // The median of the last 30 days.
    expect(s.fair).toBe(1185);
    const thin = seriesStats(
      days('2026-07-10', 5, () => 1000),
      '2026-07-19',
    );
    expect(thin.q25d180).toBeNull();
    expect(thin.usual180).toBe(1000);
  });
});

describe('zones and verdicts', () => {
  it('Steady: the lower quarter; a fast fall waits, Catch the dip does not', () => {
    expect(buyZone(stats({}), { strategy: 'steady' })).toMatchObject({
      top: 9000,
      basis: 'quarter180',
    });
    const low = stats({ fair: 8500 });
    expect(judge(low, { strategy: 'steady' }).verdict).toBe('good');
    const falling = stats({ fair: 8500, trend14: -0.08, trend28: -0.1 });
    expect(judge(falling, { strategy: 'steady' }).verdict).toBe('wait');
    expect(judge(falling, { strategy: 'dip' })).toMatchObject({ verdict: 'good', falling: true });
    expect(judge(stats({ fair: 12000 }), { strategy: 'steady' }).verdict).toBe('high');
    expect(judge(stats({}), { strategy: 'steady' }).verdict).toBe('fair');
  });

  it('waits while the whole market falls, except Catch the dip', () => {
    const low = stats({ fair: 8500, market: { items: 20, change84: -0.29 } });
    expect(judge(low, { strategy: 'steady' })).toMatchObject({
      verdict: 'wait',
      marketFalling: true,
    });
    expect(judge(low, { strategy: 'dip' }).verdict).toBe('good');
    const mild = stats({ fair: 8500, market: { items: 20, change84: -0.05 } });
    expect(judge(mild, { strategy: 'steady' }).verdict).toBe('good');
    expect(marketTrend([days('2026-01-01', 84, () => 1000)], '2026-03-25')).toBeNull();
    const five = Array.from({ length: 5 }, () => days('2026-01-01', 84, (i) => 1000 - i * 4));
    expect(marketTrend(five, '2026-03-25')!.change84).toBeLessThan(-0.25);
  });

  it('waits on a new release until the age similar items usually hit their low, else 90 days', () => {
    const young = stats({ fair: 8500, ageDays: 100, releaseFrom: 'set' });
    // Too few similar items with a full year: 90 days, so day 100 no longer waits.
    expect(judge(young, { strategy: 'steady' })).toMatchObject({
      verdict: 'good',
      newRelease: false,
      waitDays: 90,
    });
    const learned = { ...young, lowAge: { age: 150, items: 4, line: 'sub' } };
    expect(judge(learned, { strategy: 'steady' })).toMatchObject({
      verdict: 'wait',
      newRelease: true,
      waitDays: 150,
    });
    // Catch the dip warns instead; a first collected sale is not a release date.
    expect(judge(learned, { strategy: 'dip' }).verdict).toBe('good');
    expect(
      judge({ ...learned, releaseFrom: 'first_sale' }, { strategy: 'steady' }).newRelease,
    ).toBe(false);
  });

  it('Bargain and Margin, and own target only', () => {
    expect(buyZone(stats({}), { strategy: 'bargain' }).top).toBe(8000);
    expect(buyZone(stats({ usual180: 12000 }), { strategy: 'margin', margin: 20 }).top).toBe(9600);
    expect(buyZone(stats({}), { strategy: 'target' }).top).toBeNull();
    expect(judge(stats({ fair: 1 }), { strategy: 'target' }).verdict).toBe('fair');
  });

  it('falls back to a margin with little data, and says so', () => {
    const thin = stats({ q25d180: null, q75d180: null, q10d365: null, usual180: null, sales30: 1 });
    const j = judge(thin, { strategy: 'steady' });
    expect(j.zone).toMatchObject({ top: 9000, basis: 'thin_margin' });
    expect(j.limited).toEqual(['few_sales', 'short_range']);
    // Only a listing can be under it.
    expect(j.verdict).toBe('fair');
    expect(judge({ ...thin, ask: 8900 }, { strategy: 'steady' }).askInZone).toBe(true);
  });

  it('lowers the zone by the new-set pattern when similar items kept falling', () => {
    const z = buyZone(stats({ pattern: { items: 3, change: -0.3, horizonDays: 90 } }), {
      strategy: 'steady',
    });
    expect(z).toMatchObject({ top: 7000, pattern: true });
    const up = buyZone(stats({ pattern: { items: 3, change: 0.2, horizonDays: 90 } }), {
      strategy: 'steady',
    });
    expect(up).toMatchObject({ top: 9000, pattern: false });
  });

  it('suggests a range for sealed and cards, a margin elsewhere', () => {
    expect(suggestedStrategy('sealed').strategy).toBe('steady');
    expect(suggestedStrategy('card').strategy).toBe('steady');
    expect(suggestedStrategy('game')).toEqual({ strategy: 'margin', margin: 10 });
  });
});

describe('new-set pattern', () => {
  // Each similar item: hype at release, down 30 % by day 90.
  const item = (release: string) => ({
    release,
    series: days(release, 200, (i) => (i < 30 ? 1000 : i < 120 ? 1000 - (i - 30) * 3.4 : 700)),
  });

  it('compares similar items from this age to 90 days later, only what already happened', () => {
    const others = [item('2025-01-01'), item('2025-02-01'), item('2025-03-01')];
    const p = newSetPattern(30, others, '2026-01-01');
    expect(p?.items).toBe(3);
    expect(p!.change).toBeLessThan(-0.25);
    // Too few items, too old, or not happened yet.
    expect(newSetPattern(30, others.slice(0, 2), '2026-01-01')).toBeNull();
    expect(newSetPattern(400, others, '2026-01-01')).toBeNull();
    expect(newSetPattern(30, others, '2025-05-01')).toBeNull();
  });

  it('counts an item collected only from later, from that age', () => {
    const late = { ...item('2025-01-01'), series: item('2025-01-01').series.slice(100) };
    expect(
      newSetPattern(30, [late, item('2025-02-01'), item('2025-03-01')], '2026-01-01'),
    ).toBeNull();
    expect(
      newSetPattern(105, [late, item('2025-02-01'), item('2025-03-01')], '2026-01-01')?.items,
    ).toBe(3);
  });
});

describe('new-release wait and lines', () => {
  it('learns the age of the first-year low from items with a full first year', () => {
    const v = (low: number) => (i: number) => 1000 + Math.abs(i - low) * 3;
    const others = [
      { release: '2024-01-01', series: days('2024-01-01', 365, v(100)) },
      { release: '2024-02-01', series: days('2024-02-01', 365, v(120)) },
      { release: '2024-03-01', series: days('2024-03-01', 365, v(200)) },
      // Collected only from day 60: not a full first year.
      { release: '2024-01-01', series: days('2024-03-01', 300, v(10)) },
    ];
    const low = typicalLowAge(others, '2026-01-01')!;
    expect(low.items).toBe(3);
    expect(low.age).toBeGreaterThanOrEqual(113);
    expect(low.age).toBeLessThanOrEqual(120);
    // A year not over yet does not count.
    expect(typicalLowAge(others, '2025-01-15')).toBeNull();
  });

  it('reads Pokemon lines from titles, and studies the line when it has enough items', () => {
    expect(lineFromTitle('拡張パック「バトルパートナーズ」')).toBe('main');
    expect(lineFromTitle('ポケモンカードゲーム 強化拡張パック「ポケモンカード151」ボックス')).toBe(
      'sub',
    );
    expect(lineFromTitle('ハイクラスパック 「シャイニートレジャーex」')).toBe('high_class');
    expect(lineFromTitle('拡張パック「30th CELEBRATION」')).toBe('special');
    expect(lineFromTitle('スタートデッキGenerations')).toBeNull();
    const items = [{ line: 'a' }, { line: 'a' }, { line: 'b' }, { line: null }];
    const count = (l: typeof items) => (l.length >= 2 ? { n: l.length } : null);
    expect(byLine('a', items, count)).toEqual({ n: 2, line: 'a' });
    expect(byLine('b', items, count)).toEqual({ n: 4, line: null });
    expect(byLine(null, items, count)).toEqual({ n: 4, line: null });
  });

  it('tries the strategies on the three fixed examples, the new set waiting 90 days', () => {
    const examples = strategyExamples();
    expect(examples.map((e) => e.key)).toEqual([...STRATEGY_EXAMPLES]);
    for (const e of examples) {
      const steady = replayExample(e, { strategy: 'steady' });
      const dip = replayExample(e, { strategy: 'dip' });
      expect(steady.calls.length).toBeGreaterThan(0);
      expect(dip.calls.length).toBeGreaterThanOrEqual(steady.calls.length);
    }
    const newSet = examples.find((e) => e.key === 'new_set')!;
    const first = replayExample(newSet, { strategy: 'steady' }).calls[0]!;
    expect(Date.parse(first) - Date.parse(newSet.release!.day)).toBeGreaterThanOrEqual(
      90 * 86_400_000,
    );
  });
});

describe('replay', () => {
  it('calls buys on the days a strategy says so and checks 90 days later', () => {
    // A year flat at 1000 with a dip to 800 in month 9, then back.
    const series = days('2025-01-01', 730, (i) => (i >= 600 && i < 620 ? 800 : 1000 + (i % 7)));
    const r = replay(series, { strategy: 'steady' }, '2026-12-31');
    expect(r.calls.length).toBeGreaterThan(0);
    expect(r.avgPaid!).toBeLessThan(r.avgAll!);
    expect(r.higher).toBe(r.checked);
  });
});
