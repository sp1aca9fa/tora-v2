import { describe, expect, it } from 'vitest';
import { bar, timeLeft } from './progress';

describe('collect progress line', () => {
  it('draws a bar and a rough time left', () => {
    expect(bar(0.5)).toBe('[██████████░░░░░░░░░░]  50%');
    expect(bar(2)).toBe('[████████████████████] 100%');
    expect(timeLeft(60_000, 0.25)).toBe('~3 min left');
    expect(timeLeft(10_000, 0.5)).toBe('<1 min left');
    expect(timeLeft(1_000, 0.5)).toBe('estimating…');
  });
});
