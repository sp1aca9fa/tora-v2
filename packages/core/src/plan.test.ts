import { describe, expect, it } from 'vitest';
import { checkPlan, planStep } from './plan';
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
