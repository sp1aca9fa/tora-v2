import {
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
