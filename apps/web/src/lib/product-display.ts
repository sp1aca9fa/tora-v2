import { TCG_FRANCHISES } from '@tora/core';
import type { Product } from '@tora/db';

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
