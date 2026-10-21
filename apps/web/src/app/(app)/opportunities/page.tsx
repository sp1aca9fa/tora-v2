import {
  type OpportunitySignal,
  type OpportunityTests,
  OPPORTUNITY_WARNINGS,
  PROVEN_MIN_CHECKS,
  provenEdge,
} from '@tora/core';
import {
  type Opportunity,
  type Product,
  type RankingBoard,
  imageVersions,
  opportunitiesFor,
  rankingBoards,
} from '@tora/db';
import { Binoculars, ChevronRight } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { AmountsToggle } from '@/components/amounts-toggle';
import { ProductImage } from '@/components/product-image';
import { Button } from '@/components/ui/button';
import { Tabs } from '@/components/ui/tabs';
import { authed } from '@/lib/auth/guard';
import { getMoney } from '@/lib/money-server';
import { franchiseLabel } from '@/lib/product-display';
import { cn } from '@/lib/utils';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('nav'))('opportunities') };
}

type Item = Opportunity & { product: Product; owned: boolean; watching: boolean };

const pct = (x: number) => `${Math.round(x * 100)}%`;
const signed = (x: number) => `${x > 0 ? '+' : ''}${pct(x)}`;

const CHIP = {
  proven: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300',
  warning: 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
  unproven: 'bg-muted text-muted-foreground',
} as const;

/**
 * Opportunities (requirements S13): items worth a look within their group of similar items, from
 * the signals worked out after the collect. Only signals proven on the group's past prices rank
 * items; each says its record. Tabs per item type, then each group's signals and records.
 */
export default async function OpportunitiesPage() {
  const { db, user } = await authed();
  const [data, boards, t, money] = await Promise.all([
    opportunitiesFor(db, user.id),
    rankingBoards(db, user.id),
    getTranslations(),
    getMoney(),
  ]);
  const items = data?.items ?? [];
  const shown = items.filter((o) => o.proven.length > 0);
  const images = await imageVersions(
    db,
    shown.map((o) => o.productId),
  );
  const typeLabel = (type: string) =>
    t.has(`sourceRoles.class.${type}`) ? t(`sourceRoles.class.${type}`) : type;
  const groupLabel = (p: Product) =>
    [
      t(`kind.${p.kind}`),
      franchiseLabel(p.franchise, t),
      p.region && t(`region.${p.region}`),
      p.platform,
    ]
      .filter(Boolean)
      .join(' · ');

  /** Why a signal is on, from the item's numbers. */
  const why = (o: Item, key: OpportunitySignal) => {
    const n = o.numbers;
    return t(`opportunities.why.${key}`, {
      line: n.line84 ? signed(n.line84.change) : '-',
      items: (key.endsWith('_age') ? n.age?.items : n.line84?.items) ?? 0,
      own: n.own84 !== null ? signed(n.own84) : '-',
      sales30: n.sales30,
      before: Math.round(n.salesBefore),
      change: n.age ? signed(n.age.change) : '-',
      typical: n.age ? signed(n.age.typical) : '-',
      days: n.age?.days ?? 0,
    });
  };
  const record = (tests: OpportunityTests | null, key: OpportunitySignal) => {
    const r = tests?.signals[key];
    if (!tests || !r || r.checked < PROVEN_MIN_CHECKS) {
      return t('opportunities.recordFew', { checked: r?.checked ?? 0 });
    }
    return t('opportunities.record', {
      higher: r.higher,
      checked: r.checked,
      pct: pct(r.higher / r.checked),
      any: tests.any.checked ? pct(tests.any.higher / tests.any.checked) : '-',
    });
  };

  /** "#3 on SNKRDUNK popular Pokemon boxes (up 2 in a week)" for a ranked item. */
  const rankLine = (rank: number, weekAgo: number | null, label: string) =>
    t('opportunities.rankLine', {
      rank,
      label,
      move:
        weekAgo === null
          ? t('opportunities.rankNew')
          : weekAgo === rank
            ? t('opportunities.rankSame')
            : t(weekAgo > rank ? 'opportunities.rankUp' : 'opportunities.rankDown', {
                n: Math.abs(weekAgo - rank),
              }),
    });
  const rankOf = (productId: string) => {
    for (const b of boards) {
      const i = b.items.find((x) => x.productId === productId);
      if (i) return rankLine(i.rank, i.weekAgo, b.label);
    }
    return null;
  };
  /** A ranking's items in order, with what the site shows and what the person has. */
  const popular = (b: RankingBoard) => (
    <section key={b.ranking} className="space-y-2">
      <div className="space-y-1">
        <h2 className="font-semibold">{t('opportunities.popularTitle', { label: b.label })}</h2>
        <p className="max-w-3xl text-xs text-muted-foreground">
          {t('opportunities.popularIntro', { day: b.day })}
        </p>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-xs">
          <thead className="text-muted-foreground">
            <tr className="border-b text-left">
              <th className="px-3 py-2 text-right font-medium">#</th>
              <th className="px-3 py-2 font-medium">{t('opportunities.colItem')}</th>
              <th className="px-3 py-2 text-right font-medium">{t('opportunities.colWeek')}</th>
              <th className="px-3 py-2 text-right font-medium">{t('opportunities.colPrice')}</th>
              <th className="px-3 py-2 text-right font-medium">{t('opportunities.colListings')}</th>
              <th className="px-3 py-2 text-right font-medium">
                {t('opportunities.colFavorites')}
              </th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {b.items.map((i) => (
              <tr key={`${i.rank}|${i.title}`} className="border-b last:border-0 align-top">
                <td className="px-3 py-1.5 text-right">{i.rank}</td>
                <td className="px-3 py-1.5">
                  {i.productId ? (
                    <Link href={`/products/${i.productId}`} className="hover:underline">
                      {i.title}
                    </Link>
                  ) : (
                    i.title
                  )}
                  <span className="ml-2 text-muted-foreground">
                    {[
                      i.owned && t('opportunities.owned'),
                      i.watching && t('opportunities.watching'),
                      i.candidate && !i.owned && !i.watching && t('opportunities.candidate'),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-right">
                  {i.weekAgo === null
                    ? t('opportunities.rankNew')
                    : i.weekAgo === i.rank
                      ? '='
                      : `${i.weekAgo > i.rank ? '+' : '-'}${Math.abs(i.weekAgo - i.rank)}`}
                </td>
                <td className="px-3 py-1.5 text-right">
                  {i.price !== null ? money(i.price) : '-'}
                </td>
                <td className="px-3 py-1.5 text-right">{i.numbers?.listings ?? '-'}</td>
                <td className="px-3 py-1.5 text-right">{i.numbers?.favorites ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );

  const row = (o: Item) => {
    const signals = [
      ...o.proven.map((key) => ({ key, style: 'proven' as const })),
      ...o.warnings.map((key) => ({ key, style: 'warning' as const })),
      ...o.unproven.map((key) => ({ key, style: 'unproven' as const })),
    ];
    const href = `/products/${o.productId}${o.bucket ? `?condition=${encodeURIComponent(o.bucket)}` : ''}`;
    return (
      <li key={o.productId} className="px-3 py-3">
        <Link href={href} className="flex items-center gap-3 rounded-md hover:bg-accent/50">
          <ProductImage
            product={o.product}
            version={images.get(o.productId)}
            className="size-14 shrink-0"
          />
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="line-clamp-2 text-sm leading-snug font-medium">{o.product.name}</p>
            <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
              {o.bucket && <span className="font-mono">{o.bucket}</span>}
              {o.owned && <span>{t('opportunities.owned')}</span>}
              {o.watching && <span>{t('opportunities.watching')}</span>}
              {!o.product.createdBy && !o.owned && !o.watching && (
                <span>{t('opportunities.candidate')}</span>
              )}
              {rankOf(o.productId) && <span>{rankOf(o.productId)}</span>}
            </p>
          </div>
          <div className="max-w-[45%] shrink-0 space-y-0.5 text-right text-sm">
            {o.numbers.price !== null && (
              <p className="font-medium tabular-nums">{money(o.numbers.price)}</p>
            )}
            {o.askUnder && o.ask && o.numbers.price && (
              <p className="text-xs font-medium text-emerald-700 tabular-nums dark:text-emerald-400">
                {t('opportunities.askUnder', {
                  amount: money(o.ask.price),
                  pct: pct(1 - o.ask.price / o.numbers.price),
                })}
              </p>
            )}
            {o.buylistNear && o.buylist && (
              <p className="text-xs text-muted-foreground tabular-nums">
                {t('opportunities.buylistNear', { amount: money(o.buylist.price) })}
              </p>
            )}
          </div>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        </Link>
        <ul className="mt-2 space-y-1.5 text-xs sm:pl-[68px]">
          {signals.map(({ key, style }) => (
            <li key={key} className="space-y-0.5">
              <span className={cn('rounded px-1.5 py-0.5 font-medium', CHIP[style])}>
                {t(`opportunities.signal.${key}`)}
                {style === 'unproven' && ` (${t('opportunities.notProven')})`}
              </span>{' '}
              <span className="text-muted-foreground">{why(o, key)}</span>
              {style !== 'unproven' && (
                <p className="text-muted-foreground">{record(o.tests, key)}</p>
              )}
            </li>
          ))}
        </ul>
        {!o.watching && (
          <div className="mt-2 sm:pl-[68px]">
            <Button asChild size="sm" variant="outline">
              <Link href={`/watchlist/add?product=${o.productId}`}>
                <Binoculars /> {t('opportunities.watch')}
              </Link>
            </Button>
          </div>
        )}
      </li>
    );
  };

  /** Each group's signals with their record (proven ones first). */
  const records = (type: string) => {
    const groups = new Map<string, { tests: OpportunityTests; product: Product }>();
    for (const o of items) {
      if (o.itemType === type && o.tests && !groups.has(o.group)) {
        groups.set(o.group, { tests: o.tests, product: o.product });
      }
    }
    return [...groups.values()]
      .filter((g) => g.tests.any.checked > 0)
      .map(({ tests, product }) => {
        const keys = (Object.keys(tests.signals) as OpportunitySignal[]).sort();
        const higher = (h: number, c: number) => (c ? pct(h / c) : '-');
        return (
          <div key={groupLabel(product)} className="space-y-2">
            <h3 className="text-sm font-medium">
              {groupLabel(product)}{' '}
              <span className="font-normal text-muted-foreground">
                {t('opportunities.group', { items: tests.items })}
              </span>
            </h3>
            <div className="overflow-x-auto rounded-xl border bg-card">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr className="border-b text-left">
                    <th className="px-3 py-2 font-medium">{t('opportunities.colSignal')}</th>
                    <th className="px-3 py-2 text-right font-medium">
                      {t('opportunities.colChecked')}
                    </th>
                    <th className="px-3 py-2 text-right font-medium">
                      {t('opportunities.colHigher')}
                    </th>
                    <th className="px-3 py-2 text-right font-medium">
                      {t('opportunities.colChange')}
                    </th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  <tr className="border-b bg-muted/40">
                    <td className="px-3 py-1.5">{t('opportunities.anyDay')}</td>
                    <td className="px-3 py-1.5 text-right">{tests.any.checked}</td>
                    <td className="px-3 py-1.5 text-right">
                      {higher(tests.any.higher, tests.any.checked)}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {tests.any.change !== null ? signed(tests.any.change) : '-'}
                    </td>
                  </tr>
                  {keys.map((key) => {
                    const r = tests.signals[key]!;
                    const proven =
                      provenEdge(tests, key) === null
                        ? null
                        : (OPPORTUNITY_WARNINGS as readonly string[]).includes(key)
                          ? 'warning'
                          : 'proven';
                    return (
                      <tr key={key} className="border-b last:border-0">
                        <td className="px-3 py-1.5">
                          {t(`opportunities.signal.${key}`)}
                          {proven && (
                            <span
                              className={cn(
                                'ml-2 rounded px-1.5 py-0.5',
                                CHIP[proven === 'warning' ? 'warning' : 'proven'],
                              )}
                            >
                              {t(`opportunities.${proven}`)}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-right">{r.checked}</td>
                        <td className="px-3 py-1.5 text-right">{higher(r.higher, r.checked)}</td>
                        <td className="px-3 py-1.5 text-right">
                          {r.change !== null ? signed(r.change) : '-'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      });
  };

  const types = [
    ...new Set([
      ...items.map((o) => o.itemType),
      ...boards.flatMap((b) => b.items.flatMap((i) => (i.itemType ? [i.itemType] : []))),
    ]),
  ];
  const panels = types.map((type) => {
    const list = shown.filter((o) => o.itemType === type);
    const others = items.filter(
      (o) => o.itemType === type && !o.proven.length && (o.unproven.length || o.warnings.length),
    ).length;
    return {
      key: type,
      label: `${typeLabel(type)}${list.length ? ` (${list.length})` : ''}`,
      content: (
        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="font-semibold">{t('opportunities.worthALook')}</h2>
            {list.length ? (
              <ul className="divide-y rounded-xl border bg-card">{list.map(row)}</ul>
            ) : (
              <p className="rounded-xl border bg-card px-4 py-6 text-sm text-muted-foreground">
                {t('opportunities.noneProven')}
              </p>
            )}
            {others > 0 && (
              <p className="text-xs text-muted-foreground">
                {t('opportunities.alsoOn', { count: others })}
              </p>
            )}
          </section>
          {boards.filter((b) => b.items.some((i) => i.itemType === type)).map(popular)}
          <section className="space-y-3">
            <div className="space-y-1">
              <h2 className="font-semibold">{t('opportunities.recordsTitle')}</h2>
              <p className="max-w-3xl text-xs text-muted-foreground">
                {t('opportunities.recordsIntro')}
              </p>
            </div>
            {records(type)}
          </section>
        </div>
      ),
    };
  });
  // The type with the most items worth a look first.
  const initial = types.toSorted(
    (a, b) =>
      shown.filter((o) => o.itemType === b).length - shown.filter((o) => o.itemType === a).length,
  )[0];

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <div className="flex items-center gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t('opportunities.title')}</h1>
          <AmountsToggle />
        </div>
        <p className="max-w-3xl text-sm text-muted-foreground">{t('opportunities.intro')}</p>
        {data && (
          <p className="text-xs text-muted-foreground">
            {t('opportunities.updated', { day: data.day })}
          </p>
        )}
      </header>
      {panels.length ? (
        <Tabs tabs={panels} initial={initial} />
      ) : (
        <p className="rounded-xl border bg-card px-4 py-6 text-sm text-muted-foreground">
          {t('opportunities.none')}
        </p>
      )}
    </div>
  );
}
