import type { TrackingMode } from '@tora/core';
import type { Holding, Product, ProductSummary } from '@tora/db';
import type { Money } from '@/lib/money';
import { franchiseLabel, lotConditionLabel } from '@/lib/product-display';
import { signedAmount } from '../_portfolio/header';
import type { ItemCardData } from './item-card';

type T = (key: string, values?: Record<string, string | number>) => string;

/** The card's texts for an item's lots in a tracking group (S8). */
export function itemCardData(
  s: ProductSummary<{ holding: Holding; product: Product }>,
  mode: TrackingMode,
  version: string | undefined,
  money: Money,
  t: T,
): ItemCardData {
  const { product } = s;
  const details = [
    t(`kind.${product.kind}`),
    franchiseLabel(product.franchise, t),
    product.region && product.region !== 'jp' && t(`region.${product.region}`),
  ].filter(Boolean);
  // Units per condition, e.g. "PSA 10 ×2 · Raw A ×5".
  const conditions = new Map<string, number>();
  for (const { holding } of s.lots) {
    const label = lotConditionLabel(holding, product, t);
    if (label) conditions.set(label, (conditions.get(label) ?? 0) + holding.quantity);
  }
  const lotsLine = [
    t('portfolio.lotsUnits', { lots: s.lots.length, units: s.units }),
    ...[...conditions].map(([label, n]) => (n > 1 ? `${label} ×${n}` : label)),
  ].join(' · ');
  const statuses = [...new Set(s.lots.map((l) => l.holding.status))];
  const pl = s.unrealizedBase;
  const card = {
    product: { id: product.id, name: product.name, category: product.category, kind: product.kind },
    version: version ?? null,
    details: details.join(' · '),
    lotsLine,
    amount: null,
    pl: null,
    note: null,
  };
  const note = (text: string, nums = false) => ({ text, nums });
  if (mode === 'untracked') return { ...card, note: note(t('tracking.short.untracked')) };
  const spent = { text: money(s.spentBase), strong: false };
  if (mode === 'cost_only')
    return { ...card, amount: spent, note: note(t('tracking.short.cost_only')) };
  if (s.valuedLots === 0)
    return {
      ...card,
      amount: spent,
      note: note(
        statuses.length === 1 && statuses[0] !== 'owned'
          ? t(`status.${statuses[0]}`)
          : t('valuation.short.none'),
      ),
    };
  const amount = { text: money(s.valueBase), strong: true };
  if (mode === 'value_only') return { ...card, amount, note: note(t('tracking.short.value_only')) };
  return {
    ...card,
    amount,
    pl:
      pl === null
        ? null
        : {
            text: signedAmount(money, pl),
            pct:
              s.valuedCostBase > 0 ? `${Math.round((pl / s.valuedCostBase) * 1000) / 10}%` : null,
          },
    note: note(
      s.valuedLots < s.lots.length
        ? t('portfolio.lotsValued', { valued: s.valuedLots, total: s.lots.length })
        : t('portfolio.spentShort', { amount: money(s.spentBase) }),
      true,
    ),
  };
}
