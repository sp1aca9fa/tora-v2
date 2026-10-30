import { describe, expect, it } from 'vitest';
import { type MixOption, checkPlan, monthEnd, planStep, suggestMix, swapInMix } from './plan';
import type { SignalStats } from './signals';

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
const steady = { strategy: 'steady' as const };
const today = '2026-10-21';

describe('planStep', () => {
  it('buys now at a good price, at a listing in the zone when cheaper', () => {
    expect(planStep(stats({ fair: 8800 }), steady, today)).toEqual({
      when: 'now',
      day: today,
      price: 8800,
      reason: 'good',
    });
    expect(planStep(stats({ fair: 8800, ask: 8500 }), steady, today).price).toBe(8500);
  });

  it('waits for a new release until the usual low, a fall, or the zone', () => {
    expect(
      planStep(
        stats({
          fair: 8800,
          ageDays: 30,
          releaseFrom: 'set',
          lowAge: { age: 120, items: 4, line: null },
        }),
        steady,
        today,
      ),
    ).toEqual({ when: 'from', day: '2027-01-19', price: 9000, reason: 'new_release' });
    expect(
      planStep(stats({ fair: 8800, trend14: -0.1, trend28: -0.1 }), steady, today),
    ).toMatchObject({
      when: 'under',
      price: 9000,
      reason: 'falling',
    });
    expect(planStep(stats({ fair: 10500 }), steady, today)).toEqual({
      when: 'under',
      day: null,
      price: 9000,
      reason: 'above_zone',
    });
    expect(planStep(stats({ fair: null }), steady, today).when).toBe('none');
  });
});

describe('checkPlan', () => {
  it('adds the ticked items and says what is late or undated', () => {
    expect(
      checkPlan(
        [
          { when: 'now', day: today, price: 8800, reason: 'good', units: 2 },
          { when: 'from', day: '2027-01-19', price: 9000, reason: 'new_release' },
          { when: 'under', day: null, price: 9000, reason: 'above_zone' },
          { when: 'none', day: null, price: null, reason: 'no_price' },
        ],
        30000,
        '2026-12-31',
      ),
    ).toEqual({ total: 35600, left: -5600, late: 1, undated: 2, unpriced: 1 });
  });
});

describe('suggestMix and swapInMix', () => {
  const opt = (key: string, price: number, over: Partial<MixOption> = {}): MixOption => ({
    key,
    step: { when: 'now', day: null, price, reason: 'good' },
    type: 'sealed',
    set: key,
    worth: false,
    score: 0,
    watched: false,
    ...over,
  });

  it('spreads a budget over types and sets, no item over 40 %', () => {
    const options = [
      opt('big', 50000, { worth: true, score: 0.3 }), // over 40 % of 100,000: left out
      opt('box1', 30000, { worth: true, score: 0.2, set: 'S1' }),
      opt('box2', 25000, { worth: true, score: 0.1, set: 'S1' }), // same set as box1
      opt('box3', 20000, { score: 0.05, set: 'S2', watched: true }),
      // A good price alone is no reason to buy.
      opt('cheap', 500, { set: 'S9' }),
      opt('card1', 35000, { type: 'card', set: 'C1', watched: true }),
      opt('wait', 10000, { step: { when: 'under', day: null, price: 9000, reason: 'falling' } }),
      opt('late', 10000, {
        watched: true,
        step: { when: 'from', day: '2027-01-01', price: 10000, reason: 'new_release' },
      }),
    ];
    expect(suggestMix(options, 100000, '2026-12-31')).toEqual(['box1', 'box3', 'card1']);
    // Without a date, an item from a later day can come in.
    expect(suggestMix(options, 100000, null)).toContain('late');
  });

  it('swaps a pick for the next best that fits, of the same type first', () => {
    const options = [
      opt('a', 25000, { worth: true, score: 0.2 }),
      opt('b', 20000, { score: 0.1, watched: true }),
      opt('c', 15000, { score: 0.05, watched: true }),
      opt('d', 15000, { type: 'card', score: 0.3, worth: true }),
    ];
    const mix = suggestMix(options, 70000, null);
    expect(mix).toEqual(['d', 'a', 'b']);
    expect(swapInMix(options, mix, 'b', 70000, null)).toBe('c');
    expect(swapInMix(options, ['d', 'a', 'b', 'c'], 'b', 70000, null)).toBeNull();
  });
});

it("gives a month's last day (a monthly plan runs to it)", () => {
  expect(['2026-10-31', '2026-11-01', '2028-02-10', '2026-12-15'].map(monthEnd)).toEqual([
    '2026-10-31',
    '2026-11-30',
    '2028-02-29',
    '2026-12-31',
  ]);
});
