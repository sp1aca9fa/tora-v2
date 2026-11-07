import { describe, expect, it } from 'vitest';
import {
  DEAL_WAYS,
  askIsUnder,
  cleanDealWay,
  dealWayRecord,
  dealWayStates,
  listingsNear,
} from './deal-ways';
import type { OpportunityNumbers } from './opportunities';

const numbers = (more: Partial<OpportunityNumbers> = {}): OpportunityNumbers => ({
  price: 1000,
  own84: null,
  line84: null,
  sales30: 5,
  salesBefore: 5,
  age: null,
  jump14: 0,
  hold14: 0,
  year: 0.5,
  ...more,
});
const of = (more: Partial<OpportunityNumbers> = {}) => dealWayStates({ numbers: numbers(more) });

describe('dealWayStates', () => {
  it('reads falling hard and rising fast on the 14-day jump, on, off and unknown', () => {
    expect(of({ jump14: -0.2 }).falling_hard).toBe(true);
    expect(of({ jump14: -0.19 }).falling_hard).toBe(false);
    expect(of({ jump14: 0.2 }).rising_fast).toBe(true);
    expect(of({ jump14: 0.19 }).rising_fast).toBe(false);
    for (const jump14 of [null, undefined]) {
      expect(of({ jump14 }).falling_hard).toBeNull();
      expect(of({ jump14 }).rising_fast).toBeNull();
    }
  });

  it('reads cheap, fall paused from the signal, unknown without either number', () => {
    expect(of({ year: 0.05, hold14: 0.01 }).cheap_paused).toBe(true);
    expect(of({ year: 0.9, hold14: 0.01 }).cheap_paused).toBe(false);
    expect(of({ year: null }).cheap_paused).toBeNull();
    expect(of({ hold14: undefined }).cheap_paused).toBeNull();
  });

  it('reads sales picking up from the signal, unknown without a rate before', () => {
    expect(of({ sales30: 15, salesBefore: 10 }).sales_up).toBe(true);
    expect(of({ sales30: 14, salesBefore: 10 }).sales_up).toBe(false);
    expect(of({ salesBefore: null }).sales_up).toBeNull();
  });

  it('reads listings drying up: 30 % down from 5 or more, else off; no count is unknown', () => {
    const drying = (now: number | null, before: number | null) =>
      dealWayStates({ numbers: numbers(), listings: { now, before } }).listings_drying;
    expect(drying(7, 10)).toBe(true);
    expect(drying(49, 70)).toBe(true);
    expect(drying(0, 5)).toBe(true);
    expect(drying(8, 10)).toBe(false);
    expect(drying(12, 10)).toBe(false);
    // Under 5 then: a count is known, and it cannot dry up.
    expect(drying(0, 4)).toBe(false);
    expect(drying(null, 10)).toBeNull();
    expect(drying(3, null)).toBeNull();
    expect(drying(null, null)).toBeNull();
    // Saved before the field existed: unknown, never off.
    expect(dealWayStates({ numbers: numbers() }).listings_drying).toBeNull();
    expect(dealWayStates({ numbers: numbers(), listings: null }).listings_drying).toBeNull();
  });

  it('reads a listing under the market as the card does, unknown without ask or price', () => {
    const under = (price: number, n = numbers()) =>
      dealWayStates({ numbers: n, ask: { price } }).under_market;
    expect(under(850)).toBe(true);
    expect(under(500)).toBe(true);
    expect(under(851)).toBe(false);
    // Under half is likely something else.
    expect(under(499)).toBe(false);
    expect(under(800, numbers({ price: null }))).toBeNull();
    expect(dealWayStates({ numbers: numbers(), ask: null }).under_market).toBeNull();
    expect(askIsUnder({ price: 850 }, 1000)).toBe(true);
    expect(askIsUnder(null, 1000)).toBe(false);
    expect(askIsUnder({ price: 850 }, null)).toBe(false);
  });
});

describe('listingsNear', () => {
  const row = (day: string, listings: number | null) => ({ day, listings });
  it('takes the nearest day with a count, at most 3 days away', () => {
    expect(listingsNear([], '2026-10-20')).toBeNull();
    expect(listingsNear([row('2026-10-20', 9)], '2026-10-20')).toBe(9);
    expect(listingsNear([row('2026-10-17', 9)], '2026-10-20')).toBe(9);
    expect(listingsNear([row('2026-10-23', 9)], '2026-10-20')).toBe(9);
    expect(listingsNear([row('2026-10-16', 9)], '2026-10-20')).toBeNull();
    expect(listingsNear([row('2026-10-24', 9)], '2026-10-20')).toBeNull();
    expect(listingsNear([row('2026-10-18', 9), row('2026-10-21', 4)], '2026-10-20')).toBe(4);
  });
  it('skips a report without a count, keeps a zero, and takes the earlier of two as near', () => {
    expect(listingsNear([row('2026-10-20', null), row('2026-10-22', 3)], '2026-10-20')).toBe(3);
    expect(listingsNear([row('2026-10-20', null)], '2026-10-20')).toBeNull();
    expect(listingsNear([row('2026-10-20', 0)], '2026-10-20')).toBe(0);
    expect(listingsNear([row('2026-10-22', 2), row('2026-10-18', 7)], '2026-10-20')).toBe(7);
  });
});

describe('cleanDealWay and the record', () => {
  it('keeps only a known way', () => {
    for (const way of DEAL_WAYS) expect(cleanDealWay(way)).toBe(way);
    for (const way of ['nope', '', null, undefined, 1, ['sales_up'], 'constructor']) {
      expect(cleanDealWay(way)).toBeNull();
    }
  });
  it('never says a way has a record; a type the table lacks cannot be tested', () => {
    expect(dealWayRecord('falling_hard', 'card')).toBe('weak_or_mixed');
    expect(dealWayRecord('falling_hard', 'sealed')).toBe('cannot_be_tested');
    expect(dealWayRecord('sales_up', 'sealed')).toBe('weak_or_mixed');
    expect(dealWayRecord('listings_drying', 'card')).toBe('cannot_be_tested');
    expect(dealWayRecord('under_market', 'sealed')).toBe('cannot_be_tested');
    expect(dealWayRecord('rising_fast', 'a-new-type')).toBe('cannot_be_tested');
  });
});
