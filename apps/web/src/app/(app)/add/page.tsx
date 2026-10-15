import {
  acquiredFromSuggestions,
  getImportRun,
  getProduct,
  getPurchaseLink,
  productValueSuggestions,
} from '@tora/db';
import { tokyoDate } from '@tora/core';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { getRegistry, sourceLabels } from '@/lib/sources';
import { authed } from '@/lib/auth/guard';
import { AddFlow } from './add-flow';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('add'))('title') };
}

/** `?product=<id>` starts from an existing product (e.g. "add another" on a holding). */
export default async function AddPage({
  searchParams,
}: {
  searchParams: Promise<{ product?: string; link?: string }>;
}) {
  const sourceLabel = await sourceLabels();
  // Shops and price sources the plug-ins describe, as suggestions for "bought at".
  const registryShops = (await getRegistry()).sources
    .filter((s) => s.shopOnly || s.aliases?.length)
    .map((s) => s.label);
  const { db, user } = await authed();
  const { product: productId, link: linkId } = await searchParams;
  // `?link=<id>`: a purchase link that could not be imported, added by hand.
  const link = linkId ? await getPurchaseLink(db, user.id, linkId) : null;
  const run = link?.importRunId ? await getImportRun(db, user.id, link.importRunId) : null;
  const fromLink = link && {
    id: link.id,
    url: link.url,
    acquiredFrom: run?.source ? sourceLabel(run.source) : null,
    // The shop's item ID is the last part of the link (e.g. Mercari's m123…).
    orderId: new URL(link.url).pathname.split('/').filter(Boolean).pop() ?? null,
  };
  const [t, locale, fromHistory, franchises, product] = await Promise.all([
    getTranslations('add'),
    getLocale(),
    acquiredFromSuggestions(db, user.id),
    productValueSuggestions(db, 'franchise', 'game'),
    productId ? getProduct(db, productId) : null,
  ]);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <Link
          href="/imports#links"
          className="text-sm text-muted-foreground underline hover:text-foreground"
        >
          {t('fromLinks')}
        </Link>
      </header>
      <AddFlow
        today={tokyoDate()}
        fromSuggestions={[...new Set([...fromHistory, ...registryShops])].sort((a, b) =>
          a.localeCompare(b, locale),
        )}
        franchiseSuggestions={[...franchises].sort((a, b) => a.localeCompare(b, locale))}
        fromLink={fromLink}
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
            linked: false,
          }
        }
      />
    </div>
  );
}
