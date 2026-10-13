import { describe, expect, it } from 'vitest';
import { isConsumedAfterOpening, openedStatesFor, pendingGrading, unitCost } from './holding-state';
import { hasJapanese } from './text';

describe('pendingGrading', () => {
  it('is set after a submission and cleared by the return', () => {
    const submitted = {
      type: 'grading_submitted' as const,
      occurredAt: '2026-10-01T00:00:00.000+09:00',
      payload: { grader: 'PSA' },
    };
    expect(pendingGrading([])).toBeNull();
    expect(pendingGrading([submitted])).toEqual({ grader: 'PSA', since: submitted.occurredAt });
    expect(
      pendingGrading([
        { type: 'grading_returned', occurredAt: '2026-11-01T00:00:00.000+09:00' },
        submitted,
      ]),
    ).toBeNull();
  });
});

describe('opening', () => {
  it('offers box-opened state only for sealed TCG', () => {
    expect(openedStatesFor('sealed')).toContain('box_opened_contents_sealed');
    expect(openedStatesFor('item')).not.toContain('box_opened_contents_sealed');
  });

  it('consumes sealed TCG once packs are opened', () => {
    expect(isConsumedAfterOpening('sealed', 'opened')).toBe(true);
    expect(isConsumedAfterOpening('sealed', 'box_opened_contents_sealed')).toBe(false);
    expect(isConsumedAfterOpening('item', 'opened')).toBe(false);
  });
});

describe('helpers', () => {
  it('detects Japanese text', () => {
    expect(hasJapanese('ピカチュウ ex')).toBe(true);
    expect(hasJapanese('リザードン')).toBe(true);
    expect(hasJapanese('黒炎の支配者')).toBe(true);
    expect(hasJapanese('Pikachu ex')).toBe(false);
  });

  it('computes unit cost', () => {
    expect(unitCost(10_000, 3)).toBe(3333);
    expect(unitCost(0, 2)).toBe(0);
  });
});
