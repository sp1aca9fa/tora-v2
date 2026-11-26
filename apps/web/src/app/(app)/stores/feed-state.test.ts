import { describe, expect, it } from 'vitest';
import { type Tracking, boardQuiet, feedDown, nothingSince, waitingUntil } from './feed-state';

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
  it('uses the limit given (else 15 min) and counts no silence during an announced wait', () => {
    const min = 60_000;
    expect(feedDown({ at }, running, moment + 14 * min).silent).toBe(false);
    expect(feedDown({ at }, running, moment + 16 * min).silent).toBe(true);
    expect(feedDown({ at }, running, moment + 16 * min, 30 * min).silent).toBe(false);
    const next = { board: 'arcade', at: new Date(moment + 180 * min).toISOString() };
    expect(feedDown({ at, next }, running, moment + 170 * min).silent).toBe(false);
    expect(feedDown({ at, next }, running, moment + 196 * min).silent).toBe(true);
  });
  it('gives each board the limit times the boards watched times 2, waits not counted', () => {
    const min = 60_000;
    const feed = { at, next: null };
    const readAt = new Date(moment - 40 * min).toISOString();
    expect(boardQuiet(null, feed, 2, 15, moment)).toBe(true);
    expect(boardQuiet(readAt, feed, 1, 15, moment)).toBe(true);
    expect(boardQuiet(readAt, feed, 2, 15, moment)).toBe(false);
    expect(boardQuiet(readAt, feed, 2, 15, moment + 21 * min)).toBe(true);
    const next = { board: 'arcade', at: new Date(moment + 60 * min).toISOString() };
    expect(boardQuiet(readAt, { at, next }, 2, 15, moment + 50 * min)).toBe(false);
  });
  it('says the feed waits only during an announced wait longer than the limit', () => {
    const min = 60_000;
    const due = new Date(moment + 180 * min).toISOString();
    const next = { board: 'arcade', at: due };
    expect(waitingUntil({ at, next }, 15 * min, moment + 170 * min)).toBe(due);
    // Over, short (a normal page's wait), none, unreadable, no feed.
    expect(waitingUntil({ at, next }, 15 * min, moment + 181 * min)).toBeNull();
    const soon = { board: 'arcade', at: new Date(moment + 4 * min).toISOString() };
    expect(waitingUntil({ at, next: soon }, 15 * min, moment + min)).toBeNull();
    expect(waitingUntil({ at, next: null }, 15 * min, moment)).toBeNull();
    expect(waitingUntil({ at, next: { board: null, at: 'soon' } }, 15 * min, moment)).toBeNull();
    expect(waitingUntil(null, 15 * min, moment)).toBeNull();
  });
  it('gives a time only with a feed that is down', () => {
    expect(nothingSince(null, stopped)).toBeNull();
    expect(nothingSince(null, running)).toBeNull();
    expect(nothingSince({ at }, stopped)).toBe(at);
    expect(nothingSince({ at: new Date().toISOString() }, running)).toBeNull();
  });
});
