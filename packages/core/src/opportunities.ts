// Opportunities (requirements S13 part 1): signals that find items worth buying within a group of
// similar items, from the prices already collected, each tested on the group's past prices. Only
// a signal that beat buying on any day ranks items; the others are shown as not tested yet.
import { median } from './market';
import type { DayPrice } from './signals';

/** Signals that point to a buy, and warnings against one. */
export const OPPORTUNITY_SIGNALS = [
  'line_rising',
  'leader',
  'laggard',
  'sales_up',
  'strong_for_age',
  'weak_for_age',
] as const;
export const OPPORTUNITY_WARNINGS = ['line_falling', 'sales_down'] as const;
export type OpportunitySignal =
  (typeof OPPORTUNITY_SIGNALS)[number] | (typeof OPPORTUNITY_WARNINGS)[number];

/** The line's 12-week change (median of its items, 5+) that makes it rising or falling. */
export const LINE_MOVE = 0.1;
export const LINE_MIN_ITEMS = 5;
/** An item's 12-week change this far above or under its line's: a leader or a laggard. */
export const AGAINST_LINE = 0.15;
/** Sales in the last 30 days against the monthly rate of the 90 before (10+ sales either way). */
export const SALES_UP = 1.5;
export const SALES_DOWN = 0.6;
export const SALES_MIN = 10;
/** The last 90 days' change against similar items' at the same age (3+), from day 120 to 3 years. */
export const AGAINST_AGE = 0.2;
export const AGE_MIN_ITEMS = 3;
export const AGE_RANGE = { from: 120, to: 1095 } as const;
/** Tests: checked 90 days later; proven with 10+ checks and 5 points better (or worse) than any day. */
export const OPPORTUNITY_HORIZON = 90;
export const PROVEN_MIN_CHECKS = 10;
export const PROVEN_POINTS = 0.05;
/** Facts shown, not tested: a lowest ask this far under fair value, a shop buy price this near it. */
export const ASK_UNDER = 0.85;
/** An ask under half the recent price is more likely something else (parts, one pack). */
export const ASK_FLOOR = 0.5;
export const BUYLIST_NEAR = 0.8;

/** One item of a group: its line, its real release date (not a first sale), its daily prices. */
export interface OpportunityMember {
  id: string;
  line: string | null;
  release: string | null;
  series: DayPrice[];
}

/** The numbers behind an item's signals on one day. Fractions, not percents. */
export interface OpportunityNumbers {
  /** Fair value: the median of the last 30 days' daily prices (else 90). */
  price: number | null;
  /** The item's fitted 12-week change, and its line's (the median of 5+ items; `line` null: the group). */
  own84: number | null;
  line84: { change: number; items: number; line: string | null } | null;
  /**
   * Sales in the last 30 days, and the monthly rate of the 90 days before (null when its sales
   * were collected for less than 120 days: an item just added would look as if sales picked up).
   */
  sales30: number;
  salesBefore: number | null;
  /** The last 90 days' change, and similar items' typical change at the same age. */
  age: { days: number; change: number; typical: number; items: number } | null;
}

const DAY = 86_400_000;
const dayNumber = (day: string) => Math.floor(Date.parse(`${day.slice(0, 10)}T00:00:00Z`) / DAY);
const dayString = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);

/** A series by day number, searched instead of filtered (tests look at every week of years). */
class Indexed {
  readonly x: number[];
  readonly y: number[];
  readonly c: number[];
  constructor(series: DayPrice[]) {
    this.x = series.map((p) => dayNumber(p.day));
    this.y = series.map((p) => p.price);
    this.c = series.map((p) => p.count);
  }
  get first(): number | null {
    return this.x[0] ?? null;
  }
  private at(v: number) {
    let lo = 0;
    let hi = this.x.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.x[mid]! < v) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
  /** Indexes of the days from `from` to `to`, both included. */
  range(from: number, to: number): [number, number] {
    return [this.at(from), this.at(to + 1)];
  }
  /** The median daily price over the last `days` up to `end` (2+ days). */
  price(end: number, days: number): number | null {
    const [a, b] = this.range(end - days + 1, end);
    return b - a >= 2 ? median(this.y.slice(a, b)) : null;
  }
  /** The typical price around a day (±7 days, 2+ days with sales). */
  around(day: number): number | null {
    const [a, b] = this.range(day - 7, day + 7);
    return b - a >= 2 ? median(this.y.slice(a, b)) : null;
  }
  sales(from: number, to: number): number {
    const [a, b] = this.range(from, to);
    let n = 0;
    for (let i = a; i < b; i++) n += this.c[i]!;
    return n;
  }
  /** The fitted change of log prices over the last `days` (as `fittedChange` in signals.ts). */
  fitted(end: number, days: number): number | null {
    const [a, b] = this.range(end - days + 1, end);
    if (b - a < 4 || this.x[b - 1]! - this.x[a]! < days / 2) return null;
    let mx = 0;
    let my = 0;
    for (let i = a; i < b; i++) {
      mx += this.x[i]!;
      my += Math.log(this.y[i]!);
    }
    mx /= b - a;
    my /= b - a;
    let num = 0;
    let den = 0;
    for (let i = a; i < b; i++) {
      num += (this.x[i]! - mx) * (Math.log(this.y[i]!) - my);
      den += (this.x[i]! - mx) ** 2;
    }
    return den === 0 ? null : Math.exp((num / den) * days) - 1;
  }
}

/**
 * A group of similar items prepared for many days' numbers: each item's line study uses its own
 * line when 5+ of its items have prices, else the whole group (as `byLine`).
 */
export class OpportunityGroup {
  private readonly items: Map<string, { member: OpportunityMember; s: Indexed }>;
  private readonly fits = new Map<string, number | null>();
  private readonly lines = new Map<string, OpportunityNumbers['line84']>();

  constructor(members: OpportunityMember[]) {
    this.items = new Map(
      members
        .filter((m) => m.series.length)
        .map((m) => [m.id, { member: m, s: new Indexed(m.series) }]),
    );
  }

  get size(): number {
    return this.items.size;
  }

  private fit(id: string, end: number): number | null {
    const key = `${id}|${end}`;
    if (!this.fits.has(key)) this.fits.set(key, this.items.get(id)!.s.fitted(end, 84));
    return this.fits.get(key)!;
  }

  private lineChange(line: string | null, end: number): OpportunityNumbers['line84'] {
    const key = `${line ?? ''}|${end}`;
    if (!this.lines.has(key)) {
      const study = (ids: string[]) => {
        const changes = ids.map((id) => this.fit(id, end)).filter((c) => c !== null);
        return changes.length >= LINE_MIN_ITEMS
          ? { change: median(changes)!, items: changes.length }
          : null;
      };
      const all = [...this.items.keys()];
      const own = line ? study(all.filter((id) => this.items.get(id)!.member.line === line)) : null;
      const whole = own ? null : study(all);
      this.lines.set(key, own ? { ...own, line } : whole && { ...whole, line: null });
    }
    return this.lines.get(key)!;
  }

  /** The numbers of an item of the group on a day (only prices up to that day). */
  numbers(id: string, day: string | number): OpportunityNumbers | null {
    const item = this.items.get(id);
    if (!item) return null;
    const end = typeof day === 'number' ? day : dayNumber(day);
    const { member, s } = item;
    let age: OpportunityNumbers['age'] = null;
    const release = member.release ? dayNumber(member.release) : null;
    const days = release === null ? null : end - release;
    const price = s.price(end, 30) ?? s.price(end, 90);
    if (days !== null && days >= AGE_RANGE.from && days <= AGE_RANGE.to) {
      const before = s.price(end - 90, 30);
      const others: number[] = [];
      for (const [otherId, o] of this.items) {
        if (otherId === id || !o.member.release) continue;
        const r = dayNumber(o.member.release);
        // Only what had already happened by this day.
        if (r + days + 7 > end) continue;
        const a = o.s.around(r + days - 90);
        const b = o.s.around(r + days);
        if (a && b) others.push(b / a - 1);
      }
      if (price && before && others.length >= AGE_MIN_ITEMS) {
        age = { days, change: price / before - 1, typical: median(others)!, items: others.length };
      }
    }
    return {
      price: price === null ? null : Math.round(price),
      own84: this.fit(id, end),
      line84: this.lineChange(member.line, end),
      sales30: s.sales(end - 29, end),
      salesBefore: s.first! <= end - 119 ? s.sales(end - 119, end - 30) / 3 : null,
      age,
    };
  }

  /**
   * Each signal tested on the group's whole history: every 7th day (counted back from `asOf`)
   * from 120 days after an item's first sale, its numbers from the prices up to it; a signal is
   * the first such day of each stretch it is on, checked against the typical price 90 days later.
   * Buying on any of those days is the comparison.
   */
  tests(asOf: string): OpportunityTests {
    const end = dayNumber(asOf);
    const any: number[] = [];
    const bySignal = new Map<OpportunitySignal, { signals: number; changes: number[] }>();
    for (const [id, { s }] of this.items) {
      const first = s.first! + 120;
      const on = new Set<OpportunitySignal>();
      // Days on the same weekly grid for every item, so line studies are shared.
      for (let d = end - Math.floor((end - first) / 7) * 7; d <= end; d += 7) {
        const n = this.numbers(id, d);
        if (!n?.price) continue;
        const later = d + OPPORTUNITY_HORIZON + 7 <= end ? s.around(d + OPPORTUNITY_HORIZON) : null;
        const change = later === null ? null : later / n.price - 1;
        if (change !== null) any.push(change);
        const today = new Set(signalsOn(n));
        for (const key of today) {
          if (on.has(key)) continue;
          const t = bySignal.get(key) ?? { signals: 0, changes: [] };
          t.signals++;
          if (change !== null) t.changes.push(change);
          bySignal.set(key, t);
        }
        on.clear();
        for (const key of today) on.add(key);
      }
    }
    const result = (changes: number[], signals = changes.length): OpportunityTest => ({
      signals,
      checked: changes.length,
      higher: changes.filter((c) => c > 0).length,
      change: median(changes),
    });
    return {
      day: dayString(end),
      items: this.items.size,
      any: result(any),
      signals: Object.fromEntries(
        [...bySignal].map(([key, t]) => [key, result(t.changes, t.signals)]),
      ),
    };
  }
}

/** The signals on, from an item's numbers. */
export function signalsOn(n: OpportunityNumbers): OpportunitySignal[] {
  const on: OpportunitySignal[] = [];
  const line = n.line84?.change ?? null;
  if (line !== null && line >= LINE_MOVE) on.push('line_rising');
  if (line !== null && line <= -LINE_MOVE) on.push('line_falling');
  if (line !== null && n.own84 !== null) {
    if (n.own84 >= line + AGAINST_LINE) on.push('leader');
    if (line >= LINE_MOVE && n.own84 <= line - AGAINST_LINE) on.push('laggard');
  }
  const before = n.salesBefore;
  if (before !== null && n.sales30 >= SALES_MIN && n.sales30 >= SALES_UP * before) {
    on.push('sales_up');
  }
  if (before !== null && before >= SALES_MIN && n.sales30 <= SALES_DOWN * before) {
    on.push('sales_down');
  }
  if (n.age) {
    if (n.age.change >= n.age.typical + AGAINST_AGE) on.push('strong_for_age');
    if (n.age.change <= n.age.typical - AGAINST_AGE) on.push('weak_for_age');
  }
  return on;
}

export interface OpportunityTest {
  /** Past signals, those checked 90 days later, and how many of those were higher then. */
  signals: number;
  checked: number;
  higher: number;
  /** The median change 90 days later over the checked ones. */
  change: number | null;
}

export interface OpportunityTests {
  day: string;
  items: number;
  /** Buying on any tested day. */
  any: OpportunityTest;
  signals: Partial<Record<OpportunitySignal, OpportunityTest>>;
}

const isWarning = (key: OpportunitySignal) =>
  (OPPORTUNITY_WARNINGS as readonly string[]).includes(key);

/**
 * How far a signal beat buying on any day (share higher 90 days later, in points; negative for a
 * warning that did worse), when proven: 10+ checks and 5 points or more the right way. Else null.
 */
export function provenEdge(
  tests: OpportunityTests | undefined,
  key: OpportunitySignal,
): number | null {
  const t = tests?.signals[key];
  if (!tests || !t || t.checked < PROVEN_MIN_CHECKS || tests.any.checked === 0) return null;
  const edge = t.higher / t.checked - tests.any.higher / tests.any.checked;
  return (isWarning(key) ? edge <= -PROVEN_POINTS : edge >= PROVEN_POINTS) ? edge : null;
}

/** Proven signals and warnings on for an item, and its rank: proven signals first, then edges. */
export function rankOpportunity(
  on: readonly OpportunitySignal[],
  tests: OpportunityTests | undefined,
): {
  proven: OpportunitySignal[];
  warnings: OpportunitySignal[];
  unproven: OpportunitySignal[];
  score: number;
} {
  const proven: OpportunitySignal[] = [];
  const warnings: OpportunitySignal[] = [];
  const unproven: OpportunitySignal[] = [];
  let score = 0;
  for (const key of on) {
    const edge = provenEdge(tests, key);
    if (edge === null) unproven.push(key);
    else if (isWarning(key)) warnings.push(key);
    else proven.push(key);
    if (edge !== null) score += edge;
  }
  return { proven, warnings, unproven, score };
}
