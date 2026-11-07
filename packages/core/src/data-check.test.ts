// Fault injection for the self check (plan-self-check.md point 10): synthetic data through the real
// function, each row of the plan's table a test named after it.
import { describe, expect, it } from 'vitest';
import {
  DATA_CHECK,
  type DataCheckDescribed,
  type DataCheckInput,
  type DataCheckNight,
  type DataCheckResult,
  type DataCheckSale,
  type DataCheckSourceNight,
  type DataCheckState,
  dataCheckLine,
  dataCheckStatus,
  dataCheckWithout,
  emptyDataCheckState,
  judgeDataCheck,
  resetDataCheckSource,
} from './data-check';

const START = Date.parse('2026-01-01T00:00:00Z');
const dayAt = (i: number) => new Date(START + i * 86_400_000).toISOString().slice(0, 10);

/** What one source does on one day. */
interface Day {
  sold: number;
  /** Of those, priced at 3x: far from their median. */
  far?: number;
  /** Rows stored, kept or excluded (default: sold / 0.6). */
  found?: number;
  /** Of those, with no condition. */
  noCondition?: number;
  /** Price of every item that day. */
  price?: number;
  /** No run that worked that day. */
  noRun?: boolean;
}
type World = (night: number) => Record<string, Day>;

const ITEMS = 10;

/** One source's sales of one day, spread evenly over the items. */
function salesOf(source: string, night: number, d: Day): DataCheckSale[] {
  const out: DataCheckSale[] = [];
  for (let i = 0; i < d.sold; i++) {
    out.push({
      productId: `item${i % ITEMS}`,
      bucket: i < (d.noCondition ?? 0) ? null : 'raw:A',
      source,
      day: dayAt(night),
      price: (d.price ?? 1000) * (i >= d.sold - (d.far ?? 0) ? 3 : 1),
      estimated: false,
    });
  }
  return out;
}

const MARKETS = { flea: 'jp', auction: 'jp', shop: 'jp' };

/**
 * Runs the check night after night over a world, with two weeks of sales before the first night,
 * as a real source has. `skip`: nights the server was off (no check, no rows, no runs). `breaks`: a
 * night's last re-check day.
 */
function run(
  world: World,
  nights: number,
  options: {
    markets?: Record<string, string | null>;
    skip?: (night: number) => boolean;
    breakDay?: (night: number) => string | null;
    /** Rows as stored tonight, after a re-check or an undo changed which count. */
    keep?: (sale: DataCheckSale, night: number) => boolean;
    /** Nights an admin accepts `flea`'s numbers, after that morning's check. */
    resetAfter?: (night: number) => boolean;
  } = {},
) {
  const markets = options.markets ?? { flea: 'jp' };
  const results: DataCheckResult[] = [];
  const sales: DataCheckSale[] = [];
  const found: Record<string, Record<string, number>> = {};
  const runDays: Record<string, string[]> = {};
  let state: DataCheckState | null = null;
  const add = (night: number) => {
    if (options.skip?.(night)) return;
    for (const [source, d] of Object.entries(world(night))) {
      sales.push(...salesOf(source, night, d));
      (found[source] ??= {})[dayAt(night)] = d.found ?? Math.round(d.sold / 0.6);
      if (!d.noRun) (runDays[source] ??= []).push(dayAt(night));
    }
  };
  for (let n = -14; n < 0; n++) add(n);
  for (let night = 0; night < nights; night++) {
    add(night);
    if (options.skip?.(night)) {
      results.push({ night: { sources: {}, compared: 0 }, findings: [], state: state!, tell: [] });
      continue;
    }
    const from = dayAt(night - 59);
    const input: DataCheckInput = {
      day: dayAt(night),
      sales: sales.filter((s) => s.day >= from && (options.keep?.(s, night) ?? true)),
      found,
      markets,
      runDays,
      breakDay: options.breakDay?.(night) ?? null,
      state,
    };
    const r = judgeDataCheck(input);
    results.push(r);
    state = options.resetAfter?.(night)
      ? resetDataCheckSource(r.state, 'flea', dayAt(night))
      : r.state;
  }
  return results;
}

const told = (results: DataCheckResult[]) =>
  results.flatMap((r, night) => r.tell.map((o) => ({ night, kind: o.kind, source: o.source, o })));

/** A flat source: 300 sales a day, 2 % of them far. */
const steady: Day = { sold: 300, far: 6 };
const flat: World = () => ({ flea: steady });

/** Past nights with these numbers, for tests that set a level exactly. */
function seeded(numbers: Record<string, DataCheckSourceNight>, nights = 14, compared = 0) {
  const state = emptyDataCheckState();
  for (let n = 0; n < nights; n++) {
    state.days[dayAt(n)] = { sources: numbers, compared } satisfies DataCheckNight;
  }
  state.lastRun = dayAt(nights - 1);
  return state;
}

/** Tonight's rows, exactly so many in the week, far ones among them; 5+ older rows hold the median. */
function tonight(day: string, source: string, judged: number, far: number, kept = judged) {
  const sales: DataCheckSale[] = [];
  const older = new Date(Date.parse(`${day}T00:00:00Z`) - 20 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  for (let i = 0; i < 40; i++) {
    sales.push({
      productId: `item${i % 4}`,
      bucket: 'raw:A',
      source,
      day: older,
      price: 1000,
      estimated: false,
    });
  }
  for (let i = 0; i < kept; i++) {
    sales.push({
      productId: `item${i % 4}`,
      bucket: i < judged ? 'raw:A' : null,
      source,
      day,
      price: i < far ? 5000 : 1000,
      estimated: false,
    });
  }
  return sales;
}

/** One night's check on a seeded state. */
function night(
  state: DataCheckState,
  sales: DataCheckSale[],
  found: number,
  markets: Record<string, string | null> = { flea: 'jp' },
) {
  const day = dayAt(Object.keys(state.days).length);
  const week = Array.from({ length: 7 }, (_, i) => dayAt(Object.keys(state.days).length - i));
  return judgeDataCheck({
    day,
    sales,
    found: Object.fromEntries(Object.keys(markets).map((s) => [s, { [day]: found }])),
    markets,
    runDays: Object.fromEntries(Object.keys(markets).map((s) => [s, week])),
    breakDay: null,
    state,
  });
}

/** Sold rows of one item and condition at one price, in the month. */
function priced(
  source: string,
  productId: string,
  price: number,
  count = 5,
  day = dayAt(14),
): DataCheckSale[] {
  return Array.from({ length: count }, () => ({
    productId,
    bucket: 'raw:A',
    source,
    day,
    price,
    estimated: false,
  }));
}

/** A check whose sources have had their 14 nights, on tonight's rows only. */
const across = (sales: DataCheckSale[], markets: Record<string, string | null>) =>
  judgeDataCheck({
    day: dayAt(14),
    sales,
    found: {},
    markets,
    runDays: Object.fromEntries(Object.keys(markets).map((s) => [s, [dayAt(14)]])),
    breakDay: null,
    state: seeded(
      Object.fromEntries(
        Object.keys(markets).map((s) => [s, { judged: 0, far: 0, kept: 0, found: 0 }]),
      ),
    ),
  });

describe('a healthy world', () => {
  it('healthy 30 nights with noise: 0 findings, 0 messages', () => {
    // Sales swing 10 % and the far share 1.5 to 2.5 %, on a fixed pattern.
    const noisy: World = (n) => ({
      flea: { sold: 300 + ((n * 37) % 60) - 30, far: 5 + (n % 3) },
      auction: { sold: 150 + ((n * 23) % 30) - 15, far: 3 + (n % 2) },
    });
    const results = run(noisy, 30, { markets: { flea: 'jp', auction: 'jp' } });
    expect(results.flatMap((r) => r.findings)).toEqual([]);
    expect(told(results)).toEqual([]);
    expect(Object.keys(results.at(-1)!.state.days)).toHaveLength(30);
    expect(results.at(-1)!.state.open).toEqual({});
  });

  it('changes nothing it is given', () => {
    const state = seeded({ flea: { judged: 200, far: 4, kept: 200, found: 300 } });
    const before = JSON.stringify(state);
    const sales = tonight(dayAt(14), 'flea', 100, 50);
    const salesBefore = JSON.stringify(sales);
    night(state, sales, 300);
    expect(JSON.stringify(state)).toBe(before);
    expect(JSON.stringify(sales)).toBe(salesBefore);
  });

  it('leaves out of prices a sale with a guessed lot size, and counts it as kept', () => {
    const sales = [
      ...tonight(dayAt(14), 'flea', 100, 0),
      ...Array.from({ length: 20 }, () => ({
        productId: 'item0',
        bucket: 'raw:A',
        source: 'flea',
        day: dayAt(14),
        price: 90_000,
        estimated: true,
      })),
    ];
    const r = night(seeded({ flea: { judged: 100, far: 2, kept: 100, found: 200 } }), sales, 200);
    expect(r.night.sources.flea).toMatchObject({ judged: 100, far: 0, kept: 120 });
  });
});

describe('learning', () => {
  it('night 13 with every fault: 0 told; same faults on night 15: told', () => {
    const faulty: World = (n) =>
      n < 12
        ? { flea: steady, auction: { sold: 300, far: 6 } }
        : // A far share of 20 %, sales a fifth, and one source at 3x the other.
          {
            flea: { sold: 60, far: 12, found: 500 },
            auction: { sold: 300, far: 6, price: 3000 },
          };
    const results = run(faulty, 16, { markets: { flea: 'jp', auction: 'jp' } });
    expect(told(results.slice(0, 14))).toEqual([]);
    const kinds = new Set(
      told(results)
        .filter((t) => t.night === 14)
        .map((t) => t.kind),
    );
    expect(kinds).toContain('far');
    expect(kinds).toContain('kept');
    expect(kinds).toContain('rate');
  });

  it('a new source says nothing for its own 14 nights, whatever it does', () => {
    // It appears on night 20, with a far share and a keep rate nothing else would allow.
    const results = run(
      (n) => ({
        flea: steady,
        ...(n >= 20 ? { auction: { sold: 100, far: 3 } } : {}),
      }),
      36,
      { markets: { flea: 'jp', auction: 'jp' } },
    );
    expect(told(results)).toEqual([]);
    expect(dataCheckStatus(results[25]!.state, 'auction')).toEqual({
      status: 'learning',
      nights: 6,
    });
    expect(dataCheckStatus(results[35]!.state, 'auction')).toEqual({ status: 'watching' });
  });

  describe('the ceiling and `leans` wait for the source its own 14 nights', () => {
    const three = MARKETS;
    /** A new source: 12 items at 3x the others, and 10 % of its week's sales far. */
    const newcomer = (day: string) => [
      ...Array.from({ length: 12 }, (_, i) => [
        ...priced('flea', `l${i}`, 1000, 5, day),
        ...priced('shop', `l${i}`, 1000, 5, day),
        ...priced('auction', `l${i}`, 3000, 5, day),
      ]).flat(),
      ...tonight(day, 'auction', 100, 16),
    ];
    const level = { judged: 60, far: 0, kept: 60, found: 60 };
    const next = (state: DataCheckState, i: number) =>
      judgeDataCheck({
        day: dayAt(30 + i),
        sales: newcomer(dayAt(30 + i)),
        found: {},
        markets: three,
        runDays: {},
        breakDay: null,
        state,
      });

    it('a new source at 10 % far and 12 leans on global night 30: silent, told on its own night 15', () => {
      let state: DataCheckState = seeded({ flea: level, shop: level }, 30);
      for (let i = 0; i < 14; i++) {
        const r = next(state, i);
        expect(r.findings.filter((f) => f.kind !== 'apart')).toEqual([]);
        // `apart` keeps the check's own gate: it was told the first night.
        if (i === 0) expect(r.tell.some((o) => o.kind === 'apart')).toBe(true);
        state = r.state;
      }
      const fifteenth = next(state, 14);
      expect(fifteenth.tell.map((o) => `${o.kind}:${o.source}`).toSorted()).toEqual([
        'far:auction',
        'leans:auction',
      ]);
      expect(fifteenth.tell[0]).toMatchObject({ kind: 'far', share: 10 });
    });

    it('a reset settles them too: `leans` says nothing for 14 nights', () => {
      let state: DataCheckState = seeded({ flea: level, shop: level, auction: level }, 30);
      expect(next(state, 0).findings.some((f) => f.kind === 'leans')).toBe(true);
      state = resetDataCheckSource(state, 'auction', dayAt(29));
      for (let i = 0; i < 14; i++) {
        const r = next(state, i);
        expect(r.findings.filter((f) => f.source === 'auction' && f.kind !== 'apart')).toEqual([]);
        state = r.state;
      }
      expect(next(state, 14).tell.map((o) => o.kind)).toContain('leans');
    });

    const standing: World = () => ({ flea: { sold: 100, far: 6 } });
    it('a standing 6 %: told, reset, nothing for 14 nights, told once more', () => {
      const results = run(standing, 45, { resetAfter: (n) => n === 20 });
      expect(told(results).map((t) => [t.night, t.kind])).toEqual([
        [14, 'far'],
        [35, 'far'],
      ]);
    });

    it('reset every morning for 20 nights: 0 messages', () => {
      expect(told(run(standing, 20, { resetAfter: () => true }))).toEqual([]);
      const late = run(standing, 34, { resetAfter: (n) => n >= 14 });
      expect(told(late).map((t) => t.night)).toEqual([14]);
    });
  });
});

describe('far', () => {
  it("one source's far share 1.6x, 10 nights: one finding, told once, and back: told again", () => {
    // 2.5 % becomes 4 % a day. The week's number passes 1.5x on the 6th such night.
    const world: World = (n) => ({
      flea: { sold: 200, far: (n >= 30 && n < 40) || n >= 60 ? 8 : 5 },
    });
    const results = run(world, 75);
    const far = told(results).filter((t) => t.kind === 'far');
    expect(far.map((t) => t.night)).toEqual([35, 65]);
    expect(far[0]!.o).toMatchObject({ source: 'flea', share: 3.8, usual: 2.5, ceiling: false });
    // All 10 nights one message; 3 judged fine nights close it; back, it is said again.
    expect(results[40]!.state.open['far:flea']).toMatchObject({ told: true });
    expect(results[42]!.state.open['far:flea']).toMatchObject({ fine: 2 });
    expect(results[43]!.state.open['far:flea']).toBeUndefined();
  });

  it('a bad stretch that fired stays out of the level', () => {
    const world: World = (n) => ({ flea: { sold: 200, far: n >= 20 ? 8 : 5 } });
    const results = run(world, 70);
    // 50 nights at 4 %, and the usual is still 2.5 %.
    expect(told(results).filter((t) => t.kind === 'far')).toHaveLength(1);
    const open = results.at(-1)!.state.open['far:flea'];
    expect(open).toMatchObject({ usual: 2.5, told: true });
    expect(results.at(-1)!.night.sources.flea!.odd).toContain('far');
  });

  it('share up 2 % a night from 3 %: relative silent, the ceiling fires on crossing 5 %', () => {
    const SOLD = 400;
    const rate = (n: number) => 0.03 * 1.02 ** Math.max(0, n - 20);
    const world: World = (n) => ({ flea: { sold: SOLD, far: Math.round(SOLD * rate(n)) } });
    const results = run(world, 70);
    const far = told(results).filter((t) => t.kind === 'far');
    expect(far).toHaveLength(1);
    expect(far[0]!.o).toMatchObject({ ceiling: true });
    // Crossing 5 % a day takes 26 nights; the week's number follows 3 nights later.
    expect(far[0]!.night - 20).toBe(29);
    expect((far[0]!.o as { share: number }).share).toBeGreaterThanOrEqual(5);
  });

  const level = { flea: { judged: 1000, far: 20, kept: 1000, found: 1600 } };
  it.each([
    ['1.49x', 10_000, 298, false],
    ['1.5x', 10_000, 300, true],
    ['1.5x but under a point above usual', 10_000, 30, false],
  ])('at %s of usual', (_, judged, far, fires) => {
    const usual =
      judged === 10_000 && far === 30
        ? { flea: { judged: 10_000, far: 20, kept: 10_000, found: 16_000 } }
        : level;
    const r = night(seeded(usual), tonight(dayAt(14), 'flea', judged, far), 16_000);
    expect(r.tell.some((o) => o.kind === 'far')).toBe(fires);
  });

  it('needs 5+ far sales', () => {
    const usual = { flea: { judged: 100, far: 1, kept: 100, found: 160 } };
    const four = night(seeded(usual), tonight(dayAt(14), 'flea', 100, 4), 160);
    expect(four.findings).toEqual([]);
    // At 4 % that is under the ceiling; with 5 it is 1.5x a usual of 1 %, and at the ceiling too.
    expect(night(seeded(usual), tonight(dayAt(14), 'flea', 100, 5), 160).tell[0]).toMatchObject({
      kind: 'far',
      ceiling: false,
    });
  });

  it('needs a full point above usual: 1.99 % against 1 % does not fire; 2 % does', () => {
    const usual = { flea: { judged: 10000, far: 100, kept: 10000, found: 16000 } };
    const at = (far: number) =>
      night(seeded(usual), tonight(dayAt(14), 'flea', 10000, far), 16000).findings;
    expect(at(199)).toEqual([]);
    expect(at(200)).toMatchObject([{ kind: 'far', source: 'flea' }]);
  });

  it('5.0 % on 100 judged fires once; 4.9 % does not; 5.0 % on 99 is unknown', () => {
    const usual = { flea: { judged: 100, far: 4, kept: 100, found: 160 } };
    const at = (judged: number, far: number) =>
      night(seeded(usual), tonight(dayAt(14), 'flea', judged, far), 160);
    const five = at(100, 5);
    expect(five.tell).toHaveLength(1);
    expect(five.tell[0]).toMatchObject({ kind: 'far', share: 5, ceiling: true });
    expect(at(1000, 49).findings).toEqual([]);
    const thin = at(99, 5);
    expect(thin.findings.some((f) => f.kind === 'far')).toBe(false);
    // Unknown stays unknown: no night judged, no count toward anything.
    expect(thin.night.sources.flea).toMatchObject({ judged: 99, far: 5 });
  });

  describe('after a break, with no level to read', () => {
    it('share 3 % against 1 %, a break on night 40: stays open, one message; back to 1 %: closes after 3 fine nights', () => {
      const world: World = (n) => ({ flea: { sold: 200, far: n >= 30 && n < 50 ? 6 : 2 } });
      const results = run(world, 70, { breakDay: (n) => (n >= 40 ? dayAt(40) : null) });
      const far = told(results).filter((t) => t.kind === 'far');
      expect(far.map((t) => t.night)).toEqual([33]);
      expect(far[0]!.o).toMatchObject({ usual: 1, ceiling: false });
      for (let n = 33; n < 53; n++) {
        expect(results[n]!.state.open['far:flea'], `night ${n}`).toMatchObject({
          fine: 0,
          usual: 1,
        });
      }
      expect(results[54]!.state.open['far:flea']).toMatchObject({ fine: 2 });
      expect(results[55]!.state.open['far:flea']).toBeUndefined();
      expect(results[69]!.state.open).toEqual({});
    });

    it('opened by the ceiling alone, share 4 % after a break: the ceiling judges, and it closes', () => {
      const world: World = (n) => ({
        flea: { sold: 200, far: n >= 45 ? 8 : n >= 31 ? 14 : 5 },
      });
      const results = run(world, 60, { breakDay: (n) => (n >= 30 ? dayAt(30) : null) });
      const far = told(results).filter((t) => t.kind === 'far');
      expect(far.map((t) => t.night)).toEqual([34]);
      expect(far[0]!.o).toMatchObject({ usual: null, ceiling: true });
      expect(results[50]!.state.open['far:flea']).toMatchObject({ fine: 2, usual: null });
      expect(results[51]!.state.open['far:flea']).toBeUndefined();
      expect(results[59]!.findings).toEqual([]);
    });
  });

  it('a standing level over the ceiling is told on the first judged night, and once', () => {
    const results = run(() => ({ flea: { sold: 100, far: 7 } }), 30);
    expect(told(results).map((t) => [t.night, t.kind])).toEqual([[14, 'far']]);
    expect(told(results)[0]!.o).toMatchObject({ ceiling: true, usual: 7 });
  });
});

describe('kept', () => {
  const fall =
    (by: number): World =>
    (n) => ({
      flea: {
        sold: n >= 30 ? Math.round(300 * (1 - by)) : 300,
        found: n >= 30 ? Math.round(500 * (1 - by)) : 500,
        far: 6,
      },
    });
  it("a source's rows fall 50 %: `kept` on night 5", () => {
    const results = run(fall(0.5), 60);
    const kept = told(results).filter((t) => t.kind === 'kept');
    expect(kept.map((t) => t.night)).toEqual([34]);
    expect(kept[0]!.o).toMatchObject({ source: 'flea', usual: 2100 });
    // Found fell with it: no rule at fault, keep rate quiet.
    expect(told(results).filter((t) => t.kind === 'rate')).toEqual([]);
  });

  it("a source's rows fall 25 %: nothing", () => {
    expect(told(run(fall(0.25), 60))).toEqual([]);
  });

  it('50 % with failed runs on 3 of 7 days: nothing', () => {
    const world: World = (n) => ({
      flea: { ...fall(0.5)(n).flea!, noRun: n >= 30 && (n - 30) % 7 < 3 },
    });
    expect(told(run(world, 60)).filter((t) => t.kind === 'kept')).toEqual([]);
  });

  it('exactly 0.7x does not fire; just under does', () => {
    const usual = { flea: { judged: 1000, far: 10, kept: 1000, found: 1600 } };
    const at = (kept: number) =>
      night(seeded(usual), tonight(dayAt(14), 'flea', kept, 0), 1600).findings.some(
        (f) => f.kind === 'kept',
      );
    expect(at(700)).toBe(false);
    expect(at(699)).toBe(true);
  });

  it('a level under 100 says nothing', () => {
    const usual = { flea: { judged: 99, far: 0, kept: 99, found: 99 } };
    const r = night(seeded(usual), tonight(dayAt(14), 'flea', 5, 0), 99);
    expect(r.findings).toEqual([]);
  });

  it('a lasting fall of a third stays open for 40 nights, one message; back: closes after 3 fine nights', () => {
    // Its week's number reaches 0.67x on the 7th night, and stays there.
    const world: World = (n) => {
      const low = n >= 30 && n < 70;
      return { flea: { sold: low ? 201 : 300, found: low ? 335 : 500, far: low ? 4 : 6 } };
    };
    const results = run(world, 80);
    expect(told(results).map((t) => [t.night, t.kind])).toEqual([[36, 'kept']]);
    for (let n = 36; n < 70; n++) {
      expect(results[n]!.state.open['kept:flea'], `night ${n}`).toMatchObject({
        fine: 0,
        usual: 2100,
      });
    }
    expect(results[71]!.state.open['kept:flea']).toMatchObject({ fine: 2 });
    expect(results[72]!.state.open['kept:flea']).toBeUndefined();
    expect(results[79]!.findings).toEqual([]);
  });

  it('a slow fall is followed, on purpose', () => {
    const world: World = (n) => ({
      flea: { sold: Math.round(300 * 0.99 ** Math.max(0, n - 20)), far: 2 },
    });
    expect(told(run(world, 70)).filter((t) => t.kind === 'kept')).toEqual([]);
  });
});

describe('keep rate', () => {
  const rule =
    (by: number): World =>
    (n) => ({
      flea: {
        sold: n >= 30 ? Math.round(300 * (1 - by)) : 300,
        found: 500,
        far: n >= 30 ? Math.round(3 * (1 - by)) : 3,
      },
    });
  it('a rule drops 40 %, found steady: keep rate on night 6, with `kept`, one message', () => {
    const results = run(rule(0.4), 45);
    expect(
      told(results)
        .map((t) => [t.night, t.kind])
        .toSorted(),
    ).toEqual([
      [35, 'kept'],
      [35, 'rate'],
    ]);
    expect(results[35]!.tell).toHaveLength(2);
  });

  it('a rule drops 50 %, found steady: keep rate on night 5, with `kept`', () => {
    expect(
      told(run(rule(0.5), 45))
        .map((t) => [t.night, t.kind])
        .toSorted(),
    ).toEqual([
      [34, 'kept'],
      [34, 'rate'],
    ]);
  });

  it('found rising as fast: keep rate alone', () => {
    // A wave doubles what it finds; a rule lets none of it through, so kept stays where it was.
    const world: World = (n) => ({
      flea: { sold: 300, found: n >= 30 ? 1000 : 500, far: 3 },
    });
    const results = run(world, 45);
    expect(told(results).map((t) => t.kind)).toEqual(['rate']);
    expect(told(results)[0]!.o).toMatchObject({ usual: 0.6 });
  });

  it('exactly 0.7x does not fire; under 100 found says nothing', () => {
    const usual = { flea: { judged: 500, far: 0, kept: 500, found: 1000 } };
    const at = (kept: number, found: number) =>
      night(seeded(usual), tonight(dayAt(14), 'flea', kept, 0), found).findings.some(
        (f) => f.kind === 'rate',
      );
    expect(at(350, 1000)).toBe(false);
    expect(at(349, 1000)).toBe(true);
    expect(at(10, 99)).toBe(false);
  });

  it('13 entries under 100 found and one over: no usual to read; 14 of them: it fires', () => {
    const thin = { judged: 0, far: 0, kept: 90, found: 95 };
    const full = { judged: 0, far: 0, kept: 90, found: 100 };
    const state = seeded({ flea: thin });
    state.days[dayAt(13)] = { sources: { flea: full }, compared: 0 };
    const tonightLow = () => tonight(dayAt(14), 'flea', 10, 0);
    const one = night(state, tonightLow(), 100);
    expect(one.findings).toEqual([]);
    expect(one.state.open).toEqual({});
    expect(night(seeded({ flea: full }), tonightLow(), 100).findings).toMatchObject([
      { kind: 'rate', source: 'flea', usual: 0.9 },
    ]);
  });

  it('with too few rates, an open keep rate stays open: that night is neither fine nor firing', () => {
    const full = { judged: 0, far: 0, kept: 90, found: 100 };
    const state = seeded({ flea: full }, 14);
    state.open['rate:flea'] = {
      key: 'rate:flea',
      kind: 'rate',
      source: 'flea',
      rate: 0.1,
      usual: 0.9,
      openedOn: dayAt(13),
      lastSeenOn: dayAt(13),
      judgedOn: dayAt(13),
      fine: 0,
      told: true,
    };
    state.days[dayAt(13)]!.sources.flea = { ...full, odd: ['rate'] };
    const r = night(state, tonight(dayAt(14), 'flea', 90, 0), 100);
    expect(r.state.open['rate:flea']).toMatchObject({ fine: 0, judgedOn: dayAt(13) });
  });
});

describe('blind', () => {
  it('all new rows lose their condition: `blind` by night 4, `kept` silent', () => {
    const world: World = (n) => ({
      flea: { sold: 300, far: 6, noCondition: n >= 30 ? 300 : 0 },
    });
    const results = run(world, 45);
    expect(told(results).map((t) => [t.night, t.kind])).toEqual([[33, 'blind']]);
    expect(results[44]!.state.open['kept:flea']).toBeUndefined();
  });

  it('exactly half does not fire, and `kept` open holds it back: one fault, one line', () => {
    const usual = { flea: { judged: 1000, far: 10, kept: 1000, found: 1600 } };
    const atJudged = (judged: number) =>
      night(seeded(usual), tonight(dayAt(14), 'flea', judged, 0, 1000), 1600).findings.map(
        (f) => f.kind,
      );
    expect(atJudged(500)).toEqual([]);
    expect(atJudged(499)).toEqual(['blind']);
    // The same fall with kept falling too.
    const both = night(seeded(usual), tonight(dayAt(14), 'flea', 400, 0), 1600);
    expect(both.findings.map((f) => f.kind)).toContain('kept');
    expect(both.findings.map((f) => f.kind)).not.toContain('blind');
  });

  describe('with `kept` open or firing', () => {
    const usual = { flea: { judged: 1000, far: 10, kept: 1000, found: 1600 } };
    const at = (judged: number) =>
      night(seeded(usual), tonight(dayAt(14), 'flea', judged, 0, 500), 800);

    it('a -50 % / -52 % night stays one line, and stays out of the level', () => {
      const r = at(480);
      expect(r.findings.map((f) => f.kind)).toEqual(['kept']);
      expect(r.night.sources.flea!.odd).toEqual(['kept', 'blind']);
    });

    it("at exactly 0.7x of `kept`'s ratio it stays one line; just under, it is a second fault", () => {
      expect(at(350).findings.map((f) => f.kind)).toEqual(['kept']);
      expect(at(349).findings.map((f) => f.kind)).toEqual(['kept', 'blind']);
    });

    it('`kept` open though tonight is over its line, judged just under half: still one line', () => {
      const state = seeded(usual);
      state.open['kept:flea'] = {
        key: 'kept:flea',
        kind: 'kept',
        source: 'flea',
        kept: 500,
        usual: 1000,
        openedOn: dayAt(13),
        lastSeenOn: dayAt(13),
        judgedOn: dayAt(13),
        fine: 0,
        told: true,
      };
      const r = night(state, tonight(dayAt(14), 'flea', 495, 0, 700), 1000);
      expect(r.findings).toEqual([]);
      expect(r.night.sources.flea!.odd).toEqual(['kept', 'blind']);
    });

    it('`kept` open with judged low for 20 nights, `kept` closes with judged still low: told once, not `watching`', () => {
      const world: World = (n) => ({
        flea:
          n < 30
            ? steady
            : n < 50
              ? { sold: 14, found: 23 }
              : // Back to normal, but nearly every row has lost its condition.
                { sold: 300, noCondition: 286 },
      });
      const results = run(world, 70);
      expect(told(results).map((t) => [t.night, t.kind])).toEqual([
        [32, 'kept'],
        [50, 'blind'],
      ]);
      // Held back all the while, and out of its level, so it did not sink to these low nights.
      expect(results[49]!.night.sources.flea!.odd).toEqual(['kept', 'blind']);
      expect(results[49]!.state.open['blind:flea']).toBeUndefined();
      const end = results.at(-1)!.state;
      expect(end.open['kept:flea']).toBeUndefined();
      expect(end.open['blind:flea']).toMatchObject({ usual: 2100, told: true });
      expect(dataCheckStatus(end, 'flea')).toEqual({ status: 'tooFew' });
    });

    it('`kept` open, then all conditions lost: `blind` told', () => {
      const world: World = (n) => ({
        flea: n < 30 ? steady : n < 50 ? { sold: 120, far: 2 } : { sold: 120, noCondition: 120 },
      });
      expect(told(run(world, 60)).map((t) => [t.night, t.kind])).toEqual([
        [33, 'kept'],
        [52, 'blind'],
      ]);
    });
  });

  it('a lasting fall of 52 % in judged stays open for 40 nights, one message; back: closes after 3 fine nights', () => {
    const world: World = (n) => {
      const low = n >= 30 && n < 70;
      return { flea: { sold: 300, far: low ? 3 : 6, noCondition: low ? 156 : 0 } };
    };
    const results = run(world, 80);
    expect(told(results).map((t) => [t.night, t.kind])).toEqual([[36, 'blind']]);
    for (let n = 36; n < 70; n++) {
      expect(results[n]!.state.open['blind:flea'], `night ${n}`).toMatchObject({
        fine: 0,
        usual: 2100,
      });
    }
    expect(results[71]!.state.open['blind:flea']).toMatchObject({ fine: 2 });
    expect(results[72]!.state.open['blind:flea']).toBeUndefined();
  });

  it('nothing compared across sources, against a usual of 20+', () => {
    const check = (compared: number, sales: DataCheckSale[] = []) =>
      judgeDataCheck({
        day: dayAt(14),
        sales,
        found: {},
        markets: { flea: 'jp', auction: 'jp' },
        runDays: {},
        breakDay: null,
        state: seeded({}, 14, compared),
      });
    expect(check(20).tell).toMatchObject([{ kind: 'blind', source: null, compared: 0, usual: 20 }]);
    expect(check(19).findings).toEqual([]);
    // One item compared is enough to say it is not blind.
    const pair = [...priced('flea', 'x', 1000), ...priced('auction', 'x', 1000)];
    expect(check(20, pair).findings).toEqual([]);
  });

  it('a night with no rows at all: `kept` on every watched source, and nothing compared', () => {
    const numbers = { flea: { judged: 300, far: 3, kept: 300, found: 500 } };
    const two = { flea: 'jp', auction: 'jp' };
    const week = Array.from({ length: 7 }, (_, i) => dayAt(14 - i));
    const r = judgeDataCheck({
      day: dayAt(14),
      sales: [],
      found: {},
      markets: two,
      runDays: { flea: week, auction: week },
      breakDay: null,
      state: seeded({ ...numbers, auction: numbers.flea }, 14, 30),
    });
    expect(r.tell.map((o) => `${o.kind}:${o.source}`).toSorted()).toEqual([
      'blind:null',
      'kept:auction',
      'kept:flea',
    ]);
  });
});

describe('`blind` under an open `kept`', () => {
  const blinds = (results: DataCheckResult[]) => told(results).filter((t) => t.kind === 'blind');
  it('a short sharp spike with no fault is never told as lost conditions', () => {
    const spike: World = (n) => ({ flea: { sold: n >= 40 && n < 44 ? 1200 : 300, far: 6 } });
    expect(blinds(run(spike, 90))).toEqual([]);
  });
  it('a lasting fall, then most of the rest losing their condition: told once', () => {
    const fault: World = (n) => {
      const sold = n >= 30 ? 135 : 300;
      return { flea: { sold, far: 2, noCondition: n >= 60 ? 88 : 0 } };
    };
    const results = run(fault, 120);
    expect(told(results).filter((t) => t.kind === 'kept')).toHaveLength(1);
    expect(blinds(results)).toHaveLength(1);
  });
});

describe('leans in a market of two', () => {
  it('a new source can make the older one lean, while its own lean waits its 14 nights', () => {
    const items = (price: number, source: string) =>
      Array.from({ length: 12 }, (_, i) => priced(source, `item${i}`, price)).flat();
    const r = judgeDataCheck({
      day: dayAt(14),
      sales: [...items(1000, 'flea'), ...items(5000, 'fresh')],
      found: {},
      markets: { flea: 'jp', fresh: 'jp' },
      runDays: { flea: [dayAt(14)], fresh: [dayAt(14)] },
      breakDay: null,
      state: seeded({ flea: { judged: 0, far: 0, kept: 0, found: 0 } }),
    });
    expect(r.tell.filter((o) => o.kind === 'leans').map((o) => o.source)).toEqual(['flea']);
  });
});

describe('closing', () => {
  it('`kept` open, server off 3 nights: still open, no second message', () => {
    const world: World = (n) => ({
      flea: { sold: n >= 30 ? 120 : 300, found: n >= 30 ? 200 : 500, far: 2 },
    });
    const off = (n: number) => n >= 40 && n < 43;
    const results = run(world, 50, { skip: off });
    expect(told(results).filter((t) => t.kind === 'kept')).toHaveLength(1);
    expect(results[39]!.state.open['kept:flea']).toBeDefined();
    for (const n of [43, 44, 45, 46, 47]) {
      expect(results[n]!.state.open['kept:flea']).toBeDefined();
    }
    // No entry for a night it did not run: never 0.
    expect(results.at(-1)!.state.days[dayAt(41)]).toBeUndefined();
  });

  it('`far` open, judged falls under 100: still open, no second message', () => {
    const world: World = (n) => ({
      flea:
        n < 30
          ? { sold: 200, far: 5 }
          : n < 40
            ? { sold: 200, far: 8 }
            : // Sales run thin: its share is unknown tonight, so nothing is fine or wrong.
              { sold: 10, far: 1 },
    });
    const results = run(world, 60);
    expect(told(results).filter((t) => t.kind === 'far')).toHaveLength(1);
    expect(results.at(-1)!.state.open['far:flea']).toBeDefined();
  });

  it('a finding open 61 nights: still open, one message, usual still read', () => {
    const world: World = (n) => ({
      flea: { sold: n >= 30 ? 120 : 300, found: n >= 30 ? 200 : 500, far: 2 },
    });
    const results = run(world, 96);
    const kept = told(results).filter((t) => t.kind === 'kept');
    expect(kept).toHaveLength(1);
    const opened = kept[0]!.night;
    expect(results.length - 1 - opened).toBeGreaterThanOrEqual(61);
    expect(results.at(-1)!.state.open['kept:flea']).toMatchObject({ usual: 2100, told: true });
  });

  it('3 nights judged and fine close it', () => {
    const world: World = (n) => ({
      flea: { sold: n >= 30 && n < 40 ? 100 : 300, far: 2, found: n >= 30 && n < 40 ? 170 : 500 },
    });
    const results = run(world, 60);
    const openNights = results.map((r) => !!r.state.open['kept:flea']);
    const firstOpen = openNights.indexOf(true);
    const lastOpen = openNights.lastIndexOf(true);
    expect(firstOpen).toBeGreaterThan(30);
    expect(lastOpen).toBeLessThan(59);
    // The last 3 judged nights before it closed were fine: the numbers recovered on the way.
    expect(results[lastOpen]!.state.open['kept:flea']).toMatchObject({ fine: 2 });
    expect(results[lastOpen + 1]!.findings).toEqual([]);
  });
});

describe('the median', () => {
  it('reads 60 days: a row on the 60th day back counts, one older does not', () => {
    const judged = (daysBack: number) =>
      across(
        [
          ...priced('flea', 'item', 1000, 3),
          ...priced('flea', 'item', 1000, 3, dayAt(14 - daysBack)),
        ],
        { flea: 'jp' },
      ).night.sources.flea?.judged ?? 0;
    expect(judged(59)).toBe(3);
    expect(judged(60)).toBe(0);
  });
});

describe('apart', () => {
  const with5 = (price: number, count = 5) => [
    ...priced('flea', 'item', price, count),
    ...priced('auction', 'item', 1000, 5),
  ];
  const twoSources = { flea: 'jp', auction: 'jp' };
  it.each([
    ['2.1x', 2100, 5, 1],
    ['1.9x', 1900, 5, 0],
    ['exactly 2x', 2000, 5, 0],
    ['exactly half', 500, 5, 0],
    ['under half', 490, 5, 1],
    ['2.1x with 4 sales on one side', 2100, 4, 0],
  ])('at %s', (_, price, count, lines) => {
    const r = across(with5(price, count), twoSources);
    expect(r.findings.filter((f) => f.kind === 'apart')).toHaveLength(lines);
  });

  it('reads 30 days, not 60, and no estimated rows', () => {
    const old = priced('flea', 'item', 5000, 5, dayAt(14 - 31));
    const estimated = priced('flea', 'item', 5000, 5).map((s) => ({ ...s, estimated: true }));
    const r = across([...old, ...estimated, ...priced('auction', 'item', 1000, 5)], twoSources);
    expect(r.findings).toEqual([]);
  });

  it('a side gone 30 nights closes it; until then it stays', () => {
    const open = across(with5(3000), twoSources).state;
    const nights = (i: number) =>
      judgeDataCheck({
        day: dayAt(14 + i),
        sales: [],
        found: {},
        markets: twoSources,
        runDays: {},
        breakDay: null,
        state: { ...open, days: seeded({}, 14 + i).days },
      }).state.open;
    expect(Object.keys(nights(29))).toHaveLength(1);
    expect(Object.keys(nights(30))).toHaveLength(0);
  });

  it('told in one group a week; a day missed loses nothing; gone before then is never told', () => {
    const check = (state: DataCheckState, i: number, sales: DataCheckSale[]) =>
      judgeDataCheck({
        day: dayAt(i),
        sales,
        found: {},
        markets: twoSources,
        runDays: {},
        breakDay: null,
        state,
      });
    const pair = (item: string, i: number, price = 3000) => [
      ...priced('flea', item, price, 5, dayAt(i)),
      ...priced('auction', item, 1000, 5, dayAt(i)),
    ];
    const first = check(seeded({}, 14), 14, pair('one', 14));
    expect(first.tell.map((o) => o.kind)).toEqual(['apart']);
    expect(first.state.itemsToldOn).toBe(dayAt(14));
    // A new one 3 nights later waits; gone by the next group, it is never told.
    const second = check(first.state, 17, [
      ...pair('one', 14),
      ...pair('two', 17),
      ...pair('three', 17),
    ]);
    expect(second.findings).toHaveLength(3);
    expect(second.tell).toEqual([]);
    expect(Object.keys(second.state.open)).toHaveLength(3);
    // On day 23, a day late; "three" came back fine for 3 nights before it, so it is gone.
    let state = second.state;
    for (const i of [18, 19, 20]) {
      state = check(state, i, [
        ...pair('one', 14),
        ...pair('two', 17),
        ...pair('three', i, 1000),
      ]).state;
    }
    expect(Object.keys(state.open)).toHaveLength(2);
    const group = check(state, 23, [...pair('one', 14), ...pair('two', 23)]);
    expect(group.tell.map((o) => (o as { productId: string }).productId)).toEqual(['two']);
    expect(group.state.itemsToldOn).toBe(dayAt(23));
  });
});

describe('what is said first', () => {
  it('11 waiting items and a new `kept` on a due day: the source line comes first', () => {
    const two = { flea: 'jp', auction: 'jp' };
    const level = { judged: 0, far: 0, kept: 700, found: 1000 };
    const sales = (day: string) =>
      Array.from({ length: 11 }, (_, i) => [
        ...priced('flea', `w${i}`, 3000, 5, day),
        ...priced('auction', `w${i}`, 1000, 5, day),
      ]).flat();
    const check = (i: number, state: DataCheckState, runDays: Record<string, string[]>) =>
      judgeDataCheck({
        day: dayAt(i),
        sales: sales(dayAt(i)),
        found: {},
        markets: two,
        runDays,
        breakDay: null,
        state,
      });
    // The items open and wait for their group; no run yet, so `kept` is not judged.
    const waiting = check(14, { ...seeded({ flea: level }), itemsToldOn: dayAt(13) }, {});
    expect(waiting.tell.filter((o) => o.kind === 'apart')).toEqual([]);
    expect(Object.keys(waiting.state.open).filter((k) => k.startsWith('apart'))).toHaveLength(11);

    const week = Array.from({ length: 7 }, (_, i) => dayAt(15 - i));
    const due = check(15, { ...waiting.state, itemsToldOn: dayAt(8) }, { flea: week });
    expect(due.tell[0]!.kind).toBe('kept');
    expect(due.tell.filter((o) => o.kind === 'apart')).toHaveLength(11);
  });
});

describe('leans', () => {
  /** Items where a source reads high or low against two others at 1000. */
  const items = (high: number, low: number) => {
    const sales: DataCheckSale[] = [];
    const add = (id: string, price: number) => {
      sales.push(
        ...priced('flea', id, price),
        ...priced('auction', id, 1000),
        ...priced('shop', id, 1000),
      );
    };
    for (let i = 0; i < high; i++) add(`h${i}`, 3000);
    for (let i = 0; i < low; i++) add(`l${i}`, 300);
    return sales;
  };
  const kinds = (r: DataCheckResult) => r.findings.filter((f) => f.kind === 'leans');

  it('one source 3x on 10 items: `leans` high, and `apart` on each', () => {
    const r = across(items(10, 0), MARKETS);
    expect(kinds(r)).toEqual([{ kind: 'leans', source: 'flea', high: 10, low: 0 }]);
    // Each item is apart from both others.
    expect(r.findings.filter((f) => f.kind === 'apart')).toHaveLength(20);
  });

  it('one source 3x on 9 items: `apart` only', () => {
    const r = across(items(9, 0), MARKETS);
    expect(kinds(r)).toEqual([]);
    expect(r.findings.filter((f) => f.kind === 'apart')).toHaveLength(18);
  });

  it('13 high and 5 low: no `leans`; 10 low: it fires low', () => {
    expect(kinds(across(items(13, 5), MARKETS))).toEqual([]);
    expect(kinds(across(items(0, 10), MARKETS))[0]).toMatchObject({
      source: 'flea',
      high: 0,
      low: 10,
    });
  });
});

describe('markets', () => {
  const pairAt = (market: Record<string, string | null>) => {
    const sales: DataCheckSale[] = [];
    for (let i = 0; i < 15; i++) {
      sales.push(...priced('abroad', `m${i}`, 3000), ...priced('flea', `m${i}`, 1000));
    }
    return across(sales, market);
  };
  it('a us source 3x a jp source on 15 items: nothing', () => {
    const r = pairAt({ abroad: 'us', flea: 'jp' });
    expect(r.findings).toEqual([]);
    expect(r.night.compared).toBe(0);
  });
  it('a source with no market: nothing', () => {
    expect(pairAt({ abroad: null, flea: 'jp' }).findings).toEqual([]);
    expect(pairAt({ abroad: null, flea: null }).findings).toEqual([]);
  });
  it('the same in one market fires, so the two above prove something', () => {
    const kinds = new Set(pairAt({ abroad: 'jp', flea: 'jp' }).findings.map((f) => f.kind));
    expect(kinds).toEqual(new Set(['apart', 'leans']));
  });
  it('sources not asked about are not read at all', () => {
    const r = across([...priced('hidden', 'x', 90_000), ...priced('flea', 'x', 1000)], {
      flea: 'jp',
    });
    expect(JSON.stringify(r)).not.toContain('hidden');
  });
});

describe('steps Tora causes', () => {
  // Rows of the flat world that a re-check takes out from a night on, in a fixed pattern.
  const thinned =
    (share: number, from: number, to = Infinity) =>
    (s: DataCheckSale, night: number) => {
      if (night < from || night >= to) return true;
      return hash(s) >= share;
    };
  let counter = 0;
  const seen = new WeakMap<DataCheckSale, number>();
  const hash = (s: DataCheckSale) => {
    let n = seen.get(s);
    if (n === undefined) {
      n = (counter++ * 0.618034) % 1;
      seen.set(s, n);
    }
    return n;
  };

  it('a re-check dropping 60 % of a source: `kept` and keep rate next morning, one message', () => {
    const results = run(flat, 45, {
      keep: thinned(0.6, 30),
      breakDay: (n) => (n >= 30 ? dayAt(30) : null),
    });
    const t = told(results);
    expect(t.map((x) => [x.night, x.kind]).toSorted()).toEqual([
      [30, 'kept'],
      [30, 'rate'],
    ]);
  });

  it('a re-check of 8 %, then its undo: silent, with `far` relearning', () => {
    const breakDay = (n: number) => (n >= 40 ? dayAt(40) : n >= 30 ? dayAt(30) : null);
    const results = run(flat, 70, { keep: thinned(0.08, 30, 40), breakDay });
    expect(told(results)).toEqual([]);
  });

  it('after a break `far` relearns, while the ceiling, `kept` and keep rate stay on', () => {
    // 1.6x the night after the re-check: no level to read, so silent for 14 nights.
    const relearning: World = (n) => ({ flea: { sold: 200, far: n >= 31 ? 8 : 5 } });
    const breakDay = (n: number) => (n >= 30 ? dayAt(30) : null);
    const relative = run(relearning, 44, { breakDay });
    expect(told(relative)).toEqual([]);
    // At 7 % it fires by the ceiling.
    const high: World = (n) => ({ flea: { sold: 200, far: n >= 31 ? 14 : 5 } });
    const ceiling = told(run(high, 44, { breakDay }));
    expect(ceiling.map((t) => t.kind)).toEqual(['far']);
    expect(ceiling[0]!.o).toMatchObject({ ceiling: true, usual: null });
    // Levels of kept and keep rate never had a break.
    const lost: World = (n) => ({ flea: { sold: n >= 31 ? 100 : 300, found: 500, far: 2 } });
    expect(new Set(told(run(lost, 44, { breakDay })).map((t) => t.kind))).toEqual(
      new Set(['kept', 'rate']),
    );
  });

  it('kept -8 %, share -40 % (rule-sized): nothing', () => {
    const world: World = (n) =>
      n >= 30
        ? { flea: { sold: 276, found: 500, far: 3 } }
        : { flea: { sold: 300, found: 500, far: 6 } };
    expect(told(run(world, 60))).toEqual([]);
  });

  it('a new link with 200 old rows: nothing', () => {
    const results = run(flat, 40);
    // On night 30 a new item arrives with 200 old-dated rows at another price, and 2 recent ones.
    const state = results[29]!.state;
    const day = dayAt(30);
    const sales = [
      ...Array.from({ length: 200 }, () => ({
        productId: 'new',
        bucket: 'raw:A',
        source: 'flea',
        day: dayAt(30 - 30),
        price: 50_000,
        estimated: false,
      })),
      ...priced('flea', 'new', 50_000, 2, day),
      ...Array.from({ length: 2100 }, (_, i) => ({
        productId: `item${i % ITEMS}`,
        bucket: 'raw:A',
        source: 'flea',
        day,
        price: 1000,
        estimated: false,
      })),
    ];
    const week = Array.from({ length: 7 }, (_, i) => dayAt(30 - i));
    const r = judgeDataCheck({
      day,
      sales,
      found: { flea: { [day]: 3500 } },
      markets: { flea: 'jp' },
      runDays: { flea: week },
      breakDay: null,
      state,
    });
    expect(r.findings).toEqual([]);
  });
});

describe('after someone has looked', () => {
  it('a reset starts its levels over and closes its source findings, not others', () => {
    const results = run((n) => ({ flea: { sold: n >= 30 ? 100 : 300, far: 2 } }), 45);
    const state = results.at(-1)!.state;
    expect(state.open['kept:flea']).toBeDefined();
    const withItem: DataCheckState = {
      ...state,
      open: {
        ...state.open,
        'apart:x:raw:A:auction:flea': {
          kind: 'apart',
          source: 'auction',
          other: 'flea',
          productId: 'x',
          bucket: 'raw:A',
          price: 1,
          otherPrice: 3,
          sales: 5,
          otherSales: 5,
          key: 'apart:x:raw:A:auction:flea',
          openedOn: dayAt(44),
          lastSeenOn: dayAt(44),
          judgedOn: dayAt(44),
          fine: 0,
          told: true,
        },
      },
    };
    const reset = resetDataCheckSource(withItem, 'flea', dayAt(44));
    expect(Object.keys(reset.open)).toEqual(['apart:x:raw:A:auction:flea']);
    expect(dataCheckStatus(reset, 'flea')).toEqual({ status: 'learning', nights: 0 });
  });
});

describe('what the page and the data tool show', () => {
  it('watching, learning n of 14, or too few sales to judge', () => {
    expect(dataCheckStatus(null, 'flea')).toEqual({ status: 'learning', nights: 0 });
    const few = { judged: 7, far: 0, kept: 8, found: 8 };
    expect(dataCheckStatus(seeded({ flea: few }, 5), 'flea')).toEqual({
      status: 'learning',
      nights: 5,
    });
    expect(dataCheckStatus(seeded({ flea: few }), 'flea')).toEqual({ status: 'tooFew' });
    expect(
      dataCheckStatus(seeded({ flea: { judged: 100, far: 0, kept: 100, found: 200 } }), 'flea'),
    ).toEqual({ status: 'watching' });
  });

  it('a source with no numbers from the last morning: not seen since its last', () => {
    const numbers = { judged: 300, far: 3, kept: 300, found: 500 };
    const state = seeded({ flea: numbers, auction: numbers });
    state.days[dayAt(14)] = { sources: { flea: numbers }, compared: 0 };
    state.lastRun = dayAt(14);
    expect(dataCheckStatus(state, 'auction')).toEqual({
      status: 'notSeen',
      lastSeen: dayAt(7),
    });
    expect(dataCheckStatus(state, 'flea')).toEqual({ status: 'watching' });
    // Whatever nights it had: it stopped while learning too. With none yet, it is only learning.
    const young = seeded({ flea: numbers, auction: numbers }, 3);
    young.days[dayAt(3)] = { sources: { flea: numbers }, compared: 0 };
    young.lastRun = dayAt(3);
    expect(dataCheckStatus(young, 'auction')).toEqual({ status: 'notSeen', lastSeen: dayAt(-4) });
    expect(dataCheckStatus(young, 'shop')).toEqual({ status: 'learning', nights: 0 });
  });

  it('nothing judged, however many it found or kept: too few, not watching', () => {
    const state = seeded({ flea: { judged: 0, far: 0, kept: 200, found: 200 } });
    expect(dataCheckStatus(state, 'flea')).toEqual({ status: 'tooFew' });
    // A level from before does not make it watched either.
    const lost = seeded({ flea: { judged: 500, far: 5, kept: 500, found: 800 } });
    lost.days[dayAt(14)] = {
      sources: { flea: { judged: 99, far: 0, kept: 500, found: 800 } },
      compared: 0,
    };
    lost.lastRun = dayAt(14);
    expect(dataCheckStatus(lost, 'flea')).toEqual({ status: 'tooFew' });
  });

  it('prints how far apart from the prices, whichever comes first', () => {
    const line = (price: number, otherPrice: number) =>
      dataCheckLine(
        {
          key: 'k',
          openedOn: 'a',
          lastSeenOn: 'a',
          judgedOn: 'a',
          fine: 0,
          told: true,
          label: 'Flea',
          kind: 'apart',
          source: 'flea',
          other: 'auction',
          productId: 'p',
          bucket: 'raw:A',
          price,
          otherPrice,
          sales: 5,
          otherSales: 5,
        },
        (n) => `${n}`,
        (b) => b,
      ).params.times;
    expect(line(780, 50_000)).toBe(64.1);
    expect(line(50_000, 780)).toBe(64.1);
    expect(line(100, 50_000)).toBe(500);
    expect(line(50_000, 100)).toBe(500);
  });

  it('a line for every kind, with what, how much and the usual level', () => {
    const base = { key: 'k', openedOn: 'a', lastSeenOn: 'a', judgedOn: 'a', fine: 0, told: true };
    const money = (n: number) => `¥${n}`;
    const line = (f: Partial<DataCheckDescribed>) =>
      dataCheckLine({ ...base, label: 'Flea', ...f } as DataCheckDescribed, money, (b) => b);
    expect(line({ kind: 'far', source: 'flea', share: 7, usual: 3, judged: 1, far: 1 })).toEqual({
      key: 'dataCheckFar',
      params: { source: 'Flea', share: 7, usual: 3 },
    });
    expect(
      line({ kind: 'far', source: 'flea', share: 7, usual: 6, ceiling: true, judged: 1, far: 1 })
        .key,
    ).toBe('dataCheckFarCeiling');
    expect(
      line({ kind: 'far', source: 'flea', share: 7, usual: null, judged: 1, far: 1 }).key,
    ).toBe('dataCheckFarCeiling');
    expect(line({ kind: 'kept', source: 'flea', kept: 1400, usual: 3100 }).params).toEqual({
      source: 'Flea',
      kept: '1,400',
      usual: '3,100',
    });
    expect(line({ kind: 'rate', source: 'flea', rate: 0.31, usual: 0.6 }).params).toEqual({
      source: 'Flea',
      rate: 31,
      usual: 60,
    });
    expect(line({ kind: 'blind', source: 'flea', judged: 1, usual: 9 }).key).toBe('dataCheckBlind');
    expect(line({ kind: 'blind', source: null, compared: 0, usual: 9, label: null }).key).toBe(
      'dataCheckBlindCompared',
    );
    expect(line({ kind: 'leans', source: 'flea', high: 10, low: 2 }).key).toBe('dataCheckLeans');
    expect(
      line({
        kind: 'apart',
        source: 'flea',
        other: 'auction',
        otherLabel: 'Auction',
        productId: 'p',
        name: 'A game',
        bucket: 'raw:A',
        price: 1000,
        otherPrice: 3100,
        sales: 5,
        otherSales: 6,
      }),
    ).toEqual({
      key: 'dataCheckApart',
      params: {
        name: 'A game',
        condition: 'raw:A',
        source: 'Flea',
        price: '¥1000',
        other: 'Auction',
        otherPrice: '¥3100',
        times: 3.1,
      },
    });
  });
});

describe('a source marked noAi after its numbers were stored', () => {
  const numbers = {
    flea: { judged: 1, far: 0, kept: 1, found: 1 },
    abroad: { judged: 9, far: 9, kept: 9, found: 9 },
  };
  const base = { openedOn: 'a', lastSeenOn: 'a', judgedOn: 'a', fine: 0, told: true };
  const leans: DataCheckState['open'] = {
    'leans:flea': { ...base, key: 'leans:flea', kind: 'leans', source: 'flea', high: 12, low: 0 },
  };

  it('nothing shaped by it stays, though its name is gone: no `leans`, no days, no `compared`', () => {
    const state = { ...seeded(numbers, 2, 30), open: leans };
    state.firstSeen = 'x';
    state.itemsToldOn = 'y';
    expect(dataCheckWithout(state, ['abroad'])).toEqual({
      ...emptyDataCheckState(),
      lastRun: state.lastRun,
      firstSeen: 'x',
      itemsToldOn: 'y',
    });
  });

  it('wherever it appears: one night, an open finding, the other side of one, a reset', () => {
    const flea = { flea: numbers.flea };
    const clean = (change: Partial<DataCheckState>) => ({ ...seeded(flea, 2), ...change });
    const emptied = (state: DataCheckState) => {
      const out = dataCheckWithout(state, ['abroad']);
      expect(out).not.toBe(state);
      expect(out.days).toEqual({});
      expect(out.open).toEqual({});
      expect(out.resets).toEqual({});
    };
    const oneNight = seeded(flea, 2);
    oneNight.days[dayAt(0)] = { sources: numbers, compared: 0 };
    emptied(oneNight);
    emptied(
      clean({
        open: { a: { ...base, key: 'a', kind: 'kept', source: 'abroad', kept: 1, usual: 9 } },
      }),
    );
    emptied(
      clean({
        open: {
          b: {
            ...base,
            key: 'b',
            kind: 'apart',
            source: 'flea',
            other: 'abroad',
            productId: 'p',
            bucket: 'raw:A',
            price: 1,
            otherPrice: 3,
            sales: 5,
            otherSales: 5,
          },
        },
      }),
    );
    emptied(clean({ resets: { abroad: 'a' } }));
  });

  it('a list that never appears in the state changes nothing: eBay is always on it', () => {
    const state = { ...seeded({ flea: numbers.flea }, 2), open: leans };
    expect(dataCheckWithout(state, ['abroad', 'ebay'])).toBe(state);
    expect(dataCheckWithout(state, [])).toBe(state);
  });
});

describe('the limits', () => {
  it('are the ones the plan and the owner were told', () => {
    expect(DATA_CHECK).toMatchObject({
      learnNights: 14,
      farTimesUsual: 1.5,
      farCeiling: 5,
      keptUnder: 0.7,
      rateUnder: 0.7,
      blindUnder: 0.5,
      apartRatio: 2,
      apartMinSales: 5,
      leansNet: 10,
    });
  });
});
