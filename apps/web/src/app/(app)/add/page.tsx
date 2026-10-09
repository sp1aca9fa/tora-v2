import { tokyoDate } from '@tora/core';
import { acquiredFromSuggestions, getProduct } from '@tora/db';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { authedDb } from '@/lib/auth/guard';
import { AddFlow } from './add-flow';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('add'))('title') };
}

/** `?product=<id>` starts from an existing product (e.g. "add another" on a holding). */
export default async function AddPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string }>;
}) {
  const db = await authedDb();
  const { product: productId } = await searchParams;
  const [t, suggestions, product] = await Promise.all([
    getTranslations('add'),
    acquiredFromSuggestions(db),
    productId ? getProduct(db, productId) : null,
  ]);
  const defaults = ['Yodobashi', 'Bic Camera', 'Amazon', 'Mercari', 'SNKRDUNK', 'Pokemon Center'];
  const fromSuggestions = [...new Set([...suggestions, ...defaults])];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
      <AddFlow
        today={tokyoDate()}
        fromSuggestions={fromSuggestions}
        initialProduct={
          product
            ? {
                id: product.id,
                type: product.type,
                nameJa: product.nameJa,
                nameEn: product.nameEn,
                setName: product.setName,
                cardNumber: product.cardNumber,
              }
            : null
        }
      />
    </div>
  );
}
