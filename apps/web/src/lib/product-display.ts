import {
  SET_LINES,
  TCG_FRANCHISES,
  type Taxonomy,
  conditionListOf,
  fieldsFor,
  pickName,
  productClass,
} from '@tora/core';
import type { Holding, Product } from '@tora/db';

type T = (key: string) => string;

/** Franchise label: known TCG franchises are translated, others shown as entered. */
export function franchiseLabel(franchise: string | null, t: T): string | null {
  if (!franchise) return null;
  return (TCG_FRANCHISES as readonly string[]).includes(franchise)
    ? t(`franchise.${franchise}`)
    : franchise;
}

/** Set line label: the built-in lines are translated, the admin's own shown as entered. */
export function lineLabel(line: string, t: T): string {
  return (SET_LINES as readonly string[]).includes(line) ? t(`lines.${line}`) : line;
}

/** One-line description: kind · franchise · region · platform · set · number · rarity. */
export function productMeta(
  p: Pick<
    Product,
    'kind' | 'franchise' | 'region' | 'platform' | 'setName' | 'cardNumber' | 'rarity'
  >,
  t: T,
  options: { kind?: boolean } = {},
): string {
  return [
    options.kind !== false && t(`kind.${p.kind}`),
    franchiseLabel(p.franchise, t),
    p.region && t(`region.${p.region}`),
    p.platform,
    p.setName,
    p.cardNumber,
    p.rarity,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** A lot's condition in a few words: "PSA 10", "Raw A", "Shrink-wrapped", "No grade". */
export function lotConditionLabel(
  holding: Pick<
    Holding,
    'grading' | 'grader' | 'grade' | 'rawGrade' | 'packagingState' | 'condition'
  > & { conditionValue?: string | null },
  product: Pick<Product, 'category' | 'kind'> & { itemType?: string | null },
  t: T,
): string | null {
  const cls = productClass(product);
  if (cls === 'card') {
    if (holding.grading === 'graded') {
      return `${holding.grader === 'other' ? t('common.other') : holding.grader} ${holding.grade}`;
    }
    return holding.rawGrade ? `Raw ${holding.rawGrade}` : t('grades.noGrade');
  }
  if (cls === 'sealed')
    return holding.packagingState ? t(`packaging.${holding.packagingState}`) : null;
  // The admin's own condition list (S16): its value's name (see taxonomy-messages).
  const list = conditionListOf(cls);
  if (!['card_grades', 'sealed', 'item_condition'].includes(list)) {
    return holding.conditionValue ? t(`conditionValue.${list}.${holding.conditionValue}`) : null;
  }
  return holding.condition ? t(`condition.${holding.condition}`) : null;
}

/** Bucket codes of the ready-made lists and the conditions they stand for (see core's bucket.ts). */
const CONDITION_OF_BUCKET: Record<string, string> = {
  'cond:new': 'condition.new_unused',
  'cond:like_new': 'condition.like_new',
  'cond:good': 'condition.no_noticeable_damage',
  'cond:fair': 'conditionPool.fair',
};

/**
 * A price condition's name for people ("Sealed (shrink)", "PSA 10", "Raw A", the admin's own
 * values), from its code (`sealed:shrink`, `graded:PSA:10`); an unknown code is shown as is.
 */
export function bucketLabel(bucket: string, t: T & { has?: (key: string) => boolean }): string {
  const [list, ...rest] = bucket.split(':');
  const value = rest.join(':');
  if (list === 'graded') {
    const [grader, grade] = rest;
    return `${grader === 'OTHER' ? t('common.other') : grader} ${grade}`;
  }
  if (list === 'raw') return `Raw ${value}`;
  const key =
    CONDITION_OF_BUCKET[bucket] ??
    (list === 'sealed'
      ? `packaging.${value === 'shrink' || value === 'no_shrink' ? `sealed_${value}` : value}`
      : `conditionValue.${list}.${value}`);
  return !t.has || t.has(key) ? t(key) : bucket;
}

/** The item's custom fields with a value, shown on its page (S16; not those the admin hides). */
export function customFieldLines(
  product: Pick<Product, 'category' | 'kind' | 'fields'>,
  taxonomy: Taxonomy,
  locale: string,
  t: T,
): { key: string; label: string; value: string }[] {
  return fieldsFor(taxonomy, product.category, product.kind)
    .filter((f) => !f.standard && !f.hidden && product.fields?.[f.key] !== undefined)
    .map((f) => {
      const v = product.fields![f.key]!;
      const value =
        typeof v === 'boolean'
          ? t(v ? 'common.yes' : 'common.no')
          : f.type === 'choice'
            ? pickName(f.choices?.find((c) => c.key === v)?.names, locale, String(v))
            : String(v);
      return { key: f.key, label: pickName(f.names, locale, f.key), value };
    });
}
