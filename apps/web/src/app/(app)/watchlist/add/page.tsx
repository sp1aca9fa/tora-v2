import {
  getProduct,
  linkedProductIds,
  listConsoles,
  productValueSuggestions,
  BULK_MAX,
} from '@tora/db';
import { localDate, pickName } from '@tora/core';
import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { Tabs } from '@/components/ui/tabs';
import { authed } from '@/lib/auth/guard';
import { AddFlow } from '../../add/add-flow';
import { BulkForm } from './bulk-form';
import { GameForm } from './game-form';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('watchlist'))('add') };
}

/**
 * Add to the wishlist (S9, S36 B1): any item, picked or added as for a lot, then its condition and
 * target; a new game with its console's rules; or several games pasted at once.
 */
export default async function WatchAddPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string; tab?: string }>;
}) {
  const { db } = await authed();
  const { product: productId, tab } = await searchParams;
  const [t, locale, franchises, product, consoles] = await Promise.all([
    getTranslations(),
    getLocale(),
    productValueSuggestions(db, 'franchise', 'game'),
    productId ? getProduct(db, productId) : null,
    listConsoles(db),
  ]);
  const linked = product ? await linkedProductIds(db, [product.id]) : new Set<string>();
  const choices = consoles.map((c) => ({
    key: c.key,
    name: pickName(c.names, locale, c.key),
    boxedAllowed: c.boxedAllowed,
  }));
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('watchlist.add')}</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">{t('watchlist.addIntro')}</p>
      </header>
      <Tabs
        param="tab"
        initial={product ? 'item' : tab === 'game' || tab === 'bulk' ? tab : 'item'}
        tabs={[
          {
            key: 'item',
            label: t('wish.tabItem'),
            content: (
              <AddFlow
                watch
                today={localDate()}
                fromSuggestions={[]}
                franchiseSuggestions={[...franchises].sort((a, b) => a.localeCompare(b, locale))}
                initialProduct={
                  product && {
                    id: product.id,
                    category: product.category,
                    kind: product.kind,
                    name: product.name,
                    region: product.region,
                    setName: product.setName,
                    setCode: product.setCode,
                    cardNumber: product.cardNumber,
                    rarity: product.rarity,
                    platform: product.platform,
                    releaseDate: product.releaseDate,
                    retailPriceBase: product.retailPriceBase,
                    linked: linked.has(product.id),
                  }
                }
              />
            ),
          },
          { key: 'game', label: t('wish.tabGame'), content: <GameForm consoles={choices} /> },
          { key: 'bulk', label: t('wish.tabBulk'), content: <BulkForm max={BULK_MAX} /> },
        ]}
      />
    </div>
  );
}
