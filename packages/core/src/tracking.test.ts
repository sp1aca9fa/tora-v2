import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TRACKING_HOURS,
  type TrackingSettings,
  trackingOverride,
  trackingState,
  validTrackingHours,
} from './tracking';

const hours = { hours: DEFAULT_TRACKING_HOURS };
/** A Tokyo time (the default zone). */
const at = (local: string) => new Date(`${local}+09:00`);
const iso = (local: string) => `${local}.000+09:00`;
const ms = (iso: string | null) => (iso ? Date.parse(iso) : NaN);

describe('trackingState', () => {
  it('tracks around the clock without hours', () => {
    expect(trackingState({ hours: null }, at('2026-10-26T03:00:00'))).toMatchObject({
      on: true,
      why: 'always',
      until: null,
    });
  });

  it('starts 1 to 5 minutes after the start and stops 1 to 5 minutes before the end', () => {
    const night = trackingState(hours, at('2026-10-26T03:00:00'));
    expect(night).toMatchObject({ on: false, why: 'outside' });
    const start = ms(night.resumeAt) - at('2026-10-26T09:00:00').getTime();
    expect(start).toBeGreaterThanOrEqual(60_000);
    expect(start).toBeLessThanOrEqual(300_000);
    const day = trackingState(hours, at('2026-10-26T12:00:00'));
    expect(day).toMatchObject({ on: true, why: 'hours', since: night.resumeAt });
    const stop = at('2026-10-26T21:00:00').getTime() - ms(day.until);
    expect(stop).toBeGreaterThanOrEqual(60_000);
    expect(stop).toBeLessThanOrEqual(300_000);
    expect(trackingState(hours, at('2026-10-26T08:59:59')).on).toBe(false);
    expect(trackingState(hours, at('2026-10-26T09:05:01')).on).toBe(true);
    expect(trackingState(hours, at('2026-10-26T20:54:59')).on).toBe(true);
    expect(trackingState(hours, at('2026-10-26T21:00:00')).on).toBe(false);
  });

  it('draws other delays on other days, the same all day', () => {
    const starts = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29'].map((d) =>
      trackingState(hours, at(`${d}T05:00:00`)).resumeAt?.slice(11, 19),
    );
    expect(new Set(starts).size).toBeGreaterThan(1);
    expect(trackingState(hours, at('2026-10-26T06:00:00')).resumeAt).toBe(
      trackingState(hours, at('2026-10-26T05:00:00')).resumeAt,
    );
  });

  it('keeps the exact times with no delay', () => {
    const none = { hours: { ...DEFAULT_TRACKING_HOURS, minDelay: 0, maxDelay: 0 } };
    expect(trackingState(none, at('2026-10-26T22:00:00')).resumeAt).toBe(
      iso('2026-10-27T09:00:00'),
    );
  });

  it('passes midnight when the end comes before the start', () => {
    const late = { hours: { from: '20:00', to: '02:00', minDelay: 0, maxDelay: 0 } };
    expect(trackingState(late, at('2026-10-27T01:00:00'))).toMatchObject({
      on: true,
      until: iso('2026-10-27T02:00:00'),
    });
    expect(trackingState(late, at('2026-10-27T03:00:00')).on).toBe(false);
  });
});

describe('trackingOverride', () => {
  it('tracks an hour once, then stops again outside the hours', () => {
    const now = at('2026-10-26T22:00:00');
    const override = trackingOverride(hours, 'hour', now)!;
    const settings: TrackingSettings = { ...hours, override };
    expect(trackingState(settings, at('2026-10-26T22:30:00'))).toMatchObject({
      on: true,
      why: 'hour',
      until: iso('2026-10-26T23:00:00'),
    });
    expect(trackingState(settings, at('2026-10-26T23:00:00')).on).toBe(false);
    // The next night it is long over.
    expect(trackingState(settings, at('2026-10-27T22:30:00')).on).toBe(false);
  });

  it('runs into the hours when the hour reaches them', () => {
    const override = trackingOverride(hours, 'hour', at('2026-10-26T08:30:00'))!;
    const state = trackingState({ ...hours, override }, at('2026-10-26T08:45:00'));
    expect(state.on).toBe(true);
    expect(ms(state.until)).toBeGreaterThan(at('2026-10-26T20:50:00').getTime());
  });

  it('tracks until the start, then the hours go on as usual, that day only', () => {
    const now = at('2026-10-26T22:00:00');
    const off = trackingState(hours, now);
    const override = trackingOverride(hours, 'untilStart', now)!;
    expect(override.until).toBe(off.resumeAt);
    const settings = { ...hours, override };
    expect(trackingState(settings, at('2026-10-27T04:00:00'))).toMatchObject({
      on: true,
      why: 'untilStart',
    });
    const day = trackingState(settings, at('2026-10-27T12:00:00'));
    expect(day).toMatchObject({ on: true, why: 'hours', since: iso('2026-10-26T22:00:00') });
    expect(trackingState(settings, at('2026-10-27T22:00:00')).on).toBe(false);
  });

  it('asks nothing while the feed tracks', () => {
    expect(trackingOverride(hours, 'hour', at('2026-10-26T12:00:00'))).toBeNull();
    expect(trackingOverride({ hours: null }, 'untilStart')).toBeNull();
  });
});

describe('validTrackingHours', () => {
  it('needs two different times and a delay range within an hour', () => {
    expect(validTrackingHours(DEFAULT_TRACKING_HOURS)).toBe(true);
    expect(validTrackingHours({ ...DEFAULT_TRACKING_HOURS, to: '09:00' })).toBe(false);
    expect(validTrackingHours({ ...DEFAULT_TRACKING_HOURS, from: '9:00' })).toBe(false);
    expect(validTrackingHours({ ...DEFAULT_TRACKING_HOURS, minDelay: 400 })).toBe(false);
    expect(validTrackingHours({ ...DEFAULT_TRACKING_HOURS, maxDelay: 3601 })).toBe(false);
  });
});
