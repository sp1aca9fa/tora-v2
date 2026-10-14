import type { TrackingMode } from '@tora/core';
import type { Holding, Product, ProductSummary } from '@tora/db';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ProductImage } from '@/components/product-image';
import { franchiseLabel, lotConditionLabel } from '@/lib/product-display';
import { signedAmount } from '../_portfolio/header';
import { getMoney } from '@/lib/money-server';

/**
 * One item of the portfolio (requirements S8): a row on phones (bigger picture, the name on up to
 * two lines), a vertical card from 768 px (picture on top, the name on up to three lines).
 */
export async function ItemCard({
  summary: s,
  mode = 'investment',
  version,
}: {
  summary: ProductSummary<{ holding: Holding; product: Product }>;
  /** Its lots' tracking group (S8): what the card shows besides the item. */
  mode?: TrackingMode;
  version: string | undefined;
}) {
  const money = await getMoney();
  const t = await getTranslations();
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

  return (
    <li className="md:flex">
      <Link
        href={`/products/${product.id}`}
        className="flex w-full items-center gap-3 px-3 py-3 transition-colors hover:bg-accent/50 md:flex-col md:items-stretch md:gap-2 md:rounded-xl md:border md:bg-card md:p-3"
      >
        <ProductImage
          product={product}
          version={version}
          className="size-[4.5rem] md:aspect-square md:size-auto md:w-full"
        />
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="line-clamp-2 text-[0.9375rem] leading-snug font-medium md:line-clamp-3">
            {product.name}
          </p>
          <p className="truncate text-xs text-muted-foreground">{details.join(' · ')}</p>
          <p className="truncate text-xs text-muted-foreground">{lotsLine}</p>
        </div>
        <div className="shrink-0 text-right text-sm md:mt-auto md:flex md:items-baseline md:justify-between md:gap-2 md:border-t md:pt-2 md:text-left">
          {mode === 'untracked' ? (
            <p className="text-xs text-muted-foreground">{t('tracking.short.untracked')}</p>
          ) : mode === 'cost_only' ? (
            <>
              <p className="tabular-nums">{money(s.spentBase)}</p>
              <p className="text-xs text-muted-foreground">{t('tracking.short.cost_only')}</p>
            </>
          ) : s.valuedLots > 0 ? (
            <>
              <p className="font-medium tabular-nums">{money(s.valueBase)}</p>
              <div className="md:text-right">
                {mode === 'value_only' ? (
                  <p className="text-xs text-muted-foreground">{t('tracking.short.value_only')}</p>
                ) : (
                  <>
                    {pl !== null && (
                      <p className="text-xs tabular-nums">
                        {signedAmount(money, pl)}
                        {s.valuedCostBase > 0 && (
                          <span className="text-muted-foreground">
                            {' '}
                            ({Math.round((pl / s.valuedCostBase) * 1000) / 10}%)
                          </span>
                        )}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {s.valuedLots < s.lots.length
                        ? t('portfolio.lotsValued', { valued: s.valuedLots, total: s.lots.length })
                        : t('portfolio.spentShort', { amount: money(s.spentBase) })}
                    </p>
                  </>
                )}
              </div>
            </>
          ) : (
            <>
              <p className="tabular-nums">{money(s.spentBase)}</p>
              <p className="text-xs text-muted-foreground">
                {statuses.length === 1 && statuses[0] !== 'owned'
                  ? t(`status.${statuses[0]}`)
                  : t('valuation.short.none')}
              </p>
            </>
          )}
        </div>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground md:hidden" />
      </Link>
    </li>
  );
}
