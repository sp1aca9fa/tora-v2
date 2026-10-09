import { describe, expect, it } from 'vitest';
import { allocateSplitCost, splitHolding } from './split';

describe('allocateSplitCost', () => {
  it('allocates proportionally when divisible', () => {
    expect(allocateSplitCost(3000, 3, 1)).toBe(1000);
    expect(allocateSplitCost(3000, 3, 2)).toBe(2000);
  });

  it('rounds the split down so the remainder stays on the original', () => {
    expect(allocateSplitCost(1000, 3, 1)).toBe(333);
    expect(allocateSplitCost(1000, 3, 2)).toBe(666);
    expect(allocateSplitCost(1, 2, 1)).toBe(0);
  });

  it('handles zero-cost lots (pulls)', () => {
    expect(allocateSplitCost(0, 4, 1)).toBe(0);
  });

  it('rejects invalid splits', () => {
    expect(() => allocateSplitCost(1000, 1, 1)).toThrow(RangeError);
    expect(() => allocateSplitCost(1000, 3, 0)).toThrow(RangeError);
    expect(() => allocateSplitCost(1000, 3, 3)).toThrow(RangeError);
    expect(() => allocateSplitCost(-1, 3, 1)).toThrow(RangeError);
    expect(() => allocateSplitCost(100.5, 3, 1)).toThrow(TypeError);
    expect(() => allocateSplitCost(100, 3, 1.5)).toThrow(TypeError);
  });
});

describe('splitHolding', () => {
  const lot = {
    id: 'H1',
    productId: 'P1',
    quantity: 3,
    costTotalJpy: 10_000,
    condition: 'new_unused' as const,
  };

  it('moves units and cost, conserving totals', () => {
    const { original, split } = splitHolding(lot, 1, { newHoldingId: 'H2' });
    expect(original).toMatchObject({ id: 'H1', quantity: 2, costTotalJpy: 6667 });
    expect(split).toMatchObject({ id: 'H2', quantity: 1, costTotalJpy: 3333 });
    expect(original.quantity + split.quantity).toBe(lot.quantity);
    expect(original.costTotalJpy + split.costTotalJpy).toBe(lot.costTotalJpy);
  });

  it('copies all other fields to the new holding and does not mutate the input', () => {
    const { split } = splitHolding(lot, 2);
    expect(split.productId).toBe('P1');
    expect(split.condition).toBe('new_unused');
    expect(split.id).not.toBe('H1');
    expect(lot.quantity).toBe(3);
  });

  it('records a split event on both holdings', () => {
    const at = '2026-10-09T12:00:00.000+09:00';
    const { events, split } = splitHolding(lot, 1, { occurredAt: at });
    const [source, target] = events;
    expect(source).toMatchObject({
      holdingId: 'H1',
      type: 'split',
      occurredAt: at,
      payload: {
        role: 'source',
        toHoldingId: split.id,
        quantityMoved: 1,
        costMovedJpy: 3333,
        before: { quantity: 3, costTotalJpy: 10_000 },
        after: { quantity: 2, costTotalJpy: 6667 },
      },
    });
    expect(target).toMatchObject({
      holdingId: split.id,
      type: 'split',
      payload: { role: 'target', fromHoldingId: 'H1', quantity: 1, costTotalJpy: 3333 },
    });
  });
});
