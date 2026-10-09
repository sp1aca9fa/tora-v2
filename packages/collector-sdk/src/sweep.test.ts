import { describe, expect, it } from 'vitest';
import { type SweepState, numberIdentical, sweepHistory } from './sweep';

type Trade = { day: string | null; price: number };

/** A fake paged history (newest first), `size` entries per page, with a request log. */
function site(trades: Trade[], size = 3) {
  const requested: number[] = [];
  return {
    requested,
    trades,
    fetchPage: async (page: number) => {
      requested.push(page);
      return trades.slice((page - 1) * size, page * size);
    },
  };
}

/** Saves with refs like the real collectors do; returns the stored set. */
function store() {
  const refs = new Set<string>();
  return {
    refs,
    flushDay: async (day: string, entries: Trade[]) => {
      for (const { ref } of numberIdentical(entries, (e) => `${day}|${e.price}`)) refs.add(ref);
    },
  };
}

const t = (day: string | null, price: number): Trade => ({ day, price });

describe('sweepHistory', () => {
  // Newest first. 10-03 is too recent (after cutoff), one entry has no absolute day.
  const history = [
    t(null, 1),
    t('2026-10-03', 9),
    t('2026-10-02', 5),
    t('2026-10-02', 5),
    t('2026-10-01', 4),
    t('2026-10-01', 3),
    t('2026-09-30', 2),
    t('2026-09-30', 2),
    t('2026-09-30', 2),
    t('2026-09-29', 1),
  ];
  const all = (s: ReturnType<typeof store>) => [...s.refs].sort();

  it('backfills everything up to the cutoff in one run', async () => {
    const h = site(history);
    const s = store();
    const r = await sweepHistory({
      state: null,
      cutoffDay: '2026-10-02',
      maxPages: 10,
      fetchPage: h.fetchPage,
      dayOf: (e) => e.day,
      flushDay: s.flushDay,
    });
    expect(r.complete).toBe(true);
    expect(r.state).toEqual({ mode: 'incremental', ingestedThrough: '2026-10-02' });
    expect(all(s)).toEqual([
      '2026-09-29|1#1',
      '2026-09-30|2#1',
      '2026-09-30|2#2',
      '2026-09-30|2#3',
      '2026-10-01|3#1',
      '2026-10-01|4#1',
      '2026-10-02|5#1',
      '2026-10-02|5#2',
    ]);
  });

  it('gives the same result when cut into runs by the page budget', async () => {
    const h = site(history);
    const s = store();
    let state: SweepState | undefined;
    let runs = 0;
    for (;;) {
      const r = await sweepHistory({
        state,
        cutoffDay: '2026-10-02',
        maxPages: 1,
        fetchPage: h.fetchPage,
        dayOf: (e) => e.day,
        flushDay: s.flushDay,
      });
      state = r.state;
      runs++;
      if (r.complete || runs > 20) break;
    }
    expect(state).toEqual({ mode: 'incremental', ingestedThrough: '2026-10-02' });
    expect(s.refs.size).toBe(8);
    expect(s.refs.has('2026-09-30|2#3')).toBe(true);
  });

  it('survives new trades arriving between interrupted runs', async () => {
    const h = site([...history]);
    const s = store();
    const first = await sweepHistory({
      state: null,
      cutoffDay: '2026-10-02',
      maxPages: 2,
      fetchPage: h.fetchPage,
      dayOf: (e) => e.day,
      flushDay: s.flushDay,
    });
    expect(first.complete).toBe(false);
    // Two new trades push everything down one page and a bit.
    h.trades.unshift(t(null, 7), t(null, 8));
    const second = await sweepHistory({
      state: first.state,
      cutoffDay: '2026-10-02',
      maxPages: 10,
      fetchPage: h.fetchPage,
      dayOf: (e) => e.day,
      flushDay: s.flushDay,
    });
    expect(second.complete).toBe(true);
    expect(s.refs.size).toBe(8);
  });

  it('incremental runs stop at the last saved day and add only newer days', async () => {
    const h = site([...history]);
    const s = store();
    const first = await sweepHistory({
      state: null,
      cutoffDay: '2026-10-02',
      maxPages: 10,
      fetchPage: h.fetchPage,
      dayOf: (e) => e.day,
      flushDay: s.flushDay,
    });
    // Next day: 10-03 is now complete, and a new 10-04 trade appears.
    h.trades.unshift(t('2026-10-04', 10));
    h.requested.length = 0;
    const next = await sweepHistory({
      state: first.state,
      cutoffDay: '2026-10-03',
      maxPages: 10,
      fetchPage: h.fetchPage,
      dayOf: (e) => e.day,
      flushDay: s.flushDay,
    });
    expect(next.state).toEqual({ mode: 'incremental', ingestedThrough: '2026-10-03' });
    expect(h.requested).toEqual([1, 2]); // stopped once it passed 10-02
    expect(s.refs.has('2026-10-03|9#1')).toBe(true);
    expect(s.refs.has('2026-10-04|10#1')).toBe(false);
    expect(s.refs.size).toBe(9);
  });

  it('handles an empty history', async () => {
    const r = await sweepHistory({
      state: null,
      cutoffDay: '2026-10-02',
      maxPages: 5,
      fetchPage: async () => [],
      dayOf: (e: Trade) => e.day,
      flushDay: async () => {},
    });
    expect(r).toMatchObject({ complete: true, daysSaved: 0, state: { mode: 'incremental' } });
  });
});

describe('numberIdentical', () => {
  it('numbers repeated entries so re-reads give the same refs', () => {
    const refs = numberIdentical(['a', 'b', 'a'], (x) => x).map((r) => r.ref);
    expect(refs).toEqual(['a#1', 'b#1', 'a#2']);
  });
});
