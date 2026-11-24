import { describe, expect, it } from 'vitest';
import {
  atLeastAsBroad,
  isSpanJobKind,
  jobSpan,
  readFrontier,
  readLimit,
  spanHowOf,
  wantedFromOf,
} from './deep-read';

// Expected days worked out by hand (calendar arithmetic), not from the code under test.
describe('wantedFromOf and readLimit', () => {
  it('reaches 12 months back for a deep read or a load, 42 days for a read-back', () => {
    expect(wantedFromOf('deep', '2026-12-01')).toBe('2025-12-01');
    expect(wantedFromOf('load', '2028-02-29')).toBe('2027-02-28');
    expect(wantedFromOf('deep', '2027-03-01')).toBe('2026-03-01');
    expect(wantedFromOf('readback', '2026-12-01')).toBe('2026-10-20');
  });

  it("reaches 14 days back for a tracked game's weekly read and reads 2 weeks past it", () => {
    expect(wantedFromOf('tracked_weekly', '2026-12-01')).toBe('2026-11-17');
    expect(readLimit('tracked_weekly', '2026-11-17')).toBe('2026-11-03');
    expect(spanHowOf('tracked_weekly')).toBe('readback');
    expect(spanHowOf('deep')).toBe('deep');
    expect(isSpanJobKind('tracked_weekly')).toBe(true);
    expect(isSpanJobKind('monthly')).toBe(false);
    expect(isSpanJobKind('toString')).toBe(false);
  });

  it('reads 4 weeks past it for a deep read, 2 for a read-back; unknown stays unknown', () => {
    expect(readLimit('deep', '2025-12-01')).toBe('2025-11-03');
    expect(readLimit('readback', '2026-10-20')).toBe('2026-10-06');
    expect(readLimit('deep', null)).toBeNull();
  });
});

const days = (from: string, n: number) =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date(`${from}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - i);
    return d.toISOString().slice(0, 10);
  });

describe('readFrontier', () => {
  it("is the 5th newest of a page's last 10 days", () => {
    // 2026-11-30 down to 2026-11-21: the 5th newest is 11-26.
    expect(readFrontier(days('2026-11-30', 10)).frontier).toBe('2026-11-26');
    expect(readFrontier(days('2026-12-31', 5).concat(days('2026-11-30', 10))).frontier).toBe(
      '2026-11-26',
    );
  });

  it('takes the middle one, the newer of two, on a short page; none on an empty one', () => {
    expect(readFrontier(['2026-11-30', '2026-11-29', '2026-11-28']).frontier).toBe('2026-11-29');
    expect(readFrontier(['2026-11-30', '2026-11-29']).frontier).toBe('2026-11-30');
    expect(readFrontier([])).toEqual({ frontier: null, tail: [] });
    expect(readFrontier([], ['2026-11-30'])).toEqual({ frontier: null, tail: ['2026-11-30'] });
  });

  it('drops strays more than 28 days older than the median', () => {
    const seven = days('2026-11-30', 7);
    // 7 days 11-30 to 11-24: the middle is 11-27, with or without 3 listings from 2017.
    expect(readFrontier(seven).frontier).toBe('2026-11-27');
    expect(readFrontier([...seven, '2017-01-01', '2017-01-01', '2017-01-01']).frontier).toBe(
      '2026-11-27',
    );
    // A last page of one stray, the previous page's tail pooled: the stray moves nothing.
    const tail = readFrontier(days('2026-11-30', 10)).tail;
    expect(readFrontier(['2017-01-01'], tail).frontier).toBe('2026-11-26');
  });

  it("pools a short page with the previous page's tail", () => {
    const first = readFrontier(days('2026-11-30', 10));
    // Then 3 days 11-20 to 11-18: the last 10 are 11-27 to 11-18, the 5th newest 11-23.
    expect(readFrontier(days('2026-11-20', 3), first.tail).frontier).toBe('2026-11-23');
  });
});

describe('jobSpan', () => {
  it('starts at wanted_from when read past it, else 28 or 14 days after the frontier', () => {
    expect(jobSpan('deep', '2025-12-01', '2025-10-31', '2026-12-01')).toEqual({
      from: '2025-12-01',
      to: '2026-11-30',
    });
    expect(jobSpan('deep', '2025-12-01', '2026-05-20', '2026-12-01')).toEqual({
      from: '2026-06-17',
      to: '2026-11-30',
    });
    expect(jobSpan('readback', '2026-10-20', '2026-10-02', '2026-12-01')).toEqual({
      from: '2026-10-20',
      to: '2026-11-30',
    });
    expect(jobSpan('readback', '2026-10-20', '2026-11-16', '2026-12-01')).toEqual({
      from: '2026-11-30',
      to: '2026-11-30',
    });
    expect(jobSpan('load', null, '2026-08-25', '2026-11-20')).toEqual({
      from: '2026-09-22',
      to: '2026-11-19',
    });
  });

  it('gives none when nothing was read or the days run backwards', () => {
    expect(jobSpan('deep', '2025-12-01', null, '2026-12-01')).toEqual({ none: 'nothing_read' });
    expect(jobSpan('deep', '2025-12-01', '2026-01-01', null)).toEqual({ none: 'nothing_read' });
    expect(jobSpan('deep', '2025-12-02', '2026-11-21', '2026-12-02')).toEqual({
      none: 'too_recent',
    });
  });
});

describe('atLeastAsBroad', () => {
  const today = { keywords: ['Made-up Quest'] };
  it('holds for the same words or fewer, and the same or no category', () => {
    expect(atLeastAsBroad({ keyword: 'Made-up Quest', categoryId: null }, today)).toBe(true);
    expect(atLeastAsBroad({ keyword: 'ＭＡＤＥ-UP  quest', categoryId: null }, today)).toBe(true);
    expect(atLeastAsBroad({ keyword: 'Quest', categoryId: null }, today)).toBe(true);
    expect(
      atLeastAsBroad({ keyword: 'Made-up', categoryId: 5 }, { ...today, categoryId: '5' }),
    ).toBe(true);
  });

  it('fails for a word or a category today lacks, or a search with no words', () => {
    expect(atLeastAsBroad({ keyword: 'Made-up Quest Extra', categoryId: null }, today)).toBe(false);
    expect(atLeastAsBroad({ keyword: 'Made-up Quest', categoryId: 5 }, today)).toBe(false);
    expect(
      atLeastAsBroad({ keyword: 'Made-up', categoryId: 5 }, { ...today, categoryId: '6' }),
    ).toBe(false);
    expect(atLeastAsBroad({ keyword: 'Made-up', categoryId: null }, { keywords: [] })).toBe(false);
  });
});
