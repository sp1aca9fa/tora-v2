import { CATEGORIES, type Category } from '@tora/core';
import { type Db, imageVersions, portfolioSeries, portfolioValuation, topMovers } from '@tora/db';
import { ChevronRight } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { PortfolioChart } from '@/components/charts/portfolio-chart';
import { ProductImage } from '@/components/product-image';
import { userActions } from '@/lib/actions';
import { authed } from '@/lib/auth/guard';
import { cn, formatJpy } from '@/lib/utils';
import { PortfolioHeader, signedJpy } from './_portfolio/header';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('portfolio'))('title') };
}

const card = 'rounded-xl border bg-card px-4 py-3';

/** Portfolio, Summary tab (requirements S8): how the collection is doing, at a glance. */
export default async function SummaryPage() {
  const { db, user } = await authed();
  const [portfolio, actions, t] = await Promise.all([
    portfolioValuation(db, user.id),
    userActions(),
    getTranslations(),
  ]);
  const maxBreakdown = Math.max(
    1,
    ...portfolio.breakdown.map((b) => Math.max(b.valueJpy, b.costJpy)),
  );
  // Per category: units, value and P/L of the valued lots.
  const categories = new Map<
    Category,
    { units: number; valueJpy: number; costJpy: number; valuedCostJpy: number }
  >();
  for (const { holding, product, valuation } of portfolio.rows) {
    const c = categories.get(product.category) ?? {
      units: 0,
      valueJpy: 0,
      costJpy: 0,
      valuedCostJpy: 0,
    };
    c.units += holding.quantity;
    c.costJpy += holding.costTotalJpy;
    if (valuation.valueJpy !== null) {
      c.valueJpy += valuation.valueJpy;
      c.valuedCostJpy += holding.costTotalJpy;
    }
    categories.set(product.category, c);
  }

  return (
    <div className="space-y-4">
      <PortfolioHeader totals={portfolio.totals} actions={actions} tab="summary" />

      <section className="grid gap-3 sm:grid-cols-2">
        {CATEGORIES.filter((c) => categories.has(c)).map((c) => {
          const s = categories.get(c)!;
          const pl = s.valueJpy - s.valuedCostJpy;
          return (
            <Link
              key={c}
              href={`/items?type=${c}`}
              className={cn(card, 'flex items-center gap-3 transition-colors hover:bg-accent/50')}
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium">{t(`category.${c}`)}</p>
                <p className="text-xs text-muted-foreground">
                  {t('portfolio.units', { count: s.units })} ·{' '}
                  {t('portfolio.spentShort', { amount: formatJpy(s.costJpy) })}
                </p>
              </div>
              <div className="text-right">
                <p className="text-lg font-semibold tabular-nums">{formatJpy(s.valueJpy)}</p>
                {s.valuedCostJpy > 0 && (
                  <p className="text-xs tabular-nums">
                    {signedJpy(pl)}{' '}
                    <span className="text-muted-foreground">
                      ({Math.round((pl / s.valuedCostJpy) * 1000) / 10}%)
                    </span>
                  </p>
                )}
              </div>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </Link>
          );
        })}
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Suspense
            fallback={<div className="h-72 animate-pulse rounded-xl border bg-card" aria-hidden />}
          >
            <ValueOverTime db={db} userId={user.id} />
          </Suspense>
        </div>
        {portfolio.breakdown.length > 0 && (
          <section className={cn(card, 'space-y-3')}>
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
                        {formatJpy(b.valueJpy)}{' '}
                        <span className="text-xs text-muted-foreground">
                          / {formatJpy(b.costJpy)}
                        </span>
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-muted" aria-hidden>
                      <div
                        className="h-1.5 rounded-full bg-[#2a78d6] dark:bg-[#3987e5]"
                        style={{ width: `${(b.valueJpy / maxBreakdown) * 100}%` }}
                      />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">{t('portfolio.breakdownHint')}</p>
          </section>
        )}
      </div>

      <Suspense
        fallback={<div className="h-40 animate-pulse rounded-xl border bg-card" aria-hidden />}
      >
        <Movers db={db} userId={user.id} />
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
    valueJpy: Number(s.valueJpy),
    costJpy: Number(s.costJpy),
    atCostJpy: Number(s.atCostJpy),
    estimatedJpy: Number(s.estimatedJpy),
  }));
  return (
    <section className={cn(card, 'space-y-2')}>
      <h2 className="text-sm font-medium">{t('portfolio.overTime')}</h2>
      <PortfolioChart points={points} />
    </section>
  );
}

/** Items whose value rose or fell most over the last 30 days. */
async function Movers({ db, userId }: { db: Db; userId: string }) {
  const [{ up, down }, t] = await Promise.all([topMovers(db, userId, 30), getTranslations()]);
  if (up.length + down.length === 0) return null;
  const images = await imageVersions(
    db,
    [...up, ...down].map((m) => m.product.id),
  );
  const list = (title: string, movers: typeof up) =>
    movers.length > 0 && (
      <div className="space-y-2">
        <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
        <ul className="space-y-1">
          {movers.map((m) => (
            <li key={m.product.id}>
              <Link
                href={`/products/${m.product.id}`}
                className="flex items-center gap-3 rounded-md p-1.5 hover:bg-accent/50"
              >
                <ProductImage
                  product={m.product}
                  version={images.get(m.product.id)}
                  className="size-10"
                />
                <span className="min-w-0 flex-1 truncate text-sm">{m.product.name}</span>
                <span className="shrink-0 text-right text-sm tabular-nums">
                  <span className="block font-medium">
                    {m.pct > 0 ? '+' : ''}
                    {m.pct}%
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {signedJpy(m.changeJpy)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );
  return (
    <section className={cn(card, 'space-y-3')}>
      <h2 className="text-sm font-medium">{t('portfolio.movers.title')}</h2>
      <div className="grid gap-4 md:grid-cols-2">
        {list(t('portfolio.movers.up'), up)}
        {list(t('portfolio.movers.down'), down)}
      </div>
    </section>
  );
}
