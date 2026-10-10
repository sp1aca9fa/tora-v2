import { describe, expect, it } from 'vitest';
import { estimateLotSize } from './lot-size';

describe('estimateLotSize', () => {
  const refs = [10_400, 10_500, 10_499, 10_650, 10_300];
  it('reads multiples of the going price as lots', () => {
    expect(estimateLotSize(104_000, refs)).toBe(10);
    expect(estimateLotSize(110_000, refs)).toBe(10);
    expect(estimateLotSize(20_300, refs)).toBe(2);
  });
  it('keeps single trades and unclear prices at 1', () => {
    expect(estimateLotSize(10_500, refs)).toBe(1);
    // 1.5x the going price: no multiple is close enough.
    expect(estimateLotSize(15_700, refs)).toBe(1);
    // Too few references to judge.
    expect(estimateLotSize(104_000, [10_400, 10_500])).toBe(1);
  });
});
