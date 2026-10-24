import { bucketValueKey, foreignPrices, priceHistory, savedBucketValues } from '@tora/db';
import { getTranslations } from 'next-intl/server';
import { PriceChart } from '@/components/charts/price-chart';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getMoney } from '@/lib/money-server';
import { bucketLabel } from '@/lib/product-display';
import { sourceLabels } from '@/lib/sources';
import { loadItem, loadSignal } from '../item-data';
import { MarketCompare, compareBucket } from '../market-compare';

type Params = { params: Promise<{ id: string }> };

/**
 * The item's Market sub page, the default (S22): the price history, large; the key numbers in
 * its main condition; the primary market against the others.
 */
export default async function MarketPage({ params }: Params) {
  const { id } = await params;
  const { db, product, mainBucket } = await loadItem(id);
  const compare = await compareBucket(product, mainBucket);
  const [t, money, sourceLabel, stats, history, foreign, japan] = await Promise.all([
    getTranslations(),
    getMoney(),
    sourceLabels(),
    loadSignal(id),
    priceHistory(db, product.id, 365),
    foreignPrices(db, product.id),
    compare ? savedBucketValues(db, [{ product, bucket: compare.bucket }]) : null,
  ]);
  const pct = (x: number | null | undefined) =>
    x == null ? '-' : `${x > 0 ? '+' : ''}${Math.round(x * 100)}%`;
  const numbers: [string, string, string?][] = [
    [t('product.market.value'), stats?.fair != null ? money(stats.fair) : '-'],
    [t('product.market.sales30'), stats ? String(stats.sales30) : '-'],
    [t('product.market.change4'), pct(stats?.trend28)],
    [t('product.market.change12'), pct(stats?.trend84)],
    [
      t('product.market.range'),
      stats?.q25d180 != null && stats.q75d180 != null
        ? `${money(stats.q25d180)} - ${money(stats.q75d180)}`
        : '-',
      t('product.market.rangeHint'),
    ],
  ];
  return (
    <div className="space-y-5">
      <section className="space-y-1.5">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {numbers.map(([label, v, hint]) => (
            <div key={label} className="rounded-xl border bg-card px-4 py-3" title={hint}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="text-lg font-semibold tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
        {mainBucket && (
          <p className="text-xs text-muted-foreground">
            {t('product.market.condition', { condition: bucketLabel(mainBucket, t) })}
          </p>
        )}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>{t('valuation.history')}</CardTitle>
          <CardDescription>{t('product.market.historyInfo')}</CardDescription>
        </CardHeader>
        <CardContent>
          <PriceChart
            points={history}
            defaultBucket={mainBucket}
            sourceLabels={Object.fromEntries(history.map((p) => [p.source, sourceLabel(p.source)]))}
            className="h-72 lg:h-96"
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
    </div>
  );
}
