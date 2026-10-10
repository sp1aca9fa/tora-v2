import { acquiredFromSuggestions, getProduct, productValueSuggestions } from '@tora/db';
import { tokyoDate } from '@tora/core';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { authed } from '@/lib/auth/guard';
import { AddFlow } from './add-flow';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('add'))('title') };
}

const STORES = ['Yodobashi', 'Bic Camera', 'Amazon', 'Mercari', 'SNKRDUNK', 'Pokemon Center'];

/** `?product=<id>` starts from an existing product (e.g. "add another" on a holding). */
export default async function AddPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string }>;
}) {
  const { db, user } = await authed();
  const { product: productId } = await searchParams;
  const [t, fromHistory, franchises, product] = await Promise.all([
    getTranslations('add'),
    acquiredFromSuggestions(db, user.id),
    productValueSuggestions(db, 'franchise', 'game'),
    productId ? getProduct(db, productId) : null,
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
      <AddFlow
        today={tokyoDate()}
        fromSuggestions={[...new Set([...fromHistory, ...STORES])]}
        franchiseSuggestions={franchises}
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
            linked: false,
          }
        }
      />
    </div>
  );
}
