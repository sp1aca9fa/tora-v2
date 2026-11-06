import {
  SPREAD_DIMENSIONS,
  SPREAD_HEAVY_ITEM,
  SPREAD_HEAVY_SHARE,
  SPREAD_LITTLE_SHARE,
  type SpreadDimension,
  heldLittle,
  productClass,
  spreadLots,
  spreadOf,
  spreadSetName,
} from '@tora/core';
import { portfolioValuation, worthByGroup } from '@tora/db';
import { ChevronRight } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { userActions } from '@/lib/actions';
import { authed } from '@/lib/auth/guard';
import { getMoney } from '@/lib/money-server';
import { SPREAD_PARAM, franchiseAliases, spreadLabel } from '@/lib/spread-group';
import { cn } from '@/lib/utils';
import { PortfolioHeader } from '../_portfolio/header';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('portfolio'))('title') };
}

/** Groups shown per dimension before "N more". */
const SHOWN = 5;
const pct = (share: number) => `${(share * 100).toFixed(1)}%`;

/**
 * Portfolio, Spread tab (requirements S27 step 6): how the collection's value is spread over item
 * types, franchises, sets, eras and price levels; heavy groups and items flagged; types and sets
 * held little that have items worth a look, linked to Worth a look.
 */
export default async function SpreadPage() {
  const money = await getMoney();
  const { db, user } = await authed();
  const franchiseOf = await franchiseAliases();
  const [portfolio, actions, worth, t] = await Promise.all([
    portfolioValuation(db, user.id),
    userActions(),
    worthByGroup(db, user, franchiseOf),
    getTranslations(),
  ]);
  const spread = spreadOf(
    spreadLots(
      portfolio.rows.map((r) => ({
        ...r,
        type: productClass(r.product),
        valueBase: r.valuation.valueBase,
      })),
      franchiseOf,
    ),
  );
  const names = new Map(portfolio.rows.map((r) => [r.product.id, r.product.name]));
  const label = (d: SpreadDimension, key: string) => spreadLabel(t, money, d, key);
  // A row opens Items filtered to the lots it counted.
  const rowHref = (d: SpreadDimension, key: string) =>
    `/items?${SPREAD_PARAM[d]}=${encodeURIComponent(key)}`;
  const little = {
    type: heldLittle(spread.dimensions.type, worth.types),
    set: heldLittle(spread.dimensions.set, new Map([...worth.sets].map(([k, s]) => [k, s.count]))),
  } as const;
  // A set's items worth a look of one type open on that type's list; a set name another
  // franchise shares too only by its type, as the search would find both.
  const shared = (key: string) =>
    [...worth.sets.keys()].filter((k) => spreadSetName(k) === spreadSetName(key)).length > 1;
  const link = (d: 'type' | 'set', key: string) => {
    if (d === 'type') return `/opportunities?type=${encodeURIComponent(key)}`;
    const types = [...(worth.sets.get(key)?.types ?? [])];
    const type = types.length === 1 ? `type=${encodeURIComponent(types[0]!)}` : '';
    if (shared(key) && type) return `/opportunities?${type}`;
    return `/opportunities?q=${encodeURIComponent(spreadSetName(key))}${type && `&${type}`}`;
  };

  return (
    <div className="space-y-4">
      <PortfolioHeader totals={portfolio.totals} actions={actions} tab="spread" />
      {spread.total === 0 ? (
        <p className="text-sm text-muted-foreground">{t('spread.empty')}</p>
      ) : (
        <>
          <div className="max-w-3xl space-y-1 text-sm">
            <p>{t('spread.intro', { total: money(spread.total) })}</p>
            {spread.atCostLots > 0 && (
              <p className="text-muted-foreground">
                {t('spread.atCost', {
                  market: money(spread.total - spread.atCost),
                  cost: money(spread.atCost),
                  count: spread.atCostLots,
                  total: money(spread.total),
                })}
              </p>
            )}
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">{t('spread.howTitle')}</summary>
              <p className="mt-1">
                {t('spread.how', {
                  heavy: pct(SPREAD_HEAVY_SHARE),
                  item: pct(SPREAD_HEAVY_ITEM),
                  little: pct(SPREAD_LITTLE_SHARE),
                })}
              </p>
            </details>
          </div>
          {spread.heavyItems.length > 0 && (
            <section className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-800 dark:bg-amber-950/40">
              <h2 className="font-medium">{t('spread.heavyItems')}</h2>
              <ul className="mt-1 space-y-1">
                {spread.heavyItems.map((i) => (
                  <li key={i.productId} className="flex justify-between gap-3">
                    <Link
                      href={`/products/${i.productId}`}
                      className="line-clamp-2 min-w-0 hover:underline"
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
          {/* Columns, so a short card leaves no hole under it. */}
          <div className="columns-1 gap-4 lg:columns-2 xl:columns-3 min-[2400px]:columns-4 min-[3200px]:columns-5">
            {SPREAD_DIMENSIONS.map((d) => {
              const groups = spread.dimensions[d];
              const pointed = d === 'type' || d === 'set' ? little[d] : [];
              const row = (g: (typeof groups)[number]) => (
                <li key={g.key}>
                  <Link
                    href={rowHref(d, g.key)}
                    className="group -mx-2 block rounded-lg px-2 py-1 hover:bg-accent"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span
                        className={cn(
                          'line-clamp-2 min-w-0 group-hover:underline',
                          g.heavy && 'font-medium',
                          g.key === '' && 'text-muted-foreground',
                        )}
                      >
                        {label(d, g.key)}
                      </span>
                      <span className="flex shrink-0 items-center gap-1 tabular-nums">
                        <span>
                          {pct(g.share)}{' '}
                          <span className="text-xs text-muted-foreground">{money(g.value)}</span>
                        </span>
                        <ChevronRight className="size-3.5 text-muted-foreground" />
                      </span>
                    </div>
                    <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn('h-full', g.heavy ? 'bg-amber-500' : 'bg-primary/70')}
                        style={{ width: `${Math.max(1, g.share * 100)}%` }}
                      />
                    </div>
                  </Link>
                  {g.heavy && (
                    <p className="px-2 text-xs text-amber-700 dark:text-amber-300">
                      {t('spread.heavy', { share: pct(g.share) })}
                    </p>
                  )}
                </li>
              );
              return (
                <section
                  key={d}
                  className="mb-4 space-y-2 break-inside-avoid rounded-xl border bg-card px-4 py-3"
                >
                  <h2 className="font-medium">{t(`spread.dimension.${d}`)}</h2>
                  {d === 'franchise' && (
                    <p className="text-xs text-muted-foreground">{t('spread.franchiseNote')}</p>
                  )}
                  <ul className="space-y-1.5 text-sm">{groups.slice(0, SHOWN).map(row)}</ul>
                  {groups.length > SHOWN && (
                    <details className="text-sm">
                      <summary className="cursor-pointer text-xs text-muted-foreground">
                        {t('spread.more', {
                          count: groups.length - SHOWN,
                          share: pct(groups.slice(SHOWN).reduce((s, g) => s + g.share, 0)),
                        })}
                      </summary>
                      <ul className="mt-1.5 space-y-1.5">{groups.slice(SHOWN).map(row)}</ul>
                    </details>
                  )}
                  {pointed.length > 0 && (
                    <div className="space-y-1.5 border-t pt-2">
                      <h3 className="text-xs font-medium">
                        {t(`spread.littleTitle.${d as 'type' | 'set'}`)}
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        {t('spread.littleDay', { day: worth.day ?? '-' })}
                      </p>
                      <ul className="space-y-1 text-xs">
                        {pointed.slice(0, SHOWN).map((g) => (
                          <li key={g.key}>
                            <Link
                              href={link(d as 'type' | 'set', g.key)}
                              className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 hover:bg-accent"
                            >
                              <span className="min-w-0 flex-1">
                                {t('spread.littleItem', {
                                  name: label(d, g.key),
                                  share: pct(g.share),
                                  count: g.worth,
                                })}
                              </span>
                              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
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
