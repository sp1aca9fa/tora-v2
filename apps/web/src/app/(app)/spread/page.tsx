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
import { LOCALES } from '@/i18n/locale';
import { loadMessages } from '@/i18n/messages';
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
const pct = (share: number) => `${(share * 100).toFixed(1)}%`;
const norm = (s: string) => s.normalize('NFKC').trim().toLowerCase();

/** A franchise typed by its name in any language ("ポケモン") read as its key (`pokemon`). */
async function franchiseAliases() {
  const aliases = new Map<string, string>();
  for (const locale of LOCALES) {
    const names = ((await loadMessages(locale)) as { franchise?: Record<string, string> })
      .franchise;
    for (const [key, name] of Object.entries(names ?? {})) aliases.set(norm(name), key);
  }
  return (f: string | null) => (f ? (aliases.get(norm(f)) ?? f) : null);
}

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
  const label = (d: SpreadDimension, key: string) => {
    if (key === '') return t(d === 'set' ? 'spread.noSet' : `spread.unknown.${d}`);
    if (d === 'type') return typeLabel(t, key);
    if (d === 'franchise') return t.has(`franchise.${key}`) ? t(`franchise.${key}`) : key;
    if (d === 'set') return spreadSetName(key);
    if (d === 'era') return key === 'before2016' ? t('spread.before2016') : key;
    return t(`spread.price.${key}`, { a: money(1_000), b: money(10_000), c: money(100_000) });
  };
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
            <p>
              {t('spread.intro', { total: money(spread.total) })}
              {spread.atCostLots > 0 && (
                <span className="text-muted-foreground">
                  {' '}
                  {t('spread.atCost', { amount: money(spread.atCost), count: spread.atCostLots })}
                </span>
              )}
            </p>
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
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            {SPREAD_DIMENSIONS.map((d) => {
              const groups = spread.dimensions[d];
              const pointed = d === 'type' || d === 'set' ? little[d] : [];
              return (
                <section key={d} className="space-y-2 rounded-xl border bg-card px-4 py-3">
                  <h2 className="font-medium">{t(`spread.dimension.${d}`)}</h2>
                  {d === 'franchise' && (
                    <p className="text-xs text-muted-foreground">{t('spread.franchiseNote')}</p>
                  )}
                  <ul className="space-y-1.5 text-sm">
                    {groups.slice(0, SHOWN).map((g) => (
                      <li key={g.key}>
                        <div className="flex justify-between gap-3">
                          <span
                            className={cn(
                              'line-clamp-2 min-w-0',
                              g.heavy && 'font-medium',
                              g.key === '' && 'text-muted-foreground',
                            )}
                          >
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
                    <div className="space-y-1.5 border-t pt-2">
                      <p className="text-xs text-muted-foreground">
                        {t('spread.little', { day: worth.day ?? '-' })}
                      </p>
                      <ul className="space-y-1 text-xs">
                        {pointed.slice(0, SHOWN).map((g) => (
                          <li key={g.key}>
                            <Link
                              href={link(d as 'type' | 'set', g.key)}
                              className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 hover:bg-accent"
                            >
                              <span className="min-w-0 flex-1 truncate">
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
