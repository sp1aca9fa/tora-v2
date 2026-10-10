import { TCG_FRANCHISES, productClass } from '@tora/core';
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

const SOURCE_LABELS: Record<string, string> = {
  snkrdunk: 'SNKRDUNK',
  mercari: 'Mercari',
  surugaya: '駿河屋',
  tcgcsv: 'TCGplayer',
  ebay: 'eBay',
};

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

/** A lot's condition in a few words: "PSA 10", "Raw A", "Shrink-wrapped", "No grade". */
export function lotConditionLabel(
  holding: Pick<
    Holding,
    'grading' | 'grader' | 'grade' | 'rawGrade' | 'packagingState' | 'condition'
  >,
  product: Pick<Product, 'category' | 'kind'>,
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
  return holding.condition ? t(`condition.${holding.condition}`) : null;
}
