import { describe, expect, it } from 'vitest';
import { SUMMARY_PANELS, summaryPrefs } from './preferences';

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
