import { describe, expect, it } from 'vitest';
import {
  hasJapanese,
  holdingFieldsFor,
  isConsumedAfterOpening,
  openedStatesFor,
  pendingGrading,
  unitCost,
} from './holding-state';

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
    expect(openedStatesFor('sealed_tcg')).toContain('box_opened_contents_sealed');
    expect(openedStatesFor('amiibo')).not.toContain('box_opened_contents_sealed');
  });

  it('consumes sealed TCG once packs are opened', () => {
    expect(isConsumedAfterOpening('sealed_tcg', 'opened')).toBe(true);
    expect(isConsumedAfterOpening('sealed_tcg', 'box_opened_contents_sealed')).toBe(false);
    expect(isConsumedAfterOpening('game_ce', 'opened')).toBe(false);
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

describe('holdingFieldsFor', () => {
  it('maps types to condition dimensions', () => {
    expect(holdingFieldsFor('card_single')).toEqual({
      condition: false,
      packaging: false,
      grading: true,
    });
    expect(holdingFieldsFor('sealed_tcg')).toEqual({
      condition: false,
      packaging: true,
      grading: false,
    });
    expect(holdingFieldsFor('amiibo')).toEqual({
      condition: true,
      packaging: true,
      grading: false,
    });
    expect(holdingFieldsFor('other')).toEqual({
      condition: true,
      packaging: false,
      grading: false,
    });
  });
});
