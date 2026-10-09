import {
  HOLDING_STATUSES,
  type HoldingStatus,
  type Locale,
  PRODUCT_TYPES,
  type ProductType,
  displayName,
} from '@tora/core';
import { listInventory } from '@tora/db';
import { ChevronRight, Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { Button } from '@/components/ui/button';
import { authedDb } from '@/lib/auth/guard';
import { formatJpy } from '@/lib/utils';
import { InventoryFilters } from './inventory-filters';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('portfolio'))('title') };
}

type SearchParams = Promise<{ q?: string; type?: string; status?: string }>;

export default async function PortfolioPage({ searchParams }: { searchParams: SearchParams }) {
  const db = await authedDb();
  const sp = await searchParams;
  const type = PRODUCT_TYPES.includes(sp.type as ProductType)
    ? (sp.type as ProductType)
    : undefined;
  const status =
    sp.status === 'all' || HOLDING_STATUSES.includes(sp.status as HoldingStatus)
      ? (sp.status as HoldingStatus | 'all')
      : 'owned';
  const q = sp.q?.trim().slice(0, 100) || undefined;

  const [rows, t, locale] = await Promise.all([
    listInventory(db, { type, status, q }),
    getTranslations(),
    getLocale() as Promise<Locale>,
  ]);
  const filtered = Boolean(type || q || status !== 'owned');

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('portfolio.title')}</h1>
          <p className="text-sm text-muted-foreground">
            {t('portfolio.count', { count: rows.length })}
          </p>
        </div>
        <Button asChild size="sm" className="hidden md:inline-flex">
          <Link href="/add">
            <Plus /> {t('nav.add')}
          </Link>
        </Button>
      </header>

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
              t(`productType.${product.type}`),
              holding.condition && t(`condition.${holding.condition}`),
              product.type === 'sealed_tcg' &&
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
                    <p className="truncate font-medium">{displayName(product, locale)}</p>
                    <p className="truncate text-sm text-muted-foreground">{details.join(' · ')}</p>
                    {parentProduct?.nameEn || parentProduct?.nameJa ? (
                      <p className="truncate text-xs text-muted-foreground">
                        {t('portfolio.pulledFrom', { name: displayName(parentProduct, locale) })}
                      </p>
                    ) : null}
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
