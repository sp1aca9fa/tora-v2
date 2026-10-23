import {
  CONDITIONS,
  GRADERS,
  GRADINGS,
  PACKAGING_STATES,
  type ProductClass,
  RAW_GRADES,
  STANDARD_FIELDS,
  type Taxonomy,
  conditionListOf,
  fieldType,
  fieldsFor,
  holdingFieldsFor,
} from '@tora/core';
import type { HoldingInput, ProductInput } from '@tora/db';
import { z } from 'zod';
import { optDateText, optEnum, optText, optAmount } from './form';

export const productSchema = z.object({
  // Checked against the admin's categories when saved (S16).
  category: z.string().trim().min(1).max(40),
  kind: z.string().trim().min(1).max(40),
  name: optText,
  nameAlias: optText,
  franchise: optText,
  // Checked against the item's category's regions when saved (S10).
  region: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() || undefined : v),
    z.string().max(40).optional(),
  ),
  platform: optText,
  setId: optText,
  setName: optText,
  setCode: optText,
  variant: optText,
  cardNumber: optText,
  rarity: optText,
  releaseDate: optDateText,
  retailPriceBase: optAmount,
});

/** The category's custom fields typed in a form (`f_{key}`), as numbers, yes / no or text (S16). */
/** Form input names of an item's fields: custom fields are `f_<key>` (see `customFieldsFrom`). */
export const fieldInputNames = (keys: string[]) =>
  keys.map((k) => ((STANDARD_FIELDS as readonly string[]).includes(k) ? k : `f_${k}`));

function customFieldsFrom(
  taxonomy: Taxonomy,
  category: string,
  kind: string,
  form: FormData | undefined,
): Record<string, string | number | boolean> | null {
  if (!form) return null;
  const out: Record<string, string | number | boolean> = {};
  for (const f of fieldsFor(taxonomy, category, kind)) {
    if (f.standard) continue;
    const raw = String(form.get(`f_${f.key}`) ?? '').trim();
    if (!raw) continue;
    const type = fieldType(f);
    if (type === 'number') {
      const n = Number(raw.replace(',', '.'));
      if (Number.isFinite(n)) out[f.key] = n;
    } else if (type === 'yesno') out[f.key] = raw === 'true';
    else if (type === 'choice') {
      if (f.choices?.some((c) => c.key === raw)) out[f.key] = raw;
    } else out[f.key] = raw.slice(0, 500);
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Keeps the fields that apply to the category + kind (the rest are stored as null), and its
 * custom fields from the form. Returns null when the name is missing.
 */
export function productInputFrom(
  data: z.infer<typeof productSchema>,
  taxonomy: Taxonomy,
  form?: FormData,
): ProductInput | null {
  if (!data.name) return null;
  const allowed = new Set<string>(
    fieldsFor(taxonomy, data.category, data.kind)
      .filter((f) => f.standard)
      .map((f) => f.key),
  );
  const pick = <K extends keyof typeof data>(key: K) =>
    allowed.has(key as string) ? (data[key] ?? null) : null;
  return {
    category: data.category,
    kind: data.kind,
    name: data.name,
    // The name as sold in the secondary market (S16), when the item has one.
    nameAlias: data.nameAlias ?? null,
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
    retailPriceBase: pick('retailPriceBase'),
    fields: customFieldsFrom(taxonomy, data.category, data.kind, form),
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
  conditionValue: optText,
});

type ConditionInput = Pick<
  HoldingInput,
  | 'condition'
  | 'packagingState'
  | 'grading'
  | 'rawGrade'
  | 'grader'
  | 'grade'
  | 'certNumber'
  | 'conditionValue'
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
    conditionValue: null,
  };
  if (show.value) {
    input.conditionValue = data.conditionValue?.slice(0, 40) ?? null;
    if (!input.conditionValue) missing.push('conditionValue');
  }
  if (show.condition) {
    input.condition = data.condition ?? null;
    if (!input.condition) missing.push('condition');
  }
  if (show.packaging) {
    input.packagingState = data.packagingState ?? null;
    if (conditionListOf(cls) === 'sealed' && !input.packagingState) missing.push('packagingState');
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
