import { getProduct, imageVersions, productLines, releaseDates } from '@tora/db';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { ProductImage } from '@/components/product-image';
import { authed } from '@/lib/auth/guard';
import { getMoney } from '@/lib/money-server';
import { lineLabel } from '@/lib/product-display';
import { ItemNav } from '../item-nav';
import { loadItem, loadSignal, loadValues } from '../item-data';

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { db } = await authed();
  const product = await getProduct(db, (await params).id);
  return product ? { title: product.name } : {};
}

/**
 * The item's header on every sub page (S22): picture, name, line and release, and what the
 * person's lots are worth (or, watched only, the market value); then the sub pages.
 */
export default async function ItemLayout({ params, children }: Params & { children: ReactNode }) {
  const { id } = await params;
  const { db, product, lots } = await loadItem(id);
  const [t, money, images, lines, released, totals, stats] = await Promise.all([
    getTranslations(),
    getMoney(),
    imageVersions(db, [product.id]),
    productLines(db, [product]),
    releaseDates(db, [product]),
    lots.length ? loadValues(id) : null,
    lots.length ? null : loadSignal(id),
  ]);
  const line = lines.get(product.id);
  const release = released.get(product.id);
  const signed = (n: number) => `${n > 0 ? '▲ +' : n < 0 ? '▼ ' : ''}${money(n)}`;
  const numbers: [string, string][] = totals
    ? [
        [t('product.unitsOwned'), String(totals.units)],
        [t('portfolio.marketValue'), totals.value === null ? '-' : money(totals.value)],
        [t('portfolio.unrealized'), totals.pl === null ? '-' : signed(totals.pl)],
      ]
    : [[t('portfolio.marketValue'), stats?.fair != null ? money(stats.fair) : '-']];
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-1 basis-80 gap-4">
          <ProductImage
            product={product}
            version={images.get(product.id)}
            className="size-20 shrink-0 sm:size-24"
          />
          <div className="min-w-0 space-y-1">
            <p className="text-sm text-muted-foreground">
              <Link href={lots.length ? '/' : '/watchlist'} className="hover:underline">
                {t(lots.length ? 'nav.portfolio' : 'nav.watchlist')}
              </Link>
            </p>
            <h1 className="text-xl leading-tight font-semibold tracking-tight">{product.name}</h1>
            {product.nameAlias && product.nameAlias !== product.name && (
              <p className="text-sm">{product.nameAlias}</p>
            )}
            {(line || release) && (
              <p className="text-sm text-muted-foreground">
                {[
                  line && lineLabel(line, t),
                  release && t(`release.${release.from}`, { date: release.date }),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            )}
          </div>
        </div>
        <dl className="flex flex-wrap gap-2">
          {numbers.map(([label, v]) => (
            <div key={label} className="rounded-xl border bg-card px-3 py-2">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="font-semibold tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
      </header>
      <ItemNav productId={product.id} opening={product.kind === 'booster_box'} />
      {children}
    </div>
  );
}
