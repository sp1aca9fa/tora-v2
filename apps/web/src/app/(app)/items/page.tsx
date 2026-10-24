import {
  type Category,
  HOLDING_STATUSES,
  type HoldingStatus,
  type ProductKind,
  TRACKING_MODES,
  type Taxonomy,
  categoryDef,
  trackingMode,
} from '@tora/core';
import {
  cardGradeCounts,
  imageVersions,
  listInventory,
  portfolioValuation,
  summarizeByProduct,
} from '@tora/db';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { Button } from '@/components/ui/button';
import { userActions } from '@/lib/actions';
import { authed } from '@/lib/auth/guard';
import { cn } from '@/lib/utils';
import { PortfolioHeader } from '../_portfolio/header';
import { itemCardData } from './card-data';
import { ItemList } from './item-list';
import { ItemFilters } from './item-filters';
import { getMoney } from '@/lib/money-server';
import { getTaxonomy } from '@/lib/taxonomy';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('portfolio'))('title') };
}

type SearchParams = Promise<{ q?: string; type?: string; status?: string }>;

/** `type` is a category (`tcg`) or category:kind (`tcg:booster_box`). */
function parseType(
  taxonomy: Taxonomy,
  type: string | undefined,
): { category?: Category; kind?: ProductKind } {
  const [c, k] = (type ?? '').split(':');
  const def = categoryDef(taxonomy, c ?? '');
  if (!def) return {};
  return def.kinds.some((d) => d.key === k)
    ? { category: def.key, kind: k }
    : { category: def.key };
}

/** Kinds of a category, in the admin's order. */
const kindsOf = (taxonomy: Taxonomy, category: string) =>
  categoryDef(taxonomy, category)?.kinds.map((k) => k.key) ?? [];

/**
 * Portfolio, Items tab (requirements S8): category and kind chips filter in one tap; the items
 * are grouped by kind under slim sticky headers. Row cards on phones, vertical cards from 768 px.
 */
export default async function ItemsPage({ searchParams }: { searchParams: SearchParams }) {
  const money = await getMoney();
  const { db, user } = await authed();
  const [sp, taxonomy] = await Promise.all([searchParams, getTaxonomy()]);
  const categories = taxonomy.categories.map((c) => c.key);
  const { category, kind } = parseType(taxonomy, sp.type);
  const status =
    sp.status === 'all' || HOLDING_STATUSES.includes(sp.status as HoldingStatus)
      ? (sp.status as HoldingStatus | 'all')
      : 'owned';
  const q = sp.q?.trim().slice(0, 100) || undefined;

  // Owned lots without a search are the valued ones: read once (S14), newest first as listed.
  const plain = status === 'owned' && !q;
  const [listed, portfolio, actions, grades, t] = await Promise.all([
    plain ? null : listInventory(db, user.id, { status, q }),
    portfolioValuation(db, user.id),
    userActions(),
    cardGradeCounts(db, user.id),
    getTranslations(),
  ]);
  const rows =
    listed ??
    portfolio.rows.toSorted(
      (a, b) =>
        b.holding.acquiredAt.localeCompare(a.holding.acquiredAt) ||
        b.holding.createdAt.localeCompare(a.holding.createdAt) ||
        a.holding.id.localeCompare(b.holding.id),
    );
  const valuations = new Map(portfolio.rows.map((r) => [r.holding.id, r.valuation]));
  // Everything the search and status match: the chips count it; the list shows the type picked.
  // Lots are summed per item within their tracking group (S8): investments, value only, ...
  const all = TRACKING_MODES.flatMap((mode) =>
    summarizeByProduct(
      rows.filter((r) => trackingMode(r.holding) === mode),
      valuations,
    ).map((s) => ({ ...s, mode })),
  );
  const shown = all.filter(
    (s) => (!category || s.product.category === category) && (!kind || s.product.kind === kind),
  );
  const images = await imageVersions(db, [...new Set(shown.map((s) => s.product.id))]);

  // Items (an item split across groups counts once) and the value of what counts in value.
  const stats = (list: typeof all) => ({
    count: new Set(list.map((s) => s.product.id)).size,
    valueBase: list
      .filter((s) => s.mode === 'investment' || s.mode === 'value_only')
      .reduce((n, s) => n + s.valueBase, 0),
  });
  const href = (type: string | null) => {
    const next = new URLSearchParams();
    if (sp.q) next.set('q', sp.q);
    if (sp.status) next.set('status', sp.status);
    if (type) next.set('type', type);
    const query = next.toString();
    return query ? `/items?${query}` : '/items';
  };
  const chip = (active: boolean) =>
    cn(
      'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors',
      active
        ? 'border-primary bg-primary text-primary-foreground'
        : 'text-muted-foreground hover:text-foreground',
    );
  const total = (n: number) => <span className="tabular-nums opacity-80">{money(n)}</span>;

  // Tracking groups (investments first), then kinds in the catalog's order (category, kind).
  const modes = TRACKING_MODES.filter((m) => shown.some((s) => s.mode === m)).map((mode) => {
    const groups: { key: string; label: string; list: typeof shown }[] = [];
    for (const c of categories) {
      for (const k of kindsOf(taxonomy, c)) {
        const list = shown.filter(
          (s) => s.mode === mode && s.product.category === c && s.product.kind === k,
        );
        if (list.length === 0) continue;
        const label = k === 'other' ? `${t(`category.${c}`)} · ${t(`kind.${k}`)}` : t(`kind.${k}`);
        groups.push({ key: `${mode}:${c}:${k}`, label, list });
      }
    }
    return { mode, groups };
  });
  // A heading per tracking group only when there is more than investments.
  const headed = modes.some((m) => m.mode !== 'investment');
  const filtered = Boolean(category || q || status !== 'owned');

  return (
    <div className="space-y-4">
      <PortfolioHeader totals={portfolio.totals} actions={actions} tab="items" />

      <div className="space-y-2">
        <Suspense>
          <ItemFilters />
        </Suspense>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
          <Link href={href(null)} className={chip(!category)}>
            {t('actions.all')} {stats(all).count} {total(stats(all).valueBase)}
          </Link>
          {categories.map((c) => {
            const list = all.filter((s) => s.product.category === c);
            if (list.length === 0) return null;
            const st = stats(list);
            return (
              <Link key={c} href={href(c)} className={chip(category === c && !kind)}>
                {t(`category.${c}`)} {st.count} {total(st.valueBase)}
              </Link>
            );
          })}
        </div>
        {category && (
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
            {kindsOf(taxonomy, category).map((k) => {
              const n = all.filter(
                (s) => s.product.category === category && s.product.kind === k,
              ).length;
              if (n === 0) return null;
              return (
                <Link
                  key={k}
                  href={href(kind === k ? category : `${category}:${k}`)}
                  className={cn(chip(kind === k), 'py-0.5 text-xs')}
                >
                  {t(`kind.${k}`)} {n}
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {shown.length === 0 ? (
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
        <ItemList
          modes={modes.map(({ mode, groups }) => ({
            mode,
            title: headed ? t(`tracking.group.${mode}`) : null,
            hint: headed ? t(`tracking.hint.${mode}`) : null,
            groups: groups.map((g) => {
              const st = stats(g.list);
              return {
                key: g.key,
                label: g.label,
                stats: t('portfolio.itemCount', { count: st.count }),
                value: mode === 'investment' || mode === 'value_only' ? money(st.valueBase) : null,
                cards: g.list.map((s) => itemCardData(s, mode, images.get(s.product.id), money, t)),
              };
            }),
          }))}
        />
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
