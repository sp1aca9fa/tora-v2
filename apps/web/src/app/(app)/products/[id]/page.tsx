import {
  canEditProduct,
  currentSupply,
  listingsIn,
  lowestAsk,
  dismissedSourceWarnings,
  foreignPrices,
  getProduct,
  holdingBucket,
  bucketValueKey,
  imageVersions,
  priceHistory,
  productLots,
  savedBucketValues,
  valueHoldings,
  watchesOf,
} from '@tora/db';
import { productClass, trackingMode } from '@tora/core';
import { ChevronRight, Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import { PriceChart } from '@/components/charts/price-chart';
import { ProductImage } from '@/components/product-image';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { sourceLabels } from '@/lib/sources';
import { authed } from '@/lib/auth/guard';
import { lotConditionLabel, productMeta, customFieldLines } from '@/lib/product-display';
import { ItemLayout } from './item-layout';
import { MarketCompare, compareBucket } from './market-compare';
import { PriceSources } from './price-sources';
import { ForSale } from './for-sale';
import { WatchCard } from './watch-card';
import { getMoney } from '@/lib/money-server';
import { getTaxonomy } from '@/lib/taxonomy';

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { db } = await authed();
  const product = await getProduct(db, (await params).id);
  return product ? { title: product.name } : {};
}

/**
 * One product: what it is worth, every lot of it the user registered, the user's watches of it
 * (S9), and its market data. Shown to people who hold or watch it.
 */
export default async function ProductPage({ params }: Params) {
  const money = await getMoney();
  const sourceLabel = await sourceLabels();
  const { id } = await params;
  const { db, user } = await authed();
  const [product, lots, watches] = await Promise.all([
    getProduct(db, id),
    productLots(db, user.id, id),
    watchesOf(db, user.id, id),
  ]);
  if (!product || (lots.length === 0 && watches.length === 0)) notFound();
  const owned = lots.filter((h) => h.status === 'owned');
  // The chart starts on the condition most of the owned units are in.
  const unitsByBucket = new Map<string, number>();
  for (const h of owned) {
    const b = holdingBucket(h, product);
    if (b) unitsByBucket.set(b, (unitsByBucket.get(b) ?? 0) + h.quantity);
  }
  // Not owned: the condition first watched.
  const mainBucket =
    [...unitsByBucket].sort((a, b) => b[1] - a[1])[0]?.[0] ?? (watches[0]?.bucket || null);
  const compare = await compareBucket(product, mainBucket);
  const [t, format, valuations, japan, history, images, foreign, dismissed, supply] =
    await Promise.all([
      getTranslations(),
      getFormatter(),
      valueHoldings(
        db,
        user.id,
        owned.map((holding) => ({ holding, product })),
      ),
      compare ? savedBucketValues(db, [{ product, bucket: compare.bucket }]) : null,
      priceHistory(db, product.id, 365),
      imageVersions(db, [product.id]),
      foreignPrices(db, product.id),
      dismissedSourceWarnings(db, user.id),
      currentSupply(db, [product.id]),
    ]);
  const forSale = supply.get(product.id) ?? [];
  const values = new Map(owned.map((h) => [h.id, valuations.get(h.id)?.valueBase ?? null]));
  const units = owned.reduce((n, h) => n + h.quantity, 0);
  // By each lot's tracking switches (S8): spent counts lots counted in cost, value those counted
  // in value, P/L those counted in both. Opened items keep their cost (their value moved to the
  // pulls logged from them).
  const opened = lots.filter((h) => h.status === 'consumed' && h.countInCost);
  const openedCost = opened.reduce((n, h) => n + h.costTotalBase, 0);
  const spent =
    owned.filter((h) => h.countInCost).reduce((n, h) => n + h.costTotalBase, 0) + openedCost;
  const valued = owned.filter((h) => h.countInValue && values.get(h.id) != null);
  const value = valued.reduce((n, h) => n + values.get(h.id)!, 0);
  const inPl = valued.filter((h) => h.countInCost);
  const openedInPl = opened.filter((h) => h.countInValue).reduce((n, h) => n + h.costTotalBase, 0);
  const pl =
    inPl.length || openedInPl
      ? inPl.reduce((n, h) => n + values.get(h.id)! - h.costTotalBase, 0) - openedInPl
      : null;
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'medium' });
  const signed = (n: number) => `${n > 0 ? '▲ +' : n < 0 ? '▼ ' : ''}${money(n)}`;

  const watchCard = (
    <WatchCard
      productId={product.id}
      cls={productClass(product)}
      retail={product.retailPriceBase}
      watches={watches.map((w) => ({
        id: w.id,
        label: lotConditionLabel(w, product, t),
        target: w.targetPriceBase,
        note: w.note,
        defaults: w,
        ask: (() => {
          const best = lowestAsk(forSale, w.bucket);
          return (
            best && {
              price: best.lowestAskBase!,
              source: sourceLabel(best.source),
              url: best.url,
              listings: listingsIn(forSale, w.bucket),
            }
          );
        })(),
      }))}
    />
  );
  return (
    <ItemLayout
      header={
        <header className="flex gap-4 lg:flex-col">
          <ProductImage
            product={product}
            version={images.get(product.id)}
            className="size-24 lg:size-auto lg:aspect-square lg:w-full lg:max-w-72"
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
            <p className="text-sm text-muted-foreground">
              {productMeta(product, t)}
              {customFieldLines(product, await getTaxonomy(), await getLocale(), t)
                .map((l) => ` · ${l.label}: ${l.value}`)
                .join('')}
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
      }
      overview={
        <>
          {lots.length === 0 && (
            <>
              {watchCard}
              {/* Watched, not owned: bought it, register the lot. */}
              <Button asChild variant="outline" size="sm" className="self-start">
                <Link href={`/add?product=${product.id}`}>
                  <Plus /> {t('watchlist.bought')}
                </Link>
              </Button>
            </>
          )}
          {lots.length > 0 && (
            <>
              <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2">
                {[
                  [t('product.unitsOwned'), String(units)],
                  [t('portfolio.spent'), money(spent)],
                  [t('portfolio.marketValue'), valued.length || openedCost ? money(value) : '-'],
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
                              {trackingMode(h) !== 'investment' && (
                                <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs font-normal">
                                  {t(`tracking.short.${trackingMode(h)}`)}
                                </span>
                              )}
                              {h.reviewPending && (
                                <span className="ml-2 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-normal text-amber-700 dark:text-amber-400">
                                  {t('product.toReview')}
                                </span>
                              )}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {info.join(' · ')}
                            </p>
                          </div>
                          <div className="shrink-0 text-right text-sm tabular-nums">
                            <p className={v != null ? 'font-medium' : undefined}>
                              {v != null ? money(v) : money(h.costTotalBase)}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {v != null
                                ? `${t('portfolio.spentShort', { amount: money(h.costTotalBase) })} · ${signed(v - h.costTotalBase)}`
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
              {watchCard}
            </>
          )}
        </>
      }
      market={
        <>
          <Card>
            <CardHeader>
              <CardTitle>{t('valuation.history')}</CardTitle>
            </CardHeader>
            <CardContent>
              <PriceChart
                points={history}
                defaultBucket={mainBucket}
                sourceLabels={Object.fromEntries(
                  history.map((p) => [p.source, sourceLabel(p.source)]),
                )}
              />
            </CardContent>
          </Card>

          {compare && (
            <MarketCompare
              compare={compare}
              japan={japan?.get(bucketValueKey(product.id, compare.bucket))?.valuation ?? null}
              product={product}
              mainBucket={mainBucket}
              foreign={foreign}
            />
          )}
          <ForSale rows={forSale} mainBucket={mainBucket} />
        </>
      }
      sources={
        <PriceSources
          db={db}
          product={product}
          bucket={mainBucket}
          ownedCostBase={owned.reduce((n, h) => n + h.costTotalBase, 0)}
          warningDismissed={dismissed.has(product.id)}
        />
      }
    />
  );
}
