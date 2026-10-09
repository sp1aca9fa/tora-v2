import { describe, expect, it } from 'vitest';
import { deriveBucket, gradedBucket } from './bucket';

describe('deriveBucket', () => {
  it('raw cards use the raw grade', () => {
    expect(deriveBucket({ productClass: 'card', grading: 'raw', rawGrade: 'A' })).toBe('raw:A');
    expect(deriveBucket({ productClass: 'card', rawGrade: 'S' })).toBe('raw:S');
    expect(deriveBucket({ productClass: 'card', grading: 'raw' })).toBeNull();
  });

  it('graded cards use grader and grade', () => {
    expect(
      deriveBucket({ productClass: 'card', grading: 'graded', grader: 'PSA', grade: '10' }),
    ).toBe('graded:PSA:10');
    expect(
      deriveBucket({
        productClass: 'card',
        grading: 'graded',
        grader: 'BGS',
        grade: ' 9.5 ',
        rawGrade: 'A',
      }),
    ).toBe('graded:BGS:9.5');
    expect(deriveBucket({ productClass: 'card', grading: 'graded', grader: 'PSA' })).toBeNull();
  });

  it('sealed products use packaging state', () => {
    expect(deriveBucket({ productClass: 'sealed', packagingState: 'sealed_shrink' })).toBe(
      'sealed:shrink',
    );
    expect(deriveBucket({ productClass: 'sealed', packagingState: 'sealed_no_shrink' })).toBe(
      'sealed:no_shrink',
    );
    expect(
      deriveBucket({ productClass: 'sealed', packagingState: 'box_opened_contents_sealed' }),
    ).toBe('sealed:box_opened_contents_sealed');
    expect(deriveBucket({ productClass: 'sealed', packagingState: 'n/a' })).toBeNull();
    // Condition is irrelevant for sealed products.
    expect(deriveBucket({ productClass: 'sealed', condition: 'new_unused' })).toBeNull();
  });

  it('other items use the condition scale', () => {
    expect(deriveBucket({ productClass: 'item', condition: 'new_unused' })).toBe('cond:new');
    expect(deriveBucket({ productClass: 'item', condition: 'like_new' })).toBe('cond:like_new');
    expect(deriveBucket({ productClass: 'item', condition: 'no_noticeable_damage' })).toBe(
      'cond:good',
    );
    for (const condition of ['minor_damage', 'damaged', 'poor'] as const) {
      expect(deriveBucket({ productClass: 'item', condition })).toBe('cond:fair');
    }
    expect(deriveBucket({ productClass: 'item' })).toBeNull();
  });
});

describe('gradedBucket', () => {
  it('normalizes grader case and trailing .0', () => {
    expect(gradedBucket('other', '10.0')).toBe('graded:OTHER:10');
    expect(gradedBucket('CGC', '9.5')).toBe('graded:CGC:9.5');
  });
});
