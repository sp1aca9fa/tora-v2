import { afterEach, expect, it, vi } from 'vitest';
import { awakeClock } from './clock';

afterEach(() => {
  vi.useRealTimers();
});

it('counts working time and leaves out a long gap (the PC slept)', () => {
  vi.useFakeTimers();
  const clock = awakeClock(5_000, 60_000);
  vi.advanceTimersByTime(30_000);
  // Suspended for an hour: the clock jumps, no beat ran.
  vi.setSystemTime(Date.now() + 3_600_000);
  vi.advanceTimersByTime(20_000);
  const ms = clock.stop();
  // 30 s + one beat + 20 s (the hour is not counted).
  expect(ms).toBeGreaterThanOrEqual(50_000);
  expect(ms).toBeLessThanOrEqual(56_000);
});
