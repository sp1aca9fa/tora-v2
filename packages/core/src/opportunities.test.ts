import { describe, expect, it } from 'vitest';
import {
  type OpportunityNumbers,
  type OpportunityTests,
  type SignalRule,
  OpportunityGroup,
  provenEdge,
  rankOpportunity,
  signalsOn,
  waitPrice,
} from './opportunities';
import type { DayPrice } from './signals';

/** Daily prices from `start` for `n` days, by a function of the day index. */
function days(start: string, n: number, price: (i: number) => number, count = 2): DayPrice[] {
  const t0 = Date.parse(`${start}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => ({
    day: new Date(t0 + i * 86_400_000).toISOString().slice(0, 10),
    price: price(i),
    count,
  }));
}

const numbers = (over: Partial<OpportunityNumbers>): OpportunityNumbers => ({
  price: 10000,
  own84: 0,
  line84: { change: 0, items: 6, line: null },
  sales30: 5,
  salesBefore: 5,
  age: null,
  ...over,
});

describe('signalsOn', () => {
  it('reads the line, the item against it, sales and age', () => {
    expect(signalsOn(numbers({}))).toEqual([]);
    expect(
      signalsOn(numbers({ line84: { change: 0.12, items: 6, line: null }, own84: 0.3 })),
    ).toEqual(['line_rising', 'leader']);
    expect(
      signalsOn(numbers({ line84: { change: 0.12, items: 6, line: null }, own84: -0.05 })),
    ).toEqual(['line_rising', 'laggard']);
    // A laggard needs a rising line.
    expect(signalsOn(numbers({ own84: -0.3 }))).toEqual([]);
    expect(signalsOn(numbers({ line84: { change: -0.1, items: 6, line: null } }))).toEqual([
      'line_falling',
    ]);
    expect(signalsOn(numbers({ sales30: 15, salesBefore: 10 }))).toEqual(['sales_up']);
    expect(signalsOn(numbers({ sales30: 9, salesBefore: 4 }))).toEqual([]);
    expect(signalsOn(numbers({ sales30: 6, salesBefore: 10 }))).toEqual(['sales_down']);
    // Sales collected for less than 120 days: no comparison.
    expect(signalsOn(numbers({ sales30: 150, salesBefore: null }))).toEqual([]);
    expect(
      signalsOn(numbers({ age: { days: 200, change: 0.3, typical: 0.05, items: 3 } })),
    ).toEqual(['strong_for_age']);
    expect(
      signalsOn(numbers({ age: { days: 200, change: -0.2, typical: 0.05, items: 3 } })),
    ).toEqual(['weak_for_age']);
  });
});

describe('OpportunityGroup', () => {
  // Five items rising 2 % a week, one flat: the flat one lags a rising line.
  const rising = (i: number) => 10000 * Math.exp((0.02 / 7) * i);
  const members = [
    ...[1, 2, 3, 4, 5].map((n) => ({
      id: `r${n}`,
      line: null,
      release: null,
      series: days('2025-01-01', 400, (i) => rising(i) * (1 + n / 100)),
    })),
    { id: 'flat', line: null, release: null, series: days('2025-01-01', 400, () => 10000) },
  ];
  const group = new OpportunityGroup(members);

  it('works out an item against its line', () => {
    const n = group.numbers('flat', '2025-12-01')!;
    expect(n.price).toBe(10000);
    expect(n.own84).toBeCloseTo(0, 5);
    expect(n.line84!.items).toBe(6);
    expect(n.line84!.change).toBeGreaterThan(0.1);
    expect(n.sales30).toBe(60);
    expect(signalsOn(n)).toEqual(['line_rising', 'laggard']);
    expect(group.numbers('missing', '2025-12-01')).toBeNull();
  });

  it("compares a single with its set when 5+ of the set's items have prices", () => {
    const flat = (id: string, set: string | null) => ({
      id,
      line: 'era',
      set,
      release: null,
      series: days('2025-01-01', 400, () => 10000),
    });
    const sets = new OpportunityGroup([
      ...members.map((m) => ({ ...m, line: 'era', set: 'S1' })),
      ...[1, 2, 3, 4].map((n) => flat(`f${n}`, 'S2')),
      flat('alone', 'S3'),
    ]);
    expect(sets.numbers('flat', '2025-12-01')!.line84).toMatchObject({ items: 6, line: 'set:S1' });
    // A set of 4: its line (all 11 items).
    expect(sets.numbers('f1', '2025-12-01')!.line84).toMatchObject({ items: 11, line: 'era' });
    expect(sets.numbers('alone', '2025-12-01')!.line84!.line).toBe('era');
  });

  it("runs a signal plug-in on the item's other conditions, and tests it", () => {
    // A slab under twice the raw price for the first 200 days, then over it.
    const slab = (i: number) => (i < 200 ? 15000 : 30000);
    const rule: SignalRule = {
      key: 'slab_cheap',
      label: 'Cheap slab',
      about: 'A slab sells for under twice a raw copy.',
      kinds: ['single'],
      on: (item) => {
        const a = item.price('graded:10', 30);
        const b = item.price('raw:A', 30);
        return !!a && !!b && a < 2 * b;
      },
    };
    const card = {
      id: 'card',
      line: null,
      kind: 'single',
      bucket: 'graded:10',
      release: null,
      series: days('2025-01-01', 400, slab),
      others: { 'raw:A': days('2025-01-01', 400, () => 10000) },
    };
    const g = new OpportunityGroup([card, { ...card, id: 'box', kind: 'box' }], [rule]);
    const early = g.numbers('card', '2025-05-01')!;
    expect(g.signals('card', '2025-05-01', early)).toContain('slab_cheap');
    expect(g.signals('card', '2025-12-01', g.numbers('card', '2025-12-01')!)).not.toContain(
      'slab_cheap',
    );
    // Not a single: the rule does not look at it.
    expect(g.signals('box', '2025-05-01', g.numbers('box', '2025-05-01')!)).not.toContain(
      'slab_cheap',
    );
    // Tested like a built-in signal: on once (one stretch), and higher 90 days later.
    const t = g.tests('2026-02-04').signals.slab_cheap!;
    expect([t.signals, t.higher]).toEqual([1, 1]);
  });

  it('marks a quick rise over the last 14 days', () => {
    const jump = new OpportunityGroup([
      {
        id: 'j',
        line: null,
        release: null,
        series: days('2025-01-01', 200, (i) => (i < 186 ? 10000 : 13000)),
      },
    ]);
    const n = jump.numbers('j', '2025-07-19')!;
    expect(n.jump14).toBeCloseTo(0.3, 5);
    expect(signalsOn(n)).toContain('quick_rise');
  });

  it('marks an item cheap for its year whose fall paused', () => {
    // A year at 10000, then down to 6000 for the last 44 days.
    const fell = (recent: number) =>
      new OpportunityGroup([
        {
          id: 'c',
          line: null,
          release: null,
          series: days('2025-01-01', 400, (i) => (i < 356 ? 10000 : i < 386 ? 6000 : recent)),
        },
      ]).numbers('c', '2026-02-04')!;
    const steady = fell(6100);
    expect(steady.year).toBeLessThan(0.15);
    expect(steady.hold14).toBeCloseTo(0.017, 2);
    expect(signalsOn(steady)).toContain('cheap_steady');
    // Still falling.
    expect(signalsOn(fell(5000))).not.toContain('cheap_steady');
    // A falling line is not held against it.
    const line84 = { change: -0.2, items: 6, line: null };
    expect(signalsOn({ ...steady, line84 })).not.toContain('line_falling');
    expect(signalsOn({ ...fell(5000), line84 })).toContain('line_falling');
    // Under 300 days of prices: no year to compare with.
    const young = new OpportunityGroup([
      { id: 'y', line: null, release: null, series: days('2025-06-01', 200, () => 10000) },
    ]).numbers('y', '2025-12-17')!;
    expect(young.year).toBeNull();
  });

  it('tests each signal against buying on any day', () => {
    const t = group.tests('2026-02-04');
    expect(t.items).toBe(6);
    expect(t.any.checked).toBeGreaterThan(100);
    // The rising items stay rising: the line's signal is followed by higher prices; the flat
    // laggard stays flat (never higher).
    expect(t.signals.line_rising!.signals).toBe(6);
    expect(t.signals.line_rising!.higher).toBe(5);
    expect(t.signals.laggard!.signals).toBe(1);
    expect(t.signals.laggard!.higher).toBe(0);
  });

  it('compares an item with similar items at the same age', () => {
    const young = new OpportunityGroup([
      ...[1, 2, 3].map((n) => ({
        id: `o${n}`,
        line: null,
        release: '2023-01-01',
        series: days('2023-01-01', 500, () => 10000 + n),
      })),
      {
        id: 'new',
        line: null,
        release: '2025-01-01',
        series: days('2025-01-01', 200, (i) => (i < 100 ? 10000 : 14000)),
      },
    ]);
    const n = young.numbers('new', '2025-07-01')!;
    expect(n.age).toMatchObject({ days: 181, items: 3, typical: 0 });
    expect(n.age!.change).toBeCloseTo(0.4, 5);
    expect(signalsOn(n)).toContain('strong_for_age');
  });
});

describe('provenEdge and rankOpportunity', () => {
  const tests: OpportunityTests = {
    day: '2026-10-21',
    items: 20,
    any: { signals: 1000, checked: 1000, higher: 600, change: 0.09 },
    signals: {
      line_rising: { signals: 96, checked: 96, higher: 78, change: 0.33 },
      leader: { signals: 115, checked: 115, higher: 72, change: 0.21 },
      sales_up: { signals: 9, checked: 9, higher: 9, change: 0.3 },
      sales_down: { signals: 117, checked: 117, higher: 44, change: -0.07 },
      line_falling: { signals: 97, checked: 97, higher: 60, change: 0 },
    },
  };

  it('proves a signal only with enough checks and a clear edge', () => {
    expect(provenEdge(tests, 'line_rising')).toBeCloseTo(78 / 96 - 0.6, 5);
    // 63 % against 60 %: under 5 points.
    expect(provenEdge(tests, 'leader')).toBeNull();
    // 9 checks.
    expect(provenEdge(tests, 'sales_up')).toBeNull();
    expect(provenEdge(tests, 'laggard')).toBeNull();
    // A warning is proven when it did worse.
    expect(provenEdge(tests, 'sales_down')).toBeCloseTo(44 / 117 - 0.6, 5);
    expect(provenEdge(tests, 'line_falling')).toBeNull();
    expect(provenEdge(undefined, 'line_rising')).toBeNull();
  });

  it('ranks by proven signals, warnings counting against', () => {
    const r = rankOpportunity(['line_rising', 'leader', 'sales_down'], tests);
    expect(r.proven).toEqual(['line_rising']);
    expect(r.warnings).toEqual(['sales_down']);
    expect(r.unproven).toEqual(['leader']);
    expect(r.score).toBeCloseTo(78 / 96 - 0.6 + (44 / 117 - 0.6), 5);
  });
});

describe('waitPrice', () => {
  const test = (change: number | null) => ({ signals: 20, checked: 20, higher: 5, change });
  const tests = {
    day: '2026-10-28',
    items: 10,
    any: test(0.1),
    signals: { line_falling: test(-0.13), sales_down: test(-0.2) },
  };

  it('lowers the target by the warning after which prices fell most', () => {
    expect(waitPrice(['line_falling', 'sales_down'], tests, 10000)).toEqual({
      key: 'sales_down',
      change: -0.2,
      under: 8000,
      floored: false,
    });
  });

  it("never asks under the past year's cheapest tenth", () => {
    expect(waitPrice(['sales_down'], tests, 10000, 8500)).toMatchObject({
      under: 8500,
      floored: true,
    });
    expect(waitPrice(['sales_down'], tests, 10000, 7000)).toMatchObject({
      under: 8000,
      floored: false,
    });
  });

  it('says nothing when no warning was followed by a fall', () => {
    expect(waitPrice([], tests, 10000)).toBeNull();
    expect(
      waitPrice(['line_falling'], { ...tests, signals: { line_falling: test(0.02) } }, 10000),
    ).toBeNull();
  });

  it('still says wait without a target', () => {
    expect(waitPrice(['line_falling'], tests, null)?.under).toBeNull();
  });
});

describe('out of print and reprints', () => {
  const series = days('2025-01-01', 400, () => 10000);
  const group = new OpportunityGroup([
    { id: 'gone', line: null, release: null, series, reprint: { status: 'none', since: null } },
    {
      id: 'again',
      line: null,
      release: null,
      series,
      reprint: { status: 'likely', since: '2025-11-01' },
    },
  ]);
  const n = numbers({ line84: null });

  it('is on always for an item never made again, from its day for a reprint', () => {
    expect(group.signals('gone', '2025-06-01', n)).toEqual(['out_of_print']);
    expect(group.signals('again', '2025-10-31', n)).toEqual([]);
    expect(group.signals('again', '2025-11-01', n)).toEqual(['reprint_coming']);
  });

  it('tests a mark only from its day: one without a day was not known on past days', () => {
    // series: 400 days from 2025-01-01; the tests run every 7th day from day 120.
    const t = group.tests('2026-02-04');
    expect(t.signals.out_of_print).toBeUndefined();
    expect(t.signals.reprint_coming?.signals).toBe(1);
    // Today the undated mark is on.
    expect(group.signals('gone', '2026-02-04', n)).toEqual(['out_of_print']);
  });
});
