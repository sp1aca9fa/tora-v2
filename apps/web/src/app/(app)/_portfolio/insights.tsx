import { type SummaryPanel, productClass, summaryPrefs, type UserPreferences } from '@tora/core';
import {
  type Db,
  type PortfolioRow,
  type Product,
  imageVersions,
  mostTraded,
  summarizeByProduct,
  valueMovers,
} from '@tora/db';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
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

const pct = (n: number) => `${n > 0 ? '+' : ''}${n}%`;

/**
 * The Summary's insights (requirements S8): movers over 30 days by percent, by yen and for sealed
 * product, the most traded items, gains and losses since purchase, and the most valuable items.
 * Panels without data are left out; the user's preferences pick and order the rest.
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
  const [movers, traded, t] = await Promise.all([
    valueMovers(db, userId, 30),
    prefs.panels.includes('most_traded') ? mostTraded(db, userId, 30, 6) : [],
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

  const byPct = (list: typeof movers) => ({
    up: list
      .filter((m) => m.pct > 0)
      .toSorted((a, b) => b.pct - a.pct)
      .slice(0, 3),
    down: list
      .filter((m) => m.pct < 0)
      .toSorted((a, b) => a.pct - b.pct)
      .slice(0, 3),
  });
  const moverRow = (m: (typeof movers)[number], byYen = false): Row => ({
    product: m.product,
    main: byYen ? signedJpy(m.changeJpy) : pct(m.pct),
    sub: byYen ? pct(m.pct) : signedJpy(m.changeJpy),
  });
  const twoLists = (
    up: Row[],
    down: Row[],
    labels: [string, string] = [t('portfolio.insights.up'), t('portfolio.insights.down')],
  ) =>
    up.length + down.length
      ? {
          columns: [
            { label: labels[0], rows: up },
            { label: labels[1], rows: down },
          ],
        }
      : null;

  const pctMovers = byPct(movers);
  const sealed = byPct(movers.filter((m) => productClass(m.product) === 'sealed'));
  const withPl = investments.filter((s) => s.unrealizedJpy !== null && s.unrealizedJpy !== 0);
  const plRow = (s: (typeof investments)[number]): Row => ({
    product: s.product,
    main: signedJpy(s.unrealizedJpy!),
    sub:
      s.valuedCostJpy > 0
        ? pct(Math.round((s.unrealizedJpy! / s.valuedCostJpy) * 1000) / 10)
        : undefined,
  });

  const content: Record<SummaryPanel, { columns: { label?: string; rows: Row[] }[] } | null> = {
    movers_pct: twoLists(
      pctMovers.up.map((m) => moverRow(m)),
      pctMovers.down.map((m) => moverRow(m)),
    ),
    movers_jpy: twoLists(
      movers
        .filter((m) => m.changeJpy > 0)
        .toSorted((a, b) => b.changeJpy - a.changeJpy)
        .slice(0, 3)
        .map((m) => moverRow(m, true)),
      movers
        .filter((m) => m.changeJpy < 0)
        .toSorted((a, b) => a.changeJpy - b.changeJpy)
        .slice(0, 3)
        .map((m) => moverRow(m, true)),
    ),
    movers_sealed: twoLists(
      sealed.up.map((m) => moverRow(m)),
      sealed.down.map((m) => moverRow(m)),
    ),
    most_traded: traded.length
      ? {
          columns: [
            {
              rows: traded.map((r) => ({
                product: r.product,
                main: t('portfolio.insights.sales', { count: r.sales }),
              })),
            },
          ],
        }
      : null,
    gains: twoLists(
      withPl
        .filter((s) => s.unrealizedJpy! > 0)
        .toSorted((a, b) => b.unrealizedJpy! - a.unrealizedJpy!)
        .slice(0, 3)
        .map(plRow),
      withPl
        .filter((s) => s.unrealizedJpy! < 0)
        .toSorted((a, b) => a.unrealizedJpy! - b.unrealizedJpy!)
        .slice(0, 3)
        .map(plRow),
      [t('portfolio.insights.gainsUp'), t('portfolio.insights.gainsDown')],
    ),
    most_valuable: items.some((s) => s.valueJpy > 0)
      ? {
          columns: [
            {
              rows: items
                .filter((s) => s.valueJpy > 0)
                .toSorted((a, b) => b.valueJpy - a.valueJpy)
                .slice(0, 6)
                .map((s) => ({
                  product: s.product,
                  main: formatJpy(s.valueJpy),
                  sub: t('portfolio.units', { count: s.units }),
                })),
            },
          ],
        }
      : null,
  };

  const shown = prefs.panels.filter((id) => content[id]);
  const images = await imageVersions(db, [
    ...new Set(
      shown.flatMap((id) => content[id]!.columns.flatMap((c) => c.rows.map((r) => r.product.id))),
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
  const panels: InsightPanel[] = shown.map((id) => {
    const { columns } = content[id]!;
    const filled = columns.filter((c) => c.rows.length > 0);
    // One list splits into two columns on wide screens, like the rising / falling pairs.
    const parts =
      filled.length === 1 && !filled[0]!.label
        ? [filled[0]!.rows.slice(0, 3), filled[0]!.rows.slice(3)]
            .filter((r) => r.length)
            .map((rows) => ({ rows, label: undefined }))
        : filled;
    return {
      id,
      title: t(`portfolio.insights.title.${id}`),
      body: (
        <div className="grid gap-4 md:grid-cols-2">
          {parts.map((c, i) => (
            <div key={i} className="space-y-2">
              {c.label && <h3 className="text-xs font-medium text-muted-foreground">{c.label}</h3>}
              {list(c.rows)}
            </div>
          ))}
        </div>
      ),
    };
  });
  return <InsightsCard panels={panels} rotate={prefs.rotate} seconds={prefs.seconds} />;
}
