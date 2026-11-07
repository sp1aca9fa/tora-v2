import { describe, expect, it } from 'vitest';
import {
  type TargetItem,
  TARGET_SHARES,
  ageLooksWrong,
  buyTargets,
  firstYearPrices,
  sourceAsOf,
  targetStudy,
} from './buy-targets';
import { type DayPrice, typicalLowDrop } from './signals';

const DAY = 86_400_000;
const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** Weekly-plus prices (every 3 days) from `from` to `to` days after `release`, by a price rule. */
function days(release: string, from: number, to: number, price: (age: number) => number) {
  const out: DayPrice[] = [];
  for (let age = from; age <= to; age += 3) {
    out.push({ day: addDays(release, age), price: price(age), count: 1 });
  }
  return out;
}

/** A similar item released on `release` falling `fall` (0.2: 20 %) in a straight line to day `lowAt`. */
function faller(
  id: string,
  release: string,
  fall: number,
  lowAt = 180,
  line: string | null = null,
) {
  const price = (age: number) => 1000 * (1 - (fall * Math.min(age, lowAt)) / lowAt);
  const item: TargetItem = {
    id,
    release,
    line,
    sources: [days(release, 0, 400, price)],
  };
  return item;
}

const D = '2026-06-01';
const OWN_RELEASE = addDays(D, -30); // Age 30 on D.
const own = (): TargetItem => ({
  id: 'own',
  release: OWN_RELEASE,
  line: null,
  sources: [days(OWN_RELEASE, 0, 150, () => 2000)],
});
const OLD = '2024-01-10';
const group = () => [0.1, 0.2, 0.3, 0.4, 0.5].map((f, i) => faller(`m${i}`, OLD, f));

describe('buyTargets', () => {
  it('sets Good and Ideal from the falls 6 in 10 and 3 in 10 reached, on the own price', () => {
    const t = buyTargets(own(), group(), D)!;
    expect(t.ageDays).toBe(30);
    expect(t.items).toBe(5);
    expect(t.rough).toBe(false);
    expect(t.price).toBe(2000);
    expect(t.fair).toBe(2000);
    expect(t.good!.share).toBe(TARGET_SHARES.good);
    expect(t.ideal!.fall).toBeLessThan(t.good!.fall);
    expect(t.good!.fall).toBeLessThan(0);
    expect(t.good!.price).toBe(Math.round(2000 * (1 + t.good!.fall)));
    expect(t.good!.date > D).toBe(true);
    expect(t.good!.date).toBe(addDays(D, t.good!.days));
    // Confidence is how many got there by the date, so never above how many ever got there.
    expect(t.good!.confidence).toBeLessThanOrEqual(t.good!.reachedInYear);
    expect(t.good!.reachedInYear).toBeCloseTo(0.6, 1);
    expect(t.ideal!.reachedInYear).toBeCloseTo(0.4, 1);
  });

  it('reads rough under 5 similar items, and gives no target under 3', () => {
    const four = buyTargets(own(), group().slice(0, 4), D)!;
    expect(four.rough).toBe(true);
    expect(four.good).not.toBeNull();
    const two = buyTargets(own(), group().slice(0, 2), D)!;
    expect(two.items).toBe(2);
    expect(two.rough).toBe(true);
    expect(two.good).toBeNull();
    expect(two.ideal).toBeNull();
    const none = buyTargets(own(), [], D)!;
    expect(none.items).toBe(0);
    expect(none.good).toBeNull();
  });

  it('keeps an unknown price unknown: no recent sales give no price and no rows', () => {
    const item = { ...own(), sources: [days(OWN_RELEASE, 0, 3, () => 2000)] };
    const t = buyTargets(item, group(), D)!;
    expect(t.price).toBeNull();
    expect(t.good).toBeNull();
    expect(t.items).toBe(5);
    const empty = buyTargets({ ...own(), sources: [] }, group(), D)!;
    expect(empty.price).toBeNull();
    expect(empty.fair).toBeNull();
  });

  it('has no answer before the release or past the first year', () => {
    expect(buyTargets({ ...own(), release: addDays(D, 1) }, group(), D)).toBeNull();
    expect(buyTargets({ ...own(), release: addDays(D, -366) }, group(), D)).toBeNull();
    expect(buyTargets({ ...own(), release: addDays(D, -365) }, group(), D)).not.toBeNull();
  });

  it('has no answer for an item with a sale well before its release date', () => {
    const early: DayPrice = { day: addDays(OWN_RELEASE, -31), price: 2000, count: 1 };
    const item = own();
    item.sources[0] = [early, ...item.sources[0]!];
    expect(ageLooksWrong(item.release, item.sources)).toBe(true);
    expect(buyTargets(item, group(), D)).toBeNull();
    expect(ageLooksWrong(item.release, own().sources)).toBe(false);
  });

  it('gives a fall of 0 and today as the date when similar items did not fall', () => {
    const flat = ['a', 'b', 'c', 'd', 'e'].map((id) => faller(id, OLD, 0));
    const t = buyTargets(own(), flat, D)!;
    expect(t.good!.fall).toBe(0);
    expect(t.good!.price).toBe(2000);
    expect(t.good!.days).toBe(0);
    expect(t.good!.date).toBe(D);
    expect(t.good!.confidence).toBe(1);
  });
});

describe('similar items', () => {
  it('never uses the item itself, nor one whose first year has not passed by the day', () => {
    const young = faller('young', addDays(D, -371), 0.9);
    const passed = faller('passed', addDays(D, -372), 0.9);
    const base = group();
    const withoutYoung = targetStudy(30, { id: 'x', line: null }, [...base, young], D);
    expect(withoutYoung.items).toBe(5);
    const withPassed = targetStudy(30, { id: 'x', line: null }, [...base, passed], D);
    expect(withPassed.items).toBe(6);
    const self = targetStudy(30, { id: 'passed', line: null }, [...base, passed], D);
    expect(self.items).toBe(5);
  });

  it('leaves out an item whose prices stop before day 300, or have none at this age', () => {
    const short: TargetItem = {
      id: 's',
      release: OLD,
      line: null,
      sources: [days(OLD, 0, 299, () => 1000)],
    };
    expect(firstYearPrices(short)).toBeNull();
    const late: TargetItem = {
      id: 'l',
      release: OLD,
      line: null,
      sources: [days(OLD, 100, 400, () => 1000)],
    };
    expect(firstYearPrices(late)).not.toBeNull();
    const base = group();
    expect(targetStudy(30, { id: 'x', line: null }, [...base, short, late], D).items).toBe(5);
    expect(targetStudy(120, { id: 'x', line: null }, [...base, short, late], D).items).toBe(6);
  });

  it('uses the set line only when it has 5 items at this age', () => {
    const inLine = (n: number) =>
      [0.05, 0.06, 0.07, 0.08, 0.09].slice(0, n).map((f, i) => faller(`l${i}`, OLD, f, 180, 'sub'));
    const five = targetStudy(30, { id: 'x', line: 'sub' }, [...group(), ...inLine(5)], D);
    expect(five.line).toBe('sub');
    expect(five.items).toBe(5);
    const four = targetStudy(30, { id: 'x', line: 'sub' }, [...group(), ...inLine(4)], D);
    expect(four.line).toBeNull();
    expect(four.items).toBe(9);
  });

  it('reads a fall the same way as typicalLowDrop, on an item with a full first year', () => {
    const members = group();
    const ours = members.map((m) => {
      const year = firstYearPrices(m)!;
      const later = year.slice(30).filter((p) => p !== null);
      return Math.min(...later) / year[30]! - 1;
    });
    const theirs = typicalLowDrop(
      30,
      members.map((m) => ({ release: m.release, series: m.sources[0]! })),
      D,
    )!;
    expect(ours.toSorted((a, b) => a - b)[2]).toBeCloseTo(theirs.change, 10);
  });
});

describe('no look-ahead', () => {
  /** Every price after D changed, new days added after D, and another source made the longest. */
  const scrambled = (item: TargetItem, seed: number): TargetItem => {
    const after: DayPrice[] = [];
    for (let i = 1; i <= 900; i++) {
      after.push({ day: addDays(D, i), price: seed + i * 7, count: 1 });
    }
    return {
      ...item,
      sources: [
        ...item.sources.map((s) => [
          ...s.filter((p) => p.day <= D),
          ...s.filter((p) => p.day > D).map((p) => ({ ...p, price: p.price * 0.01 + seed })),
        ]),
        after,
      ],
    };
  };
  // Members whose first year passed before D, one straddling D (not usable yet), and the item.
  const straddling = () => faller('straddling', addDays(D, -200), 0.6);

  it('changing every price after the day changes nothing worked out for that day', () => {
    const before = buyTargets(own(), [...group(), straddling()], D);
    const after = buyTargets(
      scrambled(own(), 5),
      [...group(), straddling()].map((m, i) => scrambled(m, 11 + i)),
      D,
    );
    expect(before).not.toBeNull();
    expect(before!.good).not.toBeNull();
    expect(after).toEqual(before);
    expect(sourceAsOf(scrambled(own(), 5).sources, D)).toBe(sourceAsOf(own().sources, D));
  });

  it('changing a price before the day does change it (the check above can fail)', () => {
    const before = buyTargets(own(), group(), D)!;
    const item = own();
    item.sources[0] = item.sources[0]!.map((p) => (p.day <= D ? { ...p, price: 3000 } : p));
    expect(buyTargets(item, group(), D)!.price).not.toBe(before.price);
    const members = group();
    // The middle faller: its fall sets the quantiles, and all its first year is before the day.
    members[2]!.sources[0] = members[2]!.sources[0]!.map((p) => ({ ...p, price: p.price / 2 + 9 }));
    expect(buyTargets(own(), members, D)!.good!.fall).not.toBe(before.good!.fall);
  });
});
