import {
  INSIGHT_PERIODS,
  type SummaryPanel,
  type UserPreferences,
  productClass,
  summaryPrefs,
} from '@tora/core';
import {
  type Db,
  type Mover,
  type PortfolioRow,
  type Product,
  imageVersions,
  moversByPeriod,
  summarizeByProduct,
  tradeCounts,
} from '@tora/db';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { ProductImage } from '@/components/product-image';
import { formatJpy } from '@/lib/utils';
import { signedJpy } from './header';
import { type InsightPanel, InsightsCard } from './insights-card';

interface Row {
  product: Product;
  /** The big number (e.g. "+12.5%"), and a smaller one under it. */
  main: string;
  sub?: string;
}
type Columns = { label?: string; rows: Row[] }[];

const pct = (n: number) => `${n > 0 ? '+' : ''}${n}%`;

/** Panels whose numbers change with the period picked on the card. */
const BY_PERIOD: readonly SummaryPanel[] = [
  'movers_pct',
  'movers_jpy',
  'movers_sealed',
  'most_traded',
  'market_movers',
  'market_traded',
];

/**
 * The Summary's insights (requirements S8): the user's movers by percent, by yen and for sealed
 * product, their most traded items, gains and losses since purchase, their most valuable items,
 * and across every item any user holds, the market's movers and most traded items. Movers and
 * trades switch between 7 days, 30 days, 90 days and a year. Panels without data are left out;
 * the user's preferences pick and order the rest.
 */
export async function Insights({
  db,
  userId,
  rows,
  preferences,
}: {
  db: Db;
  userId: string;
  rows: PortfolioRow[];
  preferences: UserPreferences | null;
}) {
  const prefs = summaryPrefs(preferences);
  const [movers, trades, t] = await Promise.all([
    moversByPeriod(db, userId, INSIGHT_PERIODS),
    prefs.panels.some((p) => p === 'most_traded' || p === 'market_traded')
      ? tradeCounts(db, userId, INSIGHT_PERIODS)
      : [],
    getTranslations(),
  ]);
  const values = new Map(rows.map((r) => [r.holding.id, r.valuation]));
  // Gains and losses only for investments (counted in cost and value); worth for any lot
  // counted in value (S8 tracking switches).
  const items = summarizeByProduct(
    rows.filter((r) => r.holding.countInValue),
    values,
  );
  const investments = summarizeByProduct(
    rows.filter((r) => r.holding.countInCost && r.holding.countInValue),
    values,
  );

  const moverRow = (m: Mover, byYen = false): Row => ({
    product: m.product,
    main: byYen ? signedJpy(m.changeJpy) : pct(m.pct),
    sub: byYen ? pct(m.pct) : signedJpy(m.changeJpy),
  });
  const upDown = (
    list: Mover[],
    key: 'pct' | 'changeJpy',
    labels: [string, string] = [t('portfolio.insights.up'), t('portfolio.insights.down')],
  ): Columns | null => {
    const up = list
      .filter((m) => m[key] > 0)
      .toSorted((a, b) => b[key] - a[key])
      .slice(0, 3);
    const down = list
      .filter((m) => m[key] < 0)
      .toSorted((a, b) => a[key] - b[key])
      .slice(0, 3);
    if (up.length + down.length === 0) return null;
    return [
      { label: labels[0], rows: up.map((m) => moverRow(m, key === 'changeJpy')) },
      { label: labels[1], rows: down.map((m) => moverRow(m, key === 'changeJpy')) },
    ];
  };
  const traded = (days: number, mineOnly: boolean): Columns | null => {
    const top = trades
      .filter((r) => (!mineOnly || r.mine) && (r.sales.get(days) ?? 0) > 0)
      .toSorted((a, b) => b.sales.get(days)! - a.sales.get(days)!)
      .slice(0, 6);
    return top.length
      ? [
          {
            rows: top.map((r) => ({
              product: r.product,
              main: t('portfolio.insights.sales', { count: r.sales.get(days)! }),
            })),
          },
        ]
      : null;
  };
  const plRow = (s: (typeof investments)[number]): Row => ({
    product: s.product,
    main: signedJpy(s.unrealizedJpy!),
    sub:
      s.valuedCostJpy > 0
        ? pct(Math.round((s.unrealizedJpy! / s.valuedCostJpy) * 1000) / 10)
        : undefined,
  });
  const withPl = investments.filter((s) => s.unrealizedJpy !== null && s.unrealizedJpy !== 0);

  /** A panel's columns for a period (the period is ignored by panels that do not move). */
  const content = (id: SummaryPanel, days: number): Columns | null => {
    const mine = movers.mine.get(days) ?? [];
    switch (id) {
      case 'movers_pct':
        return upDown(mine, 'pct');
      case 'movers_jpy':
        return upDown(mine, 'changeJpy');
      case 'movers_sealed':
        return upDown(
          mine.filter((m) => productClass(m.product) === 'sealed'),
          'pct',
        );
      case 'most_traded':
        return traded(days, true);
      case 'market_movers':
        return upDown(movers.market.get(days) ?? [], 'pct');
      case 'market_traded':
        return traded(days, false);
      case 'gains': {
        const up = withPl
          .filter((s) => s.unrealizedJpy! > 0)
          .toSorted((a, b) => b.unrealizedJpy! - a.unrealizedJpy!)
          .slice(0, 3);
        const down = withPl
          .filter((s) => s.unrealizedJpy! < 0)
          .toSorted((a, b) => a.unrealizedJpy! - b.unrealizedJpy!)
          .slice(0, 3);
        return up.length + down.length
          ? [
              { label: t('portfolio.insights.gainsUp'), rows: up.map(plRow) },
              { label: t('portfolio.insights.gainsDown'), rows: down.map(plRow) },
            ]
          : null;
      }
      case 'most_valuable': {
        const top = items
          .filter((s) => s.valueJpy > 0)
          .toSorted((a, b) => b.valueJpy - a.valueJpy)
          .slice(0, 6);
        return top.length
          ? [
              {
                rows: top.map((s) => ({
                  product: s.product,
                  main: formatJpy(s.valueJpy),
                  sub: t('portfolio.units', { count: s.units }),
                })),
              },
            ]
          : null;
      }
    }
  };

  // Each panel's content per period (one entry for panels without periods).
  const built = prefs.panels.map((id) => {
    const periods: number[] = BY_PERIOD.includes(id) ? [...INSIGHT_PERIODS] : [30];
    return { id, versions: periods.map((days) => ({ days, columns: content(id, days) })) };
  });
  const shown = built.filter((b) => b.versions.some((v) => v.columns));
  const images = await imageVersions(db, [
    ...new Set(
      shown.flatMap((b) =>
        b.versions.flatMap((v) =>
          (v.columns ?? []).flatMap((c) => c.rows.map((r) => r.product.id)),
        ),
      ),
    ),
  ]);
  const list = (rows: Row[]) => (
    <ul className="space-y-1">
      {rows.map((r) => (
        <li key={r.product.id}>
          <Link
            href={`/products/${r.product.id}`}
            className="flex items-center gap-3 rounded-md p-1.5 hover:bg-accent/50"
          >
            <ProductImage
              product={r.product}
              version={images.get(r.product.id)}
              className="size-10"
            />
            <span className="min-w-0 flex-1 truncate text-sm">{r.product.name}</span>
            <span className="shrink-0 text-right text-sm tabular-nums">
              <span className="block font-medium">{r.main}</span>
              {r.sub && <span className="block text-xs text-muted-foreground">{r.sub}</span>}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
  const render = (columns: Columns | null): ReactNode => {
    if (!columns) {
      return (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {t('portfolio.insights.noData')}
        </p>
      );
    }
    const filled = columns.filter((c) => c.rows.length > 0);
    // One list splits into two columns on wide screens, like the rising / falling pairs.
    const parts =
      filled.length === 1 && !filled[0]!.label
        ? [filled[0]!.rows.slice(0, 3), filled[0]!.rows.slice(3)]
            .filter((r) => r.length)
            .map((rows) => ({ rows, label: undefined }))
        : filled;
    return (
      <div className="grid gap-4 md:grid-cols-2">
        {parts.map((c, i) => (
          <div key={i} className="space-y-2">
            {c.label && <h3 className="text-xs font-medium text-muted-foreground">{c.label}</h3>}
            {list(c.rows)}
          </div>
        ))}
      </div>
    );
  };
  const panels: InsightPanel[] = shown.map(({ id, versions }) => ({
    id,
    title: t(`portfolio.insights.title.${id}`),
    market: id.startsWith('market_'),
    bodies:
      versions.length > 1
        ? versions.map((v) => ({ days: v.days, body: render(v.columns) }))
        : undefined,
    body: versions.length === 1 ? render(versions[0]!.columns) : null,
  }));
  return (
    <InsightsCard
      panels={panels}
      rotate={prefs.rotate}
      seconds={prefs.seconds}
      periods={[...INSIGHT_PERIODS]}
    />
  );
}
