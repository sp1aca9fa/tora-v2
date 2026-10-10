import {
  CATEGORIES,
  type Category,
  HOLDING_STATUSES,
  type HoldingStatus,
  type ProductKind,
  kindsFor,
} from '@tora/core';
import {
  cardGradeCounts,
  imageVersions,
  importReviewCount,
  listInventory,
  pendingMatchesForUser,
  portfolioSeries,
  portfolioValuation,
  summarizeByProduct,
} from '@tora/db';
import { ChevronRight, Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { PortfolioChart } from '@/components/charts/portfolio-chart';
import { ProductImage } from '@/components/product-image';
import { Button } from '@/components/ui/button';
import { authed } from '@/lib/auth/guard';
import { franchiseLabel, lotConditionLabel } from '@/lib/product-display';
import { formatJpy } from '@/lib/utils';
import { InventoryFilters } from './inventory-filters';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('portfolio'))('title') };
}

type SearchParams = Promise<{ q?: string; type?: string; status?: string }>;

/** `type` is a category (`tcg`) or category:kind (`tcg:booster_box`). */
function parseType(type: string | undefined): { category?: Category; kind?: ProductKind } {
  const [c, k] = (type ?? '').split(':');
  if (!CATEGORIES.includes(c as Category)) return {};
  const category = c as Category;
  return kindsFor(category).includes(k as ProductKind)
    ? { category, kind: k as ProductKind }
    : { category };
}

export default async function PortfolioPage({ searchParams }: { searchParams: SearchParams }) {
  const { db, user } = await authed();
  const sp = await searchParams;
  const { category, kind } = parseType(sp.type);
  const status =
    sp.status === 'all' || HOLDING_STATUSES.includes(sp.status as HoldingStatus)
      ? (sp.status as HoldingStatus | 'all')
      : 'owned';
  const q = sp.q?.trim().slice(0, 100) || undefined;

  const [rows, portfolio, series, matches, grades, toReview, t] = await Promise.all([
    listInventory(db, user.id, { category, kind, status, q }),
    portfolioValuation(db, user.id),
    portfolioSeries(db, user.id),
    pendingMatchesForUser(db, user.id),
    cardGradeCounts(db, user.id),
    importReviewCount(db, user.id),
    getTranslations(),
  ]);
  const { totals } = portfolio;
  const valuations = new Map(portfolio.rows.map((r) => [r.holding.id, r.valuation]));
  const summaries = summarizeByProduct(rows, valuations);
  const images = await imageVersions(
    db,
    summaries.map((s) => s.product.id),
  );
  const pl = totals.unrealizedJpy;
  const chartPoints = series.map((s) => ({
    date: s.date,
    valueJpy: Number(s.valueJpy),
    costJpy: Number(s.costJpy),
    atCostJpy: Number(s.atCostJpy),
    estimatedJpy: Number(s.estimatedJpy),
  }));
  const maxBreakdown = Math.max(
    1,
    ...portfolio.breakdown.map((b) => Math.max(b.valueJpy, b.costJpy)),
  );
  const filtered = Boolean(category || q || status !== 'owned');

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t('portfolio.title')}</h1>
        <Button asChild size="sm" className="hidden md:inline-flex">
          <Link href="/add">
            <Plus /> {t('nav.add')}
          </Link>
        </Button>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border bg-card px-4 py-3">
          <p className="text-xs text-muted-foreground">{t('portfolio.marketValue')}</p>
          <p className="text-xl font-semibold tabular-nums">{formatJpy(totals.valueJpy)}</p>
          <p className="text-xs text-muted-foreground">
            {t('portfolio.valuedOf', { valued: totals.valued, total: totals.total })}
          </p>
        </div>
        <div className="rounded-xl border bg-card px-4 py-3">
          <p className="text-xs text-muted-foreground">{t('portfolio.unrealized')}</p>
          <p className="text-xl font-semibold tabular-nums">
            {pl > 0 ? '▲ +' : pl < 0 ? '▼ ' : ''}
            {formatJpy(pl)}
          </p>
          <p className="text-xs text-muted-foreground">
            {totals.valuedCostJpy > 0
              ? t('portfolio.vsCost', {
                  pct: Math.round((pl / totals.valuedCostJpy) * 1000) / 10,
                  cost: formatJpy(totals.valuedCostJpy),
                })
              : '-'}
          </p>
        </div>
        <div className="col-span-2 rounded-xl border bg-card px-4 py-3 sm:col-span-1">
          <p className="text-xs text-muted-foreground">{t('portfolio.spent')}</p>
          <p className="text-xl font-semibold tabular-nums">{formatJpy(totals.spentJpy)}</p>
          <p className="text-xs text-muted-foreground">
            {t('portfolio.itemsValue', { units: totals.units, lots: totals.total })}
          </p>
        </div>
      </section>

      {chartPoints.length >= 2 && (
        <section className="space-y-2 rounded-xl border bg-card px-4 py-3">
          <h2 className="text-sm font-medium">{t('portfolio.overTime')}</h2>
          <PortfolioChart points={chartPoints} />
        </section>
      )}

      {portfolio.breakdown.length > 1 && (
        <details className="rounded-xl border bg-card px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium">
            {t('portfolio.breakdown')}
          </summary>
          <ul className="mt-3 space-y-2 text-sm">
            {portfolio.breakdown.map((b) => (
              <li key={`${b.category}:${b.kind}`} className="space-y-1">
                <div className="flex justify-between gap-3">
                  <span>
                    {t(`kind.${b.kind}`)} <span className="text-muted-foreground">× {b.count}</span>
                  </span>
                  <span className="tabular-nums">
                    {formatJpy(b.valueJpy)}{' '}
                    <span className="text-xs text-muted-foreground">/ {formatJpy(b.costJpy)}</span>
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-muted" aria-hidden>
                  <div
                    className="h-1.5 rounded-full bg-[#2a78d6] dark:bg-[#3987e5]"
                    style={{ width: `${(b.valueJpy / maxBreakdown) * 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">{t('portfolio.breakdownHint')}</p>
        </details>
      )}

      {matches.length > 0 && (
        <Link
          href="/matches"
          className="flex items-center justify-between rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm"
        >
          <span>{t('sources.banner', { count: matches.length })}</span>
          <ChevronRight className="size-4" />
        </Link>
      )}

      {toReview > 0 && (
        <Link
          href="/imports"
          className="flex items-center justify-between rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm"
        >
          <span>{t('imports.banner', { count: toReview })}</span>
          <ChevronRight className="size-4" />
        </Link>
      )}

      {toReview === 0 && grades.ungraded > 0 && (
        <Link
          href="/holdings/grades"
          className="flex items-center justify-between rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm"
        >
          <span>{t('grades.banner', { count: grades.ungraded })}</span>
          <ChevronRight className="size-4" />
        </Link>
      )}

      <Suspense>
        <InventoryFilters />
      </Suspense>

      {summaries.length === 0 ? (
        <div className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
          {filtered ? t('inventory.emptyFiltered') : t('portfolio.empty')}
          {!filtered && (
            <div className="mt-4">
              <Button asChild size="sm">
                <Link href="/add">{t('inventory.addFirst')}</Link>
              </Button>
            </div>
          )}
        </div>
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {summaries.map((s) => {
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
            const pl = s.unrealizedJpy;
            return (
              <li key={product.id}>
                <Link
                  href={`/products/${product.id}`}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/50"
                >
                  <ProductImage
                    product={product}
                    version={images.get(product.id)}
                    className="size-12"
                  />
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="truncate font-medium">{product.name}</p>
                    <p className="truncate text-sm text-muted-foreground">{details.join(' · ')}</p>
                    <p className="truncate text-xs text-muted-foreground">{lotsLine}</p>
                  </div>
                  <div className="shrink-0 text-right text-sm">
                    {s.valuedLots > 0 ? (
                      <>
                        <p className="font-medium tabular-nums">{formatJpy(s.valueJpy)}</p>
                        {pl !== null && (
                          <p className="text-xs tabular-nums">
                            {pl > 0 ? '▲ +' : pl < 0 ? '▼ ' : ''}
                            {formatJpy(pl)}
                            {s.valuedCostJpy > 0 && (
                              <span className="text-muted-foreground">
                                {' '}
                                ({Math.round((pl / s.valuedCostJpy) * 1000) / 10}%)
                              </span>
                            )}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground tabular-nums">
                          {t('portfolio.spentShort', { amount: formatJpy(s.spentJpy) })}
                        </p>
                        {s.valuedLots < s.lots.length && (
                          <p className="text-xs text-muted-foreground">
                            {t('portfolio.lotsValued', {
                              valued: s.valuedLots,
                              total: s.lots.length,
                            })}
                          </p>
                        )}
                      </>
                    ) : (
                      <>
                        <p className="tabular-nums">{formatJpy(s.spentJpy)}</p>
                        <p className="text-xs text-muted-foreground">
                          {statuses.length === 1 && statuses[0] !== 'owned'
                            ? t(`status.${statuses[0]}`)
                            : t('valuation.short.none')}
                        </p>
                      </>
                    )}
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {grades.cards > 0 && grades.ungraded === 0 && (
        <p className="text-right text-sm">
          <Link href="/holdings/grades" className="text-muted-foreground hover:text-foreground">
            {t('grades.link')}
          </Link>
        </p>
      )}
    </div>
  );
}
