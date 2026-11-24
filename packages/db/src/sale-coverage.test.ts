import { describe, expect, it } from 'vitest';
import { coveredOf } from './sale-coverage';

describe('coveredOf (S36 Terms "Covered day": a collect dated D covers D-1)', () => {
  it('moves each night back one day; a failed night leaves the day before it uncovered', () => {
    // Nights of D-2, D-1 and D (D = 2026-06-30) ran; the night of D+1 failed.
    expect(coveredOf([['2026-06-28', '2026-06-30']])).toEqual([['2026-06-27', '2026-06-29']]);
    // Two runs of nights with one failed night between them: one day missing.
    expect(
      coveredOf([
        ['2026-06-01', '2026-06-10'],
        ['2026-06-12', '2026-06-20'],
      ]),
    ).toEqual([
      ['2026-05-31', '2026-06-09'],
      ['2026-06-11', '2026-06-19'],
    ]);
  });

  it("joins a deep read's span (to the day before its first page) and the following nights", () => {
    // A deep read whose first page was read on 2026-05-10 reached back to 2026-02-10 and covers up to
    // 2026-05-09; the nights from 2026-05-11 read 2026-05-10 onwards: no hole.
    expect(coveredOf([['2026-05-11', '2026-06-30']], [['2026-02-10', '2026-05-09']])).toEqual([
      ['2026-02-10', '2026-06-29'],
    ]);
    // A night on the day of the first page reads the day before, inside the span: still one run.
    expect(coveredOf([['2026-05-10', '2026-05-12']], [['2026-02-10', '2026-05-09']])).toEqual([
      ['2026-02-10', '2026-05-11'],
    ]);
  });

  it('empty input and invalid ranges give nothing', () => {
    expect(coveredOf([])).toEqual([]);
    expect(
      coveredOf([
        ['2026-06-30', '2026-06-01'],
        ['bad', '2026-06-02'],
      ]),
    ).toEqual([]);
    expect(coveredOf([], [['2026-06-01', '2026-06-01']])).toEqual([['2026-06-01', '2026-06-01']]);
  });
});
