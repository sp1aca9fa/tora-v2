import {
  SPREAD_DIMENSIONS,
  SPREAD_HEAVY_ITEM,
  SPREAD_HEAVY_SHARE,
  SPREAD_LITTLE_SHARE,
  type SpreadDimension,
  heldLittle,
  productClass,
  spreadOf,
} from '@tora/core';
import { portfolioValuation, spreadSet, worthByGroup } from '@tora/db';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { userActions } from '@/lib/actions';
import { authed } from '@/lib/auth/guard';
import { getMoney } from '@/lib/money-server';
import { cn } from '@/lib/utils';
import { PortfolioHeader } from '../_portfolio/header';
import { typeLabel } from '../opportunities/cards';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('portfolio'))('title') };
}

/** Groups shown per dimension before "N more". */
const SHOWN = 6;
const pct = (share: number) => `${Math.round(share * 1000) / 10}%`;

/**
 * Portfolio, Spread tab (requirements S27 step 6): how the collection's value is spread over item
 * types, franchises, sets, eras and price levels; heavy groups and items flagged; types and sets
 * held little that have items worth a look, linked to Worth a look.
 */
export default async function SpreadPage() {
  const money = await getMoney();
  const { db, user } = await authed();
  const [portfolio, actions, worth, t] = await Promise.all([
    portfolioValuation(db, user.id),
    userActions(),
    worthByGroup(db, user),
    getTranslations(),
  ]);
  // The lots counted in value: at market value, or at cost with none (as the value chart).
  const lots = portfolio.rows
    .filter((r) => r.holding.countInValue)
    .map(({ holding, product, valuation }) => ({
      productId: product.id,
      value: valuation.valueBase ?? holding.costTotalBase,
      units: holding.quantity,
      type: productClass(product),
      franchise: product.franchise,
      set: spreadSet(product),
      released: product.releaseDate,
    }));
  const spread = spreadOf(lots);
  const names = new Map(portfolio.rows.map((r) => [r.product.id, r.product.name]));
  const label = (d: SpreadDimension, key: string) => {
    if (key === '') return t(d === 'set' ? 'spread.noSet' : 'spread.unknown');
    if (d === 'type') return typeLabel(t, key);
    if (d === 'franchise') return t.has(`franchise.${key}`) ? t(`franchise.${key}`) : key;
    if (d === 'era') return key === 'before2016' ? t('spread.before2016') : key;
    if (d === 'price') {
      return t(`spread.price.${key}`, { a: money(1_000), b: money(10_000), c: money(100_000) });
    }
    return key;
  };
  const little = {
    type: heldLittle(spread.dimensions.type, worth.types),
    set: heldLittle(spread.dimensions.set, worth.sets),
  } as const;
  const link = (d: 'type' | 'set', key: string) =>
    d === 'type'
      ? `/opportunities?type=${encodeURIComponent(key)}`
      : `/opportunities?q=${encodeURIComponent(key)}`;

  return (
    <div className="space-y-4">
      <PortfolioHeader totals={portfolio.totals} actions={actions} tab="spread" />
      {spread.total === 0 ? (
        <p className="text-sm text-muted-foreground">{t('spread.empty')}</p>
      ) : (
        <>
          <p className="max-w-3xl text-xs text-muted-foreground">
            {t('spread.intro', {
              heavy: pct(SPREAD_HEAVY_SHARE),
              item: pct(SPREAD_HEAVY_ITEM),
              little: pct(SPREAD_LITTLE_SHARE),
            })}
          </p>
          {spread.heavyItems.length > 0 && (
            <section className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-800 dark:bg-amber-950/40">
              <h2 className="font-medium">{t('spread.heavyItems')}</h2>
              <ul className="mt-1 space-y-0.5">
                {spread.heavyItems.map((i) => (
                  <li key={i.productId} className="flex justify-between gap-3">
                    <Link
                      href={`/products/${i.productId}`}
                      className="min-w-0 truncate hover:underline"
                    >
                      {names.get(i.productId) ?? i.productId}
                    </Link>
                    <span className="shrink-0 tabular-nums">
                      {pct(i.share)} · {money(i.value)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            {SPREAD_DIMENSIONS.map((d) => {
              const groups = spread.dimensions[d];
              const pointed = d === 'type' || d === 'set' ? little[d] : [];
              return (
                <section key={d} className="space-y-2 rounded-xl border bg-card px-4 py-3">
                  <h2 className="font-medium">{t(`spread.dimension.${d}`)}</h2>
                  <ul className="space-y-1.5 text-sm">
                    {groups.slice(0, SHOWN).map((g) => (
                      <li key={g.key}>
                        <div className="flex justify-between gap-3">
                          <span className={cn('min-w-0 truncate', g.heavy && 'font-medium')}>
                            {label(d, g.key)}
                          </span>
                          <span className="shrink-0 tabular-nums">
                            {pct(g.share)}{' '}
                            <span className="text-xs text-muted-foreground">{money(g.value)}</span>
                          </span>
                        </div>
                        <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-muted">
                          <div
                            className={cn('h-full', g.heavy ? 'bg-amber-500' : 'bg-primary/70')}
                            style={{ width: `${Math.max(1, g.share * 100)}%` }}
                          />
                        </div>
                        {g.heavy && (
                          <p className="text-xs text-amber-700 dark:text-amber-300">
                            {t('spread.heavy', { share: pct(g.share) })}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                  {groups.length > SHOWN && (
                    <p className="text-xs text-muted-foreground">
                      {t('spread.more', {
                        count: groups.length - SHOWN,
                        share: pct(groups.slice(SHOWN).reduce((s, g) => s + g.share, 0)),
                      })}
                    </p>
                  )}
                  {pointed.length > 0 && (
                    <div className="space-y-1 border-t pt-2">
                      <p className="text-xs text-muted-foreground">{t('spread.little')}</p>
                      <ul className="flex flex-wrap gap-1.5 text-xs">
                        {pointed.slice(0, SHOWN).map((g) => (
                          <li key={g.key}>
                            <Link
                              href={link(d as 'type' | 'set', g.key)}
                              className="inline-block rounded-full border px-2.5 py-1 hover:bg-accent"
                            >
                              {t('spread.littleItem', {
                                name: label(d, g.key),
                                share: pct(g.share),
                                count: g.worth,
                              })}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
