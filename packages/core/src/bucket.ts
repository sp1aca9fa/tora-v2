import type { Condition, Grader, Grading, PackagingState, RawGrade } from './domain';
import type { ProductClass } from './taxonomy';

/** Valuation bucket (requirements section 6), e.g. `raw:A`, `graded:PSA:10`, `sealed:shrink`, `cond:new`. */
export type Bucket = string;

export interface BucketInput {
  productClass: ProductClass;
  condition?: Condition | null;
  packagingState?: PackagingState | null;
  grading?: Grading | null;
  rawGrade?: RawGrade | null;
  grader?: Grader | null;
  grade?: string | null;
}

const SEALED_BUCKETS: Record<PackagingState, Bucket | null> = {
  sealed_shrink: 'sealed:shrink',
  sealed_no_shrink: 'sealed:no_shrink',
  box_opened_contents_sealed: 'sealed:box_opened_contents_sealed',
  opened: 'sealed:opened',
  empty: 'sealed:empty',
  'n/a': null,
};

const CONDITION_BUCKETS: Record<Condition, Bucket> = {
  new_unused: 'cond:new',
  like_new: 'cond:like_new',
  no_noticeable_damage: 'cond:good',
  minor_damage: 'cond:fair',
  damaged: 'cond:fair',
  poor: 'cond:fair',
};

/** Graded bucket key, normalizing the grader and grade text (`PSA`, `10`; `BGS`, `9.5`). */
export function gradedBucket(grader: Grader, grade: string): Bucket {
  const normalizedGrade = grade.trim().replace(/\.0+$/, '');
  return `graded:${grader.toUpperCase()}:${normalizedGrade}`;
}

/**
 * The bucket a holding is valued in. Returns null when the holding lacks the fields
 * needed to decide (e.g. a raw card without a raw grade).
 */
export function deriveBucket(input: BucketInput): Bucket | null {
  switch (input.productClass) {
    case 'card': {
      if (input.grading === 'graded') {
        if (!input.grader || !input.grade?.trim()) return null;
        return gradedBucket(input.grader, input.grade);
      }
      return input.rawGrade ? `raw:${input.rawGrade}` : null;
    }
    case 'sealed':
      return input.packagingState ? SEALED_BUCKETS[input.packagingState] : null;
    default:
      return input.condition ? CONDITION_BUCKETS[input.condition] : null;
  }
}
