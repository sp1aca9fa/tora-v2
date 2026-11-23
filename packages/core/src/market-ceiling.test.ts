import { describe, expect, it } from 'vitest';
import {
  MARKET_FAILURES_DAILY,
  MARKET_FLOOR,
  MARKET_WAIT_MS,
  afterRefusal,
  compareJobs,
  insideHours,
  isMarketJobKind,
  jobPace,
  skippedToday,
  whyNotRun,
} from './market-ceiling';

const at = (iso: string) => new Date(iso);

describe('market ceiling rules (S36 B4)', () => {
  it('hours run 05:00 to 22:00 in the given zone, end excluded', () => {
    expect(insideHours(at('2026-11-24T04:59:59+09:00'), 'Asia/Tokyo')).toBe(false);
    expect(insideHours(at('2026-11-24T05:00:00+09:00'), 'Asia/Tokyo')).toBe(true);
    expect(insideHours(at('2026-11-24T21:59:59+09:00'), 'Asia/Tokyo')).toBe(true);
    expect(insideHours(at('2026-11-24T22:00:00+09:00'), 'Asia/Tokyo')).toBe(false);
    // 08:00 in Tokyo is 23:00 UTC the day before: the zone decides, not UTC.
    expect(insideHours(at('2026-11-23T23:00:00Z'), 'Asia/Tokyo')).toBe(true);
    expect(insideHours(at('2026-11-23T23:00:00Z'), 'UTC')).toBe(false);
  });

  it('a refusal waits 3 days and halves, down to the floor, then stops', () => {
    const t = at('2026-11-24T05:07:30+09:00');
    expect(afterRefusal(200, t)).toEqual({
      perDay: 100,
      waitUntil: new Date(t.getTime() + MARKET_WAIT_MS),
      stopped: false,
    });
    expect(afterRefusal(100, t).perDay).toBe(50);
    expect(afterRefusal(50, t).perDay).toBe(25);
    expect(afterRefusal(30, t).perDay).toBe(MARKET_FLOOR);
    expect(afterRefusal(25, t)).toEqual({ perDay: 25, waitUntil: null, stopped: true });
    expect(afterRefusal(null, t)).toEqual({ perDay: 25, waitUntil: null, stopped: true });
    // Never raised: a number under the floor stays as it is.
    expect(afterRefusal(10, t)).toEqual({ perDay: 10, waitUntil: null, stopped: true });
  });

  it('orders jobs by kind, then oldest first by instant, then id', () => {
    const jobs = [
      { id: 'c', kind: 'monthly', createdAt: '2026-11-01T00:00:00.000+09:00', failures: 0 },
      { id: 'b', kind: 'deep', createdAt: '2026-11-02T00:00:00.000+09:00', failures: 0 },
      { id: 'a', kind: 'deep', createdAt: '2026-11-01T16:00:00.000+00:00', failures: 0 },
      { id: 'd', kind: 'readback', createdAt: '2026-11-20T00:00:00.000+09:00', failures: 0 },
      { id: 'e', kind: 'deep', createdAt: '2026-11-02T01:00:00.000+10:00', failures: 0 },
    ];
    // b and e are the same instant (15:00 UTC), a is later though its text sorts first.
    expect(jobs.sort(compareJobs).map((j) => j.id)).toEqual(['d', 'b', 'e', 'a', 'c']);
    expect(isMarketJobKind('deep')).toBe(true);
    expect(isMarketJobKind('other')).toBe(false);
  });

  it('runs failing jobs last, fewer failures first, then oldest', () => {
    const job = (id: string, kind: string, day: number, failures: number) => ({
      id,
      kind,
      createdAt: `2026-11-${String(day).padStart(2, '0')}T00:00:00.000+09:00`,
      failures,
    });
    const jobs = [
      job('r2', 'readback', 1, 2),
      job('m0', 'monthly', 9, 0),
      job('d1', 'deep', 3, 1),
      job('r1', 'readback', 5, 1),
      job('d0', 'deep', 8, 0),
      job('m1', 'monthly', 2, 1),
    ];
    expect(jobs.sort(compareJobs).map((j) => j.id)).toEqual(['d0', 'm0', 'm1', 'd1', 'r1', 'r2']);
  });

  it('a job failing 5 times in a row is tried at most once a day in the zone', () => {
    const zone = 'Asia/Tokyo';
    const noon = at('2026-11-24T12:00:00+09:00');
    const today = '2026-11-24T05:30:00.000+09:00';
    expect(MARKET_FAILURES_DAILY).toBe(5);
    expect(skippedToday({ failures: 4, startedAt: today }, noon, zone)).toBe(false);
    expect(skippedToday({ failures: 5, startedAt: today }, noon, zone)).toBe(true);
    expect(skippedToday({ failures: 9, startedAt: today }, noon, zone)).toBe(true);
    // Yesterday 23:59 in Tokyo, written in UTC: not today.
    expect(skippedToday({ failures: 5, startedAt: '2026-11-23T14:59:00Z' }, noon, zone)).toBe(
      false,
    );
    // The same instant is today in UTC.
    expect(skippedToday({ failures: 5, startedAt: '2026-11-24T00:30:00Z' }, noon, 'UTC')).toBe(
      true,
    );
    // No last attempt, or one that does not read: tried.
    expect(skippedToday({ failures: 5, startedAt: null }, noon, zone)).toBe(false);
    expect(skippedToday({ failures: 5, startedAt: 'never' }, noon, zone)).toBe(false);
  });

  it('says why a marketplace may not run', () => {
    const zone = 'Asia/Tokyo';
    const noon = at('2026-11-24T12:00:00+09:00');
    const ok = { perDay: 200, waitUntil: null, stopped: false };
    expect(whyNotRun(ok, 0, noon, zone)).toBeNull();
    expect(whyNotRun(ok, 200, noon, zone)).toBe('ceiling');
    expect(whyNotRun(ok, 0, at('2026-11-24T23:00:00+09:00'), zone)).toBe('hours');
    expect(whyNotRun({ ...ok, stopped: true }, 0, noon, zone)).toBe('stopped');
    // Compared as an instant: the same moment written in another offset.
    const wait = { ...ok, waitUntil: '2026-11-24T04:00:00.000+00:00' };
    expect(whyNotRun(wait, 0, noon, zone)).toBe('waiting');
    expect(whyNotRun(wait, 0, at('2026-11-24T13:00:00+09:00'), zone)).toBeNull();
    expect(whyNotRun(null, 0, noon, zone)).toBe('unknown');
    expect(whyNotRun({ ...ok, perDay: 24 }, 0, noon, zone)).toBe('unknown');
    expect(whyNotRun({ ...ok, perDay: null }, 0, noon, zone)).toBe('unknown');
  });

  it('a plug-in pace only slows jobs', () => {
    expect(jobPace()).toEqual({ minDelayMs: 10_000, maxDelayMs: 20_000 });
    expect(jobPace({ minDelayMs: 2_000, maxDelayMs: 5_000 })).toEqual({
      minDelayMs: 10_000,
      maxDelayMs: 20_000,
    });
    expect(jobPace({ minDelayMs: 30_000 })).toEqual({ minDelayMs: 30_000, maxDelayMs: 30_000 });
  });
});
