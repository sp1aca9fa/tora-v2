import { describe, expect, it } from 'vitest';
import {
  ITEM_CONDITION_BUCKETS,
  WISH_CONDITIONS,
  atOrBetter,
  compareBucket,
  conditionBucket,
  deriveBucket,
  gradedBucket,
  parseGrade,
  wishConditionOf,
} from './bucket';
import { resolveTaxonomy } from './categories';

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

describe('parseGrade', () => {
  it('reads raw grades and slabs', () => {
    expect(parseGrade('a')).toEqual({ grading: 'raw', rawGrade: 'A' });
    expect(parseGrade('raw S')).toEqual({ grading: 'raw', rawGrade: 'S' });
    expect(parseGrade('PSA10')).toEqual({ grading: 'graded', grader: 'PSA', grade: '10' });
    expect(parseGrade('ｂｇｓ ９.５')).toEqual({ grading: 'graded', grader: 'BGS', grade: '9.5' });
    expect(parseGrade('cgc 10.0')).toEqual({ grading: 'graded', grader: 'CGC', grade: '10' });
  });
  it('refuses unclear input', () => {
    for (const t of ['', 'E', 'PSA', 'PSA11', 'XYZ10', 'other 10'])
      expect(parseGrade(t)).toBeNull();
  });
});

describe('compareBucket', () => {
  const taxonomy = resolveTaxonomy({
    lists: [
      {
        key: 'watch_condition',
        values: [
          { key: 'unworn', names: { en: 'Unworn' } },
          { key: 'good', names: { en: 'Good' } },
        ],
      },
    ],
  });
  it('keeps the TCG rule: ungraded cards in their grade, graded at A, sealed with shrink', () => {
    expect(compareBucket('card', 'raw:B', taxonomy)).toEqual({ bucket: 'raw:B', plain: true });
    expect(compareBucket('card', 'graded:PSA:10', taxonomy)).toEqual({
      bucket: 'raw:A',
      plain: true,
    });
    expect(compareBucket('sealed', 'sealed:opened', taxonomy)?.bucket).toBe('sealed:shrink');
    expect(compareBucket('sealed', 'sealed:no_shrink', taxonomy)?.bucket).toBe('sealed:no_shrink');
  });
  it('compares other lists in the lot condition, plain prices only in the best value', () => {
    expect(compareBucket('game', 'cond:good', taxonomy)).toEqual({
      bucket: 'cond:good',
      plain: false,
    });
    expect(compareBucket('game', null, taxonomy)).toEqual({ bucket: 'cond:new', plain: true });
    const watch = 'watch/watch_condition';
    expect(compareBucket(watch, 'watch_condition:unworn', taxonomy)?.plain).toBe(true);
    expect(compareBucket(watch, 'watch_condition:good', taxonomy)?.plain).toBe(false);
  });
});

describe('atOrBetter (S36 Terms "Condition")', () => {
  it('orders the item buckets best first and takes the wanted one and better ones only', () => {
    expect(ITEM_CONDITION_BUCKETS).toEqual(['cond:new', 'cond:like_new', 'cond:good', 'cond:fair']);
    expect(atOrBetter('cond:good', 'cond:good')).toBe(true);
    expect(atOrBetter('cond:new', 'cond:good')).toBe(true);
    expect(atOrBetter('cond:like_new', 'cond:good')).toBe(true);
    expect(atOrBetter('cond:fair', 'cond:good')).toBe(false);
    expect(atOrBetter('cond:like_new', 'cond:new')).toBe(false);
    expect(atOrBetter('cond:fair', 'cond:fair')).toBe(true);
  });

  it('never counts a copy of no bucket or grade not stated; any condition takes the four', () => {
    expect(atOrBetter('cond:used', 'cond:fair')).toBe(false);
    expect(atOrBetter('', 'cond:fair')).toBe(false);
    expect(atOrBetter(null, '')).toBe(false);
    expect(atOrBetter('cond:used', '')).toBe(false);
    expect(atOrBetter('cond:fair', '')).toBe(true);
    // A wanted bucket outside the order (a card grade) takes nothing.
    expect(atOrBetter('cond:new', 'raw:A')).toBe(false);
  });
});

describe('wishConditionOf (fix round 1, item 8)', () => {
  it('shows a stored fair condition as the fair option and none for no condition', () => {
    expect(WISH_CONDITIONS.map((c) => wishConditionOf(conditionBucket(c)))).toEqual(
      WISH_CONDITIONS,
    );
    expect(wishConditionOf(conditionBucket('damaged'))).toBe('minor_damage');
    expect(wishConditionOf(conditionBucket('poor'))).toBe('minor_damage');
    expect(wishConditionOf('')).toBeNull();
    expect(wishConditionOf(null)).toBeNull();
    expect(wishConditionOf('cond:used')).toBeNull();
  });
});
