import { CATEGORIES, type Category } from '@tora/core';
import { type Db, portfolioSeries, portfolioValuation } from '@tora/db';
import { ChevronRight } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { PortfolioChart } from '@/components/charts/portfolio-chart';
import { userActions } from '@/lib/actions';
import { authed } from '@/lib/auth/guard';
import { cn } from '@/lib/utils';
import { PortfolioHeader, signedAmount } from './_portfolio/header';
import { Insights } from './_portfolio/insights';
import { getMoney } from '@/lib/money-server';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('portfolio'))('title') };
}

const card = 'rounded-xl border bg-card px-4 py-3';

/** Portfolio, Summary tab (requirements S8): how the collection is doing, at a glance. */
export default async function SummaryPage() {
  const money = await getMoney();
  const { db, user } = await authed();
  const [portfolio, actions, t] = await Promise.all([
    portfolioValuation(db, user.id),
    userActions(),
    getTranslations(),
  ]);
  const maxBreakdown = Math.max(
    1,
    ...portfolio.breakdown.map((b) => Math.max(b.valueBase, b.costBase)),
  );
  // Per category: units, value and P/L of the valued lots, as the header counts them.
  const categories = new Map<
    Category,
    {
      units: number;
      valueBase: number;
      costBase: number;
      plValueBase: number;
      valuedCostBase: number;
    }
  >();
  for (const { holding, product, valuation } of portfolio.rows) {
    const c = categories.get(product.category) ?? {
      units: 0,
      valueBase: 0,
      costBase: 0,
      plValueBase: 0,
      valuedCostBase: 0,
    };
    // By the lot's tracking switches, like the totals.
    c.units += holding.quantity;
    if (holding.countInCost) c.costBase += holding.costTotalBase;
    if (holding.countInValue && valuation.valueBase !== null) c.valueBase += valuation.valueBase;
    if (holding.countInCost && holding.countInValue && valuation.valueBase !== null) {
      c.plValueBase += valuation.valueBase;
      c.valuedCostBase += holding.costTotalBase;
    }
    categories.set(product.category, c);
  }
  // Opened lots: their cost, as in the header's spent and P/L.
  for (const { holding, product } of portfolio.opened) {
    const c = categories.get(product.category) ?? {
      units: 0,
      valueBase: 0,
      costBase: 0,
      plValueBase: 0,
      valuedCostBase: 0,
    };
    categories.set(product.category, c);
    c.costBase += holding.costTotalBase;
    if (holding.countInValue) c.valuedCostBase += holding.costTotalBase;
  }

  return (
    <div className="space-y-4">
      <PortfolioHeader totals={portfolio.totals} actions={actions} tab="summary" />

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {CATEGORIES.filter((c) => categories.has(c)).map((c) => {
          const s = categories.get(c)!;
          const pl = s.plValueBase - s.valuedCostBase;
          return (
            <Link
              key={c}
              href={`/items?type=${c}`}
              className={cn(card, 'flex items-center gap-3 transition-colors hover:bg-accent/50')}
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium">{t(`category.${c}`)}</p>
                <p className="amount text-xs text-muted-foreground">
                  {t('portfolio.units', { count: s.units })} ·{' '}
                  {t('portfolio.spentShort', { amount: money(s.costBase) })}
                </p>
              </div>
              <div className="text-right">
                <p className="text-lg font-semibold tabular-nums">{money(s.valueBase)}</p>
                {s.valuedCostBase > 0 && (
                  <p className="text-xs tabular-nums">
                    {signedAmount(money, pl)}{' '}
                    <span className="text-muted-foreground">
                      ({Math.round((pl / s.valuedCostBase) * 1000) / 10}%)
                    </span>
                  </p>
                )}
              </div>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </Link>
          );
        })}
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Suspense
            fallback={<div className="h-72 animate-pulse rounded-xl border bg-card" aria-hidden />}
          >
            <ValueOverTime db={db} userId={user.id} />
          </Suspense>
        </div>
        {portfolio.breakdown.length > 0 && (
          // On wide screens the row takes the chart's height; a long list scrolls inside.
          <section className="rounded-xl border bg-card lg:relative lg:min-h-64">
            <div className="space-y-3 px-4 py-3 lg:absolute lg:inset-0 lg:overflow-y-auto">
              <h2 className="text-sm font-medium">{t('portfolio.breakdown')}</h2>
              <ul className="space-y-2.5 text-sm">
                {portfolio.breakdown.map((b) => (
                  <li key={`${b.category}:${b.kind}`}>
                    <Link href={`/items?type=${b.category}:${b.kind}`} className="block space-y-1">
                      <div className="flex justify-between gap-3">
                        <span>
                          {t(`kind.${b.kind}`)}{' '}
                          <span className="text-muted-foreground">× {b.count}</span>
                        </span>
                        <span className="tabular-nums">
                          {money(b.valueBase)}{' '}
                          <span className="text-xs text-muted-foreground">
                            / {money(b.costBase)}
                          </span>
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-muted" aria-hidden>
                        <div
                          className="h-1.5 rounded-full bg-[#2a78d6] dark:bg-[#3987e5]"
                          style={{ width: `${(b.valueBase / maxBreakdown) * 100}%` }}
                        />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">{t('portfolio.breakdownHint')}</p>
            </div>
          </section>
        )}
      </div>

      <Suspense
        fallback={<div className="h-40 animate-pulse rounded-xl border bg-card" aria-hidden />}
      >
        <Insights db={db} userId={user.id} rows={portfolio.rows} preferences={user.preferences} />
      </Suspense>
    </div>
  );
}

/** The value-over-time chart, loaded after the rest of the page (it reads every snapshot). */
async function ValueOverTime({ db, userId }: { db: Db; userId: string }) {
  const [series, t] = await Promise.all([portfolioSeries(db, userId), getTranslations()]);
  if (series.length < 2) return null;
  const points = series.map((s) => ({
    date: s.date,
    valueBase: Number(s.valueBase),
    costBase: Number(s.costBase),
    atCostBase: Number(s.atCostBase),
    estimatedBase: Number(s.estimatedBase),
  }));
  return (
    <section className={cn(card, 'h-full space-y-2')}>
      <h2 className="text-sm font-medium">{t('portfolio.overTime')}</h2>
      <PortfolioChart points={points} />
    </section>
  );
}
