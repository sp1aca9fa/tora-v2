import {
  canEditProduct,
  getProduct,
  holdingBucket,
  imageVersions,
  loadMarketData,
  priceHistory,
  productLots,
  valueHolding,
} from '@tora/db';
import { ChevronRight, Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { PriceChart } from '@/components/charts/price-chart';
import { ProductImage } from '@/components/product-image';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { authed } from '@/lib/auth/guard';
import { lotConditionLabel, productMeta, sourceLabel } from '@/lib/product-display';
import { formatJpy } from '@/lib/utils';
import { PriceSources } from './price-sources';

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { db } = await authed();
  const product = await getProduct(db, (await params).id);
  return product ? { title: product.name } : {};
}

/** One product: what it is worth, every lot of it the user registered, and its market data. */
export default async function ProductPage({ params }: Params) {
  const { id } = await params;
  const { db, user } = await authed();
  const [product, lots] = await Promise.all([getProduct(db, id), productLots(db, user.id, id)]);
  if (!product || lots.length === 0) notFound();
  const [t, format, market, history, images] = await Promise.all([
    getTranslations(),
    getFormatter(),
    loadMarketData(db, user.id, [product.id]),
    priceHistory(db, product.id, 365),
    imageVersions(db, [product.id]),
  ]);

  const owned = lots.filter((h) => h.status === 'owned');
  const values = new Map(owned.map((h) => [h.id, valueHolding(h, product, market).valueJpy]));
  const units = owned.reduce((n, h) => n + h.quantity, 0);
  // Opened items keep their cost (their value moved to the pulls logged from them).
  const openedCost = lots
    .filter((h) => h.status === 'consumed')
    .reduce((n, h) => n + h.costTotalJpy, 0);
  const spent = owned.reduce((n, h) => n + h.costTotalJpy, 0) + openedCost;
  const valued = owned.filter((h) => values.get(h.id) != null);
  const value = valued.reduce((n, h) => n + values.get(h.id)!, 0);
  const valuedCost = valued.reduce((n, h) => n + h.costTotalJpy, 0) + openedCost;
  const pl = valued.length || openedCost ? value - valuedCost : null;
  // The chart starts on the condition most of the owned units are in.
  const unitsByBucket = new Map<string, number>();
  for (const h of owned) {
    const b = holdingBucket(h, product);
    if (b) unitsByBucket.set(b, (unitsByBucket.get(b) ?? 0) + h.quantity);
  }
  const mainBucket = [...unitsByBucket].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'medium' });
  const signed = (n: number) => `${n > 0 ? '▲ +' : n < 0 ? '▼ ' : ''}${formatJpy(n)}`;

  return (
    <div className="space-y-5">
      <header className="flex gap-4">
        <ProductImage product={product} version={images.get(product.id)} className="size-24" />
        <div className="min-w-0 space-y-1">
          <p className="text-sm text-muted-foreground">
            <Link href="/" className="hover:underline">
              {t('nav.portfolio')}
            </Link>
          </p>
          <h1 className="text-xl leading-tight font-semibold tracking-tight">{product.name}</h1>
          <p className="text-sm text-muted-foreground">
            {productMeta(product, t)}
            {product.releaseDate && ` · ${t('add.released', { date: product.releaseDate })}`}
            {canEditProduct(user, product) && (
              <>
                {' · '}
                <Link
                  href={`/products/${product.id}/edit?from=/products/${product.id}`}
                  className="underline"
                >
                  {t('holding.editProduct')}
                </Link>
              </>
            )}
          </p>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          [t('product.unitsOwned'), String(units)],
          [t('portfolio.spent'), formatJpy(spent)],
          [t('portfolio.marketValue'), valued.length || openedCost ? formatJpy(value) : '-'],
          [t('portfolio.unrealized'), pl === null ? '-' : signed(pl)],
        ].map(([label, v]) => (
          <div key={label} className="rounded-xl border bg-card px-4 py-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-lg font-semibold tabular-nums">{v}</p>
          </div>
        ))}
      </section>
      {valued.length > 0 && valued.length < owned.length && (
        <p className="text-xs text-muted-foreground">
          {t('portfolio.lotsValued', { valued: valued.length, total: owned.length })}
        </p>
      )}

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">{t('product.lots')}</h2>
          <Button asChild variant="outline" size="sm">
            <Link href={`/add?product=${product.id}`}>
              <Plus /> {t('holding.addMore')}
            </Link>
          </Button>
        </div>
        <ul className="divide-y rounded-xl border bg-card">
          {lots.map((h) => {
            const v = values.get(h.id);
            const info = [
              date(h.acquiredAt),
              h.acquiredFrom,
              h.orderId && `#${h.orderId}`,
              h.quantity > 1 && t('portfolio.qty', { qty: h.quantity }),
            ].filter(Boolean);
            return (
              <li key={h.id}>
                <Link
                  href={`/holdings/${h.id}`}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/50"
                >
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="text-sm font-medium">
                      {lotConditionLabel(h, product, t) ?? t(`kind.${product.kind}`)}
                      {h.status !== 'owned' && (
                        <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs font-normal">
                          {t(`status.${h.status}`)}
                        </span>
                      )}
                      {h.reviewPending && (
                        <span className="ml-2 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-normal text-amber-700 dark:text-amber-400">
                          {t('product.toReview')}
                        </span>
                      )}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{info.join(' · ')}</p>
                  </div>
                  <div className="shrink-0 text-right text-sm tabular-nums">
                    <p className={v != null ? 'font-medium' : undefined}>
                      {v != null ? formatJpy(v) : formatJpy(h.costTotalJpy)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {v != null
                        ? `${t('portfolio.spentShort', { amount: formatJpy(h.costTotalJpy) })} · ${signed(v - h.costTotalJpy)}`
                        : h.status === 'owned'
                          ? t('valuation.short.none')
                          : t('product.cost')}
                    </p>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>{t('valuation.history')}</CardTitle>
        </CardHeader>
        <CardContent>
          <PriceChart
            points={history}
            defaultBucket={mainBucket}
            sourceLabels={Object.fromEntries(history.map((p) => [p.source, sourceLabel(p.source)]))}
          />
        </CardContent>
      </Card>

      <PriceSources db={db} product={product} bucket={mainBucket} />
    </div>
  );
}
