import { describe, expect, it } from 'vitest';
import { type Tracking, feedDown, nothingSince } from './feed-state';

const at = '2026-11-01T12:00:00.000+09:00';
const moment = Date.parse(at);
const running: Tracking = {
  on: true,
  why: 'always',
  until: null,
  resumeAt: null,
  since: null,
  hours: null,
};
const stopped: Tracking = { ...running, on: false, why: 'outside' };

describe('feedDown and nothingSince (S29)', () => {
  it('is silent only with a feed; stopped holds with or without one', () => {
    expect(feedDown(null, running, moment + 3600_000).down).toBe(false);
    expect(feedDown({ at }, running, moment + 60_000).down).toBe(false);
    expect(feedDown({ at }, running, moment + 3600_000).down).toBe(true);
    expect(feedDown(null, stopped, moment).down).toBe(true);
  });
  it('gives a time only with a feed that is down', () => {
    expect(nothingSince(null, stopped)).toBeNull();
    expect(nothingSince(null, running)).toBeNull();
    expect(nothingSince({ at }, stopped)).toBe(at);
    expect(nothingSince({ at: new Date().toISOString() }, running)).toBeNull();
  });
});
