import {
  CONDITIONS,
  GRADERS,
  GRADINGS,
  LANGUAGES,
  PACKAGING_STATES,
  PRODUCT_FIELDS,
  PRODUCT_TYPES,
  type ProductType,
  RAW_GRADES,
  holdingFieldsFor,
} from '@tora/core';
import type { HoldingInput, ProductInput } from '@tora/db';
import { z } from 'zod';
import { optDateText, optEnum, optText, optYen, reqEnum } from './form';

export const productSchema = z.object({
  type: reqEnum(PRODUCT_TYPES),
  nameJa: optText,
  nameEn: optText,
  franchise: optText,
  setName: optText,
  setCode: optText,
  cardNumber: optText,
  rarity: optText,
  language: optEnum(LANGUAGES),
  releaseDate: optDateText,
  retailPriceJpy: optYen,
});

/** Keeps only the fields that apply to the type; the rest are stored as null. */
export function productInputFrom(data: z.infer<typeof productSchema>): ProductInput {
  const allowed = new Set<string>(PRODUCT_FIELDS[data.type]);
  const pick = <K extends keyof typeof data>(key: K) =>
    allowed.has(key as string) ? (data[key] ?? null) : null;
  return {
    type: data.type,
    nameJa: data.nameJa ?? null,
    nameEn: data.nameEn ?? null,
    franchise: pick('franchise'),
    setName: pick('setName'),
    setCode: pick('setCode'),
    cardNumber: pick('cardNumber'),
    rarity: pick('rarity'),
    language: pick('language'),
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

/** Condition fields for the type, plus the names of required fields that are missing. */
export function conditionInputFrom(
  type: ProductType,
  data: z.infer<typeof conditionSchema>,
): { input: ConditionInput; missing: string[] } {
  const show = holdingFieldsFor(type);
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
    if (type === 'sealed_tcg' && !input.packagingState) missing.push('packagingState');
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
