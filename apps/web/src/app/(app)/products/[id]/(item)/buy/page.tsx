import {
  currentSupply,
  holdingBucket,
  listingsIn,
  lowestAsk,
  priceHistory,
  ruleTestFor,
} from '@tora/db';
import { judge, productClass, strategyOf } from '@tora/core';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { PriceChart } from '@/components/charts/price-chart';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { lotConditionLabel } from '@/lib/product-display';
import { sourceLabels } from '@/lib/sources';
import { cn } from '@/lib/utils';
import { BuyReasons, BuyVerdict, RuleTestCard } from '../../buy-timing';
import { ForSale } from '../../for-sale';
import { loadItem, loadSignal } from '../../item-data';
import { WatchCard } from '../../watch-card';

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ condition?: string }>;
};

/**
 * The item's Buy timing sub page (S22): the verdict first, the price history with the buy zone,
 * the reasons, what is for sale now against the zone, and the person's watches. One condition at
 * a time: the main one, or one of the person's watches and lots (`?condition=`). Not advice.
 */
export default async function BuyPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { condition: asked } = await searchParams;
  const { db, user, product, lots, watches, owned, mainBucket } = await loadItem(id);
  const conditions = [
    ...new Set(
      [
        mainBucket,
        ...watches.map((w) => w.bucket || null),
        ...owned.map((h) => holdingBucket(h, product)),
      ].filter((b): b is string => !!b),
    ),
  ];
  const bucket = asked && conditions.includes(asked) ? asked : mainBucket;
  const cls = productClass(product);
  const choice = strategyOf(user.preferences, cls);
  const [t, sourceLabel, stats, history, supply, ruleTest] = await Promise.all([
    getTranslations(),
    sourceLabels(),
    loadSignal(id, bucket),
    priceHistory(db, product.id, 365),
    currentSupply(db, [product.id]),
    ruleTestFor(db, product, bucket, choice),
  ]);
  const forSale = supply.get(product.id) ?? [];
  const zoneTop = stats ? judge(stats, choice).zone.top : null;

  // Wide screens: the verdict, the chart and the reasons on the left; what is for sale and the
  // watches beside them. Phones keep that order in one column.
  return (
    <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,28rem)]">
      <div className="space-y-5">
        {conditions.length > 1 && (
          <nav className="flex flex-wrap gap-1.5" aria-label={t('valuation.bucket')}>
            {conditions.map((b) => (
              <Link
                key={b}
                href={
                  b === mainBucket
                    ? `/products/${id}/buy`
                    : `/products/${id}/buy?condition=${encodeURIComponent(b)}`
                }
                aria-current={b === bucket ? 'page' : undefined}
                className={cn(
                  'rounded-full border px-2.5 py-1 font-mono text-xs',
                  b === bucket
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'text-muted-foreground',
                )}
              >
                {b}
              </Link>
            ))}
          </nav>
        )}

        <BuyVerdict
          stats={stats}
          choice={choice}
          typeLabel={t.has(`sourceRoles.class.${cls}`) ? t(`sourceRoles.class.${cls}`) : cls}
          condition={bucket}
        />

        <Card>
          <CardHeader>
            <CardTitle>{t('valuation.history')}</CardTitle>
          </CardHeader>
          <CardContent>
            <PriceChart
              key={bucket}
              points={history}
              defaultBucket={bucket}
              sourceLabels={Object.fromEntries(
                history.map((p) => [p.source, sourceLabel(p.source)]),
              )}
              guides={
                stats
                  ? { zoneTop, low: stats.q25d180, high: stats.q75d180, ask: stats.ask }
                  : undefined
              }
              className="h-72 xl:h-96"
            />
          </CardContent>
        </Card>

        {stats && <BuyReasons stats={stats} />}

        {choice.strategy !== 'target' && (
          <RuleTestCard test={ruleTest} strategyName={t(`strategy.name.${choice.strategy}`)} />
        )}
      </div>

      <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-2 xl:grid-cols-1">
        <ForSale rows={forSale} mainBucket={bucket} zoneTop={zoneTop} />
        <div className="space-y-3">
          <WatchCard
            productId={product.id}
            cls={cls}
            retail={product.retailPriceBase}
            watches={watches.map((w) => {
              const best = lowestAsk(forSale, w.bucket);
              return {
                id: w.id,
                label: lotConditionLabel(w, product, t),
                target: w.targetPriceBase,
                note: w.note,
                alertLimited: w.alertLimited,
                defaults: w,
                ask: best && {
                  price: best.lowestAskBase!,
                  source: sourceLabel(best.source),
                  url: best.url,
                  listings: listingsIn(forSale, w.bucket),
                },
              };
            })}
          />
          {lots.length === 0 && (
            // Watched, not owned: bought it, register the lot.
            <Button asChild variant="outline" size="sm">
              <Link href={`/add?product=${product.id}`}>
                <Plus /> {t('watchlist.bought')}
              </Link>
            </Button>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground xl:col-span-2">{t('strategy.notAdvice')}</p>
    </div>
  );
}
