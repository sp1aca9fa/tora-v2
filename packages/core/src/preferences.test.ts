import { describe, expect, it } from 'vitest';
import { SUMMARY_PANELS, summaryPrefs, suggestsCondition } from './preferences';

describe('summary preferences', () => {
  it('rotates every panel every 8 seconds by default', () => {
    expect(summaryPrefs(null)).toEqual({ rotate: true, seconds: 8, panels: [...SUMMARY_PANELS] });
  });
  it('keeps the choices, dropping unknown panels and speeds', () => {
    expect(
      summaryPrefs({
        summary: { rotate: false, seconds: 7, panels: ['gains', 'nope' as never, 'movers_pct'] },
      }),
    ).toEqual({ rotate: false, seconds: 8, panels: ['gains', 'movers_pct'] });
  });
});

describe('suggestsCondition', () => {
  it('suggests every condition of a type not chosen, else only those chosen', () => {
    const prefs = { suggestConditions: { card: ['raw:A', 'graded:PSA:10'] } };
    expect(suggestsCondition(prefs, 'card', 'raw:B')).toBe(false);
    expect(suggestsCondition(prefs, 'card', 'raw:A')).toBe(true);
    expect(suggestsCondition(prefs, 'sealed', 'sealed:no_shrink')).toBe(true);
    expect(suggestsCondition(null, 'card', 'raw:B')).toBe(true);
  });
});
