import {
  type OpportunitySignal,
  type OpportunityTests,
  OPPORTUNITY_WARNINGS,
  PROVEN_MIN_CHECKS,
  localDate,
  provenEdge,
} from '@tora/core';
import {
  type Opportunity,
  type Product,
  type RankingBoard,
  buyPlanFor,
  imageVersions,
  opportunitiesFor,
  rankingBoards,
} from '@tora/db';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { AmountsToggle } from '@/components/amounts-toggle';
import { Tabs } from '@/components/ui/tabs';
import { authed } from '@/lib/auth/guard';
import { getMoney } from '@/lib/money-server';
import { bucketLabel, franchiseLabel } from '@/lib/product-display';
import { OpportunityList } from './opportunity-list';
import { CHIP, type OpportunityRowData } from './opportunity-row';
import { PlanCard } from './plan-card';
import { cn } from '@/lib/utils';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('nav'))('opportunities') };
}

type Item = Opportunity & { product: Product; owned: boolean; watching: boolean };

const pct = (x: number) => `${Math.round(x * 100)}%`;
const signed = (x: number) => `${x > 0 ? '+' : ''}${pct(x)}`;

/**
 * Opportunities (requirements S13): items worth a look within their group of similar items, from
 * the signals worked out after the collect. Only signals proven on the group's past prices rank
 * items; each says its record. Tabs per item type, then each group's signals and records.
 */
export default async function OpportunitiesPage() {
  const { db, user } = await authed();
  const [data, boards, plan, t, money] = await Promise.all([
    opportunitiesFor(db, user.id),
    rankingBoards(db, user.id),
    buyPlanFor(db, user),
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

  /** An item worth a look, as its row's texts (drawn in parts on the client, S14). */
  const rowData = (o: Item): OpportunityRowData => {
    const signals = [
      ...o.proven.map((key) => ({ key, style: 'proven' as const })),
      ...o.warnings.map((key) => ({ key, style: 'warning' as const })),
      ...o.unproven.map((key) => ({ key, style: 'unproven' as const })),
    ];
    const rank = rankOf(o.productId);
    return {
      productId: o.productId,
      href: `/products/${o.productId}${o.bucket ? `?condition=${encodeURIComponent(o.bucket)}` : ''}`,
      product: {
        id: o.product.id,
        name: o.product.name,
        category: o.product.category,
        kind: o.product.kind,
      },
      version: images.get(o.productId) ?? null,
      meta: [
        o.bucket && bucketLabel(o.bucket, t),
        o.owned && t('opportunities.owned'),
        o.watching && t('opportunities.watching'),
        !o.product.createdBy && !o.owned && !o.watching && t('opportunities.candidate'),
        rank,
      ].filter((m): m is string => Boolean(m)),
      price: o.numbers.price !== null ? money(o.numbers.price) : null,
      askUnder:
        o.askUnder && o.ask && o.numbers.price
          ? t('opportunities.askUnder', {
              amount: money(o.ask.price),
              pct: pct(1 - o.ask.price / o.numbers.price),
            })
          : null,
      buylistNear:
        o.buylistNear && o.buylist
          ? t('opportunities.buylistNear', { amount: money(o.buylist.price) })
          : null,
      signals: signals.map(({ key, style }) => ({
        key,
        style,
        label: `${t(`opportunities.signal.${key}`)}${style === 'unproven' ? ` (${t('opportunities.notProven')})` : ''}`,
        why: why(o, key),
        record: style !== 'unproven' ? record(o.tests, key) : null,
      })),
      watching: o.watching,
    };
  };
  const labels = { price: t('opportunities.priceLabel'), watch: t('opportunities.watch') };

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
              <OpportunityList rows={list.map(rowData)} labels={labels} />
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
            <div className="grid items-start gap-4 xl:grid-cols-2">{records(type)}</div>
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
      <PlanCard
        rows={plan.map((p) => ({
          productId: p.productId,
          bucket: p.bucket,
          name: p.product.name,
          step: p.step,
          from: p.from,
          ticked: p.ticked,
        }))}
        budget={user.preferences?.buyPlan?.budget ?? null}
        until={user.preferences?.buyPlan?.until ?? null}
        today={localDate()}
      />
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
