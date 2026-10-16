import { getProduct, linkedProductIds, productValueSuggestions } from '@tora/db';
import { localDate } from '@tora/core';
import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { authed } from '@/lib/auth/guard';
import { AddFlow } from '../../add/add-flow';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('watchlist'))('add') };
}

/** Watch an item (S9): pick or add it as for a lot, then its condition and target price. */
export default async function WatchAddPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string }>;
}) {
  const { db } = await authed();
  const { product: productId } = await searchParams;
  const [t, locale, franchises, product] = await Promise.all([
    getTranslations(),
    getLocale(),
    productValueSuggestions(db, 'franchise', 'game'),
    productId ? getProduct(db, productId) : null,
  ]);
  const linked = product ? await linkedProductIds(db, [product.id]) : new Set<string>();
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('watchlist.add')}</h1>
        <p className="text-sm text-muted-foreground">{t('watchlist.addIntro')}</p>
      </header>
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
    </div>
  );
}
