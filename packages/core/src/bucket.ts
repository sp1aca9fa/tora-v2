import {
  type Condition,
  GRADERS,
  type Grader,
  type Grading,
  type PackagingState,
  type RawGrade,
} from './domain';
import { type Taxonomy, conditionList, conditionListOf } from './categories';
import type { ProductClass } from './taxonomy';

/**
 * Valuation bucket (requirements section 6), e.g. `raw:A`, `graded:PSA:10`, `sealed:shrink`,
 * `cond:new`; an admin's condition list: `{list}:{value}` (S16).
 */
export type Bucket = string;

export interface BucketInput {
  productClass: ProductClass;
  condition?: Condition | null;
  packagingState?: PackagingState | null;
  grading?: Grading | null;
  rawGrade?: RawGrade | null;
  grader?: Grader | null;
  grade?: string | null;
  /** The value of an admin's condition list (S16). */
  conditionValue?: string | null;
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
  switch (conditionListOf(input.productClass)) {
    case 'card_grades': {
      if (input.grading === 'graded') {
        if (!input.grader || !input.grade?.trim()) return null;
        return gradedBucket(input.grader, input.grade);
      }
      return input.rawGrade ? `raw:${input.rawGrade}` : null;
    }
    case 'sealed':
      return input.packagingState ? SEALED_BUCKETS[input.packagingState] : null;
    case 'item_condition':
      return input.condition ? CONDITION_BUCKETS[input.condition] : null;
    default: {
      const list = conditionListOf(input.productClass);
      return input.conditionValue ? `${list}:${input.conditionValue}` : null;
    }
  }
}

/** A card's grade: raw (SNKRDUNK S-D) or a slab. */
export type CardGrade =
  { grading: 'raw'; rawGrade: RawGrade } | { grading: 'graded'; grader: Grader; grade: string };

/** Reads typed grades: "A", "raw B", "PSA10", "BGS 9.5", "cgc10". Null when unclear. */
export function parseGrade(text: string): CardGrade | null {
  const t = text.normalize('NFKC').trim().toUpperCase();
  const raw = t.match(/^(?:RAW\s*)?([SABCD])$/);
  if (raw) return { grading: 'raw', rawGrade: raw[1] as RawGrade };
  const slab = t.match(/^([A-Z]+)\s*(\d{1,2}(?:\.\d)?)$/);
  const grader = GRADERS.find((g) => g.toUpperCase() === slab?.[1]);
  if (!slab || !grader || grader === 'other') return null;
  const grade = slab[2]!.replace(/\.0$/, '');
  return Number(grade) >= 1 && Number(grade) <= 10 ? { grading: 'graded', grader, grade } : null;
}

/**
 * The condition item pages compare markets in (S7, S16), from the condition most owned units are
 * in, and whether another market's plain price (no bucket: ungraded, as sold new) counts in it.
 * TCG: ungraded cards in their grade, graded ones at ungraded A (plain prices are for ungraded
 * near-mint cards); sealed with shrink unless the lot has none. Other lists: the lot's own
 * condition, plain prices only in the list's best value. Null: nothing to compare in.
 */
export function compareBucket(
  itemType: ProductClass,
  mainBucket: Bucket | null,
  taxonomy: Taxonomy,
): { bucket: Bucket; plain: boolean } | null {
  const list = conditionListOf(itemType);
  if (list === 'card_grades') {
    return { bucket: mainBucket?.startsWith('raw:') ? mainBucket : 'raw:A', plain: true };
  }
  if (list === 'sealed') {
    return {
      bucket: mainBucket === 'sealed:no_shrink' ? mainBucket : 'sealed:shrink',
      plain: true,
    };
  }
  const first = conditionList(taxonomy, list)?.values[0]?.key;
  const best = list === 'item_condition' ? 'cond:new' : first ? `${list}:${first}` : null;
  const bucket = mainBucket ?? best;
  return bucket ? { bucket, plain: bucket === best } : null;
}
