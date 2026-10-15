import { afterEach, describe, expect, it } from 'vitest';
import {
  appTimeZone,
  inAppZone,
  isTimeZone,
  localDate,
  localDateToIso,
  localTime,
  offsetPeriods,
  setAppTimeZone,
  toLocalIso,
  zoneOffset,
} from './time';

afterEach(() => setAppTimeZone(null));

describe('time', () => {
  it('formats in the app time zone with its offset (default Tokyo)', () => {
    const d = new Date('2026-10-09T15:30:00.000Z');
    expect(appTimeZone()).toBe('Asia/Tokyo');
    expect(toLocalIso(d)).toBe('2026-10-10T00:30:00.000+09:00');
    expect(localDate(d)).toBe('2026-10-10');
    expect(new Date(toLocalIso(d)).getTime()).toBe(d.getTime());
  });

  it('follows the zone set, with its summer time', () => {
    setAppTimeZone('Europe/Paris');
    expect(toLocalIso(new Date('2026-07-01T10:00:00.123Z'))).toBe('2026-07-01T12:00:00.123+02:00');
    expect(toLocalIso(new Date('2026-12-01T10:00:00Z'))).toBe('2026-12-01T11:00:00.000+01:00');
    expect(localDate(new Date('2026-10-15T20:00:00Z'))).toBe('2026-10-15');
    setAppTimeZone('America/New_York');
    expect(toLocalIso(new Date('2026-01-15T03:00:00Z'))).toBe('2026-01-14T22:00:00.000-05:00');
    expect(inAppZone('2026-01-15T12:00:00.000+09:00')).toBe('2026-01-14T22:00:00.000-05:00');
    setAppTimeZone('Asia/Kolkata');
    expect(zoneOffset(new Date('2026-01-01T00:00:00Z'))).toBe(330);
    expect(toLocalIso(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01-01T05:30:00.000+05:30');
  });

  it('refuses unknown zones', () => {
    expect(isTimeZone('Europe/Paris')).toBe(true);
    expect(isTimeZone('Mars/Olympus')).toBe(false);
    setAppTimeZone('Mars/Olympus');
    expect(appTimeZone()).toBe('Asia/Tokyo');
  });

  it('finds the instant of a wall time, across summer time', () => {
    expect(localTime('2026-10-10').toISOString()).toBe('2026-10-09T15:00:00.000Z');
    setAppTimeZone('Europe/Paris');
    expect(localTime('2026-03-29', '12:00:00.000').toISOString()).toBe('2026-03-29T10:00:00.000Z');
    expect(localTime('2026-03-28', '12:00:00.000').toISOString()).toBe('2026-03-28T11:00:00.000Z');
  });

  it('lists the offsets a zone used', () => {
    expect(offsetPeriods('Asia/Tokyo', new Date('2025-01-01'), new Date('2026-12-31'))).toEqual([
      { until: null, offset: 540 },
    ]);
    const paris = offsetPeriods('Europe/Paris', new Date('2026-01-01'), new Date('2026-12-31'));
    expect(paris).toEqual([
      { until: Date.parse('2026-03-29T01:00:00Z'), offset: 60 },
      { until: Date.parse('2026-10-25T01:00:00Z'), offset: 120 },
      { until: null, offset: 60 },
    ]);
  });
});

describe('localDateToIso', () => {
  it('uses now for today and start of day otherwise', () => {
    const now = new Date('2026-10-09T03:00:00.000Z');
    expect(localDateToIso('2026-10-09', now)).toBe('2026-10-09T12:00:00.000+09:00');
    expect(localDateToIso('2026-09-28', now)).toBe('2026-09-28T00:00:00.000+09:00');
    expect(() => localDateToIso('28/09/2026', now)).toThrow(RangeError);
  });
});
