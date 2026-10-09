import {
  CATEGORIES,
  CONDITIONS,
  GRADERS,
  GRADINGS,
  PACKAGING_STATES,
  PRODUCT_KINDS,
  type ProductClass,
  RAW_GRADES,
  REGIONS,
  holdingFieldsFor,
  productFieldsFor,
} from '@tora/core';
import type { HoldingInput, ProductInput } from '@tora/db';
import { z } from 'zod';
import { optDateText, optEnum, optText, optYen, reqEnum } from './form';

export const productSchema = z.object({
  category: reqEnum(CATEGORIES),
  kind: reqEnum(PRODUCT_KINDS),
  name: optText,
  franchise: optText,
  region: optEnum(REGIONS),
  platform: optText,
  setId: optText,
  setName: optText,
  setCode: optText,
  variant: optText,
  cardNumber: optText,
  rarity: optText,
  releaseDate: optDateText,
  retailPriceJpy: optYen,
});

/**
 * Keeps the fields that apply to the category + kind (the rest are stored as null). Returns null
 * when the name is missing.
 */
export function productInputFrom(data: z.infer<typeof productSchema>): ProductInput | null {
  if (!data.name) return null;
  const allowed = new Set<string>(productFieldsFor(data.category, data.kind));
  const pick = <K extends keyof typeof data>(key: K) =>
    allowed.has(key as string) ? (data[key] ?? null) : null;
  return {
    category: data.category,
    kind: data.kind,
    name: data.name,
    // TCG franchise comes from the franchise chips, so it is always kept.
    franchise: data.franchise ?? null,
    region: data.region ?? null,
    platform: pick('platform'),
    setId: data.category === 'tcg' ? (data.setId ?? null) : null,
    setName: pick('setName'),
    setCode: pick('setCode'),
    variant: pick('variant'),
    cardNumber: pick('cardNumber'),
    rarity: pick('rarity'),
    releaseDate: pick('releaseDate'),
    retailPriceJpy: pick('retailPriceJpy'),
  };
}

export const conditionSchema = z.object({
  condition: optEnum(CONDITIONS),
  packagingState: optEnum(PACKAGING_STATES),
  grading: optEnum(GRADINGS),
  rawGrade: optEnum(RAW_GRADES),
  grader: optEnum(GRADERS),
  grade: optText,
  certNumber: optText,
});

type ConditionInput = Pick<
  HoldingInput,
  'condition' | 'packagingState' | 'grading' | 'rawGrade' | 'grader' | 'grade' | 'certNumber'
>;

/** Condition fields for the product class, plus the names of required fields that are missing. */
export function conditionInputFrom(
  cls: ProductClass,
  data: z.infer<typeof conditionSchema>,
): { input: ConditionInput; missing: string[] } {
  const show = holdingFieldsFor(cls);
  const missing: string[] = [];
  const input: ConditionInput = {
    condition: null,
    packagingState: null,
    grading: null,
    rawGrade: null,
    grader: null,
    grade: null,
    certNumber: null,
  };
  if (show.condition) {
    input.condition = data.condition ?? null;
    if (!input.condition) missing.push('condition');
  }
  if (show.packaging) {
    input.packagingState = data.packagingState ?? null;
    if (cls === 'sealed' && !input.packagingState) missing.push('packagingState');
  }
  if (show.grading) {
    input.grading = data.grading ?? 'raw';
    if (input.grading === 'raw') {
      input.rawGrade = data.rawGrade ?? null;
      if (!input.rawGrade) missing.push('rawGrade');
    } else {
      input.grader = data.grader ?? null;
      input.grade = data.grade ?? null;
      input.certNumber = data.certNumber ?? null;
      if (!input.grader) missing.push('grader');
      if (!input.grade) missing.push('grade');
    }
  }
  return { input, missing };
}
