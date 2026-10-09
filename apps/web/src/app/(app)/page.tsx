import {
  CATEGORIES,
  type Category,
  HOLDING_STATUSES,
  type HoldingStatus,
  type ProductKind,
  kindsFor,
  productClass,
} from '@tora/core';
import { listInventory, ownedTotals, pendingMatchesForUser } from '@tora/db';
import { ChevronRight, Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { Button } from '@/components/ui/button';
import { authed } from '@/lib/auth/guard';
import { franchiseLabel } from '@/lib/product-display';
import { formatJpy } from '@/lib/utils';
import { InventoryFilters } from './inventory-filters';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('portfolio'))('title') };
}

type SearchParams = Promise<{ q?: string; type?: string; status?: string }>;

/** `type` is a category (`tcg`) or category:kind (`tcg:booster_box`). */
function parseType(type: string | undefined): { category?: Category; kind?: ProductKind } {
  const [c, k] = (type ?? '').split(':');
  if (!CATEGORIES.includes(c as Category)) return {};
  const category = c as Category;
  return kindsFor(category).includes(k as ProductKind)
    ? { category, kind: k as ProductKind }
    : { category };
}

export default async function PortfolioPage({ searchParams }: { searchParams: SearchParams }) {
  const { db, user } = await authed();
  const sp = await searchParams;
  const { category, kind } = parseType(sp.type);
  const status =
    sp.status === 'all' || HOLDING_STATUSES.includes(sp.status as HoldingStatus)
      ? (sp.status as HoldingStatus | 'all')
      : 'owned';
  const q = sp.q?.trim().slice(0, 100) || undefined;

  const [rows, totals, matches, t] = await Promise.all([
    listInventory(db, user.id, { category, kind, status, q }),
    ownedTotals(db, user.id),
    pendingMatchesForUser(db, user.id),
    getTranslations(),
  ]);
  const filtered = Boolean(category || q || status !== 'owned');

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t('portfolio.title')}</h1>
        <Button asChild size="sm" className="hidden md:inline-flex">
          <Link href="/add">
            <Plus /> {t('nav.add')}
          </Link>
        </Button>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border bg-card px-4 py-3">
          <p className="text-xs text-muted-foreground">{t('portfolio.spent')}</p>
          <p className="text-xl font-semibold tabular-nums">{formatJpy(totals.spentJpy)}</p>
        </div>
        <div className="rounded-xl border bg-card px-4 py-3">
          <p className="text-xs text-muted-foreground">{t('portfolio.items')}</p>
          <p className="text-xl font-semibold tabular-nums">
            {t('portfolio.itemsValue', { units: totals.units, lots: totals.lots })}
          </p>
        </div>
        <div className="col-span-2 rounded-xl border border-dashed px-4 py-3 sm:col-span-1">
          <p className="text-xs text-muted-foreground">{t('portfolio.marketValue')}</p>
          <p className="text-sm text-muted-foreground">{t('portfolio.marketValueSoon')}</p>
        </div>
      </section>

      {matches.length > 0 && (
        <Link
          href="/matches"
          className="flex items-center justify-between rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm"
        >
          <span>{t('sources.banner', { count: matches.length })}</span>
          <ChevronRight className="size-4" />
        </Link>
      )}

      <Suspense>
        <InventoryFilters />
      </Suspense>

      {rows.length === 0 ? (
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
        <ul className="divide-y rounded-xl border bg-card">
          {rows.map(({ holding, product, parentProduct }) => {
            const details = [
              t(`kind.${product.kind}`),
              franchiseLabel(product.franchise, t),
              product.region && product.region !== 'jp' && t(`region.${product.region}`),
              holding.condition && t(`condition.${holding.condition}`),
              productClass(product) === 'sealed' &&
                holding.packagingState &&
                t(`packaging.${holding.packagingState}`),
              holding.grading === 'raw' && holding.rawGrade && `Raw ${holding.rawGrade}`,
              holding.grading === 'graded' && `${holding.grader} ${holding.grade}`,
            ].filter(Boolean);

            return (
              <li key={holding.id}>
                <Link
                  href={`/holdings/${holding.id}`}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/50"
                >
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="truncate font-medium">{product.name}</p>
                    <p className="truncate text-sm text-muted-foreground">{details.join(' · ')}</p>
                    {parentProduct?.name && (
                      <p className="truncate text-xs text-muted-foreground">
                        {t('portfolio.pulledFrom', { name: parentProduct.name })}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 text-right text-sm">
                    <p className="tabular-nums">{formatJpy(holding.costTotalJpy)}</p>
                    <p className="text-muted-foreground">
                      {holding.status !== 'owned'
                        ? t(`status.${holding.status}`)
                        : t('portfolio.qty', { qty: holding.quantity })}
                    </p>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
