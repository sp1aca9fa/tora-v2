import { type Locale, deriveBucket, displayName } from '@tora/core';
import { listHoldingsWithProducts } from '@tora/db';
import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { authedDb } from '@/lib/auth/guard';
import { formatJpy } from '@/lib/utils';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('portfolio'))('title') };
}

export default async function PortfolioPage() {
  const db = await authedDb();
  const [rows, t, locale] = await Promise.all([
    listHoldingsWithProducts(db),
    getTranslations(),
    getLocale() as Promise<Locale>,
  ]);
  const productByHolding = new Map(rows.map((r) => [r.holding.id, r.product]));

  return (
    <div className="space-y-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">{t('portfolio.title')}</h1>
        <span className="text-sm text-muted-foreground">
          {t('portfolio.count', { count: rows.length })}
        </span>
      </header>

      {rows.length === 0 ? (
        <p className="text-muted-foreground">{t('portfolio.empty')}</p>
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {rows.map(({ holding, product }) => {
            const parent = holding.parentHoldingId
              ? productByHolding.get(holding.parentHoldingId)
              : undefined;
            const bucket = deriveBucket({ productType: product.type, ...holding });
            const details = [
              t(`productType.${product.type}`),
              holding.condition && t(`condition.${holding.condition}`),
              holding.packagingState &&
                holding.packagingState !== 'n/a' &&
                t(`packaging.${holding.packagingState}`),
              holding.grading === 'raw' && holding.rawGrade && `Raw ${holding.rawGrade}`,
              holding.grading === 'graded' && `${holding.grader} ${holding.grade}`,
            ].filter(Boolean);

            return (
              <li key={holding.id} className="flex items-start justify-between gap-4 px-4 py-3">
                <div className="min-w-0 space-y-1">
                  <p className="font-medium leading-snug">{displayName(product, locale)}</p>
                  <p className="text-sm text-muted-foreground">{details.join(' · ')}</p>
                  {parent && (
                    <p className="text-xs text-muted-foreground">
                      {t('portfolio.pulledFrom', { name: displayName(parent, locale) })}
                    </p>
                  )}
                  {bucket && <p className="font-mono text-xs text-muted-foreground">{bucket}</p>}
                </div>
                <div className="shrink-0 text-right text-sm">
                  <p className="tabular-nums">{formatJpy(holding.costTotalJpy)}</p>
                  <p className="text-muted-foreground">
                    {t('portfolio.qty', { qty: holding.quantity })}
                  </p>
                  {holding.status !== 'owned' && (
                    <p className="text-xs text-muted-foreground">{t(`status.${holding.status}`)}</p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
