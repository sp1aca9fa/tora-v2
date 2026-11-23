import {
  askChecks,
  chooseAsk,
  currentSupply,
  holdingBucket,
  listingsIn,
  notItemMarksOf,
  priceHistory,
  ruleTestFor,
  searchListingRows,
} from '@tora/db';
import { judge, productClass, strategyOf } from '@tora/core';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { PriceChart } from '@/components/charts/price-chart';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { bucketLabel, lotConditionLabel } from '@/lib/product-display';
import { sourceLabels } from '@/lib/sources';
import { cn } from '@/lib/utils';
import { BuyReasons, BuyVerdict, RuleTestCard } from '../../buy-timing';
import { ForSale } from '../../for-sale';
import { loadItem, loadSignal } from '../../item-data';
import { WatchCard } from '../../watch-card';
import { GameListings } from './listings';

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ condition?: string }>;
};

/**
 * The item's Buy timing sub page (S22): the verdict first, the price history with the buy zone,
 * the reasons, what is for sale now against the zone, and the person's watches. One condition at
 * a time: the main one, or one of the person's watches and lots, or another with numbers
 * (`?condition=`, e.g. from Opportunities). Not advice.
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
  if (asked && !conditions.includes(asked) && (await loadSignal(id, asked))) conditions.push(asked);
  const bucket = asked && conditions.includes(asked) ? asked : mainBucket;
  const cls = productClass(product);
  const choice = strategyOf(user.preferences, cls);
  const [t, sourceLabel, stats, history, supply, ruleTest, checks] = await Promise.all([
    getTranslations(),
    sourceLabels(),
    loadSignal(id, bucket),
    priceHistory(db, product.id, 365),
    currentSupply(db, [product.id]),
    ruleTestFor(db, product, bucket, choice),
    askChecks(db, [product]),
  ]);
  const forSale = supply.get(product.id) ?? [];
  // A game's asks from a search not yet checked for it (S36 A2): shown muted and labeled, used for
  // nothing (cards and sealed: none).
  const checked = checks.usable(forSale);
  const unverified = new Set(
    forSale.filter((r) => checks.status(r) === 'unverified').map((r) => r.source),
  );
  const zoneTop = stats ? judge(stats, choice).zone.top : null;
  // A game's stored search listings in this condition (S36 A2; cards and sealed store none, and the
  // identity shop's own copy and outside seller, S36 A6, are not among them). A person with
  // a wish on the item or an admin may mark one "not the item" (checked again in the action); a mark
  // is taken back by its maker or an admin.
  const listed = searchListingRows(forSale, bucket);
  const canMark = listed.length > 0 && (user.role === 'admin' || watches.length > 0);
  const marks = listed.some((r) => r.markedOffers?.length)
    ? await notItemMarksOf(db, product.id)
    : new Map<string, { userId: string | null }>();
  // The maker may take their mark back without a wish still on the item; an admin any.
  const mayUndo = new Set(
    [...marks].filter(([, m]) => user.role === 'admin' || m.userId === user.id).map(([key]) => key),
  );
  const listingsChecked = new Set(
    listed.filter((r) => checks.status(r) === 'checked').map((r) => r.source),
  );

  // Wide screens: the verdict and its reasons on one side; the chart, what is for sale and the
  // watches on the other, so the chart stays beside what it explains. A full 4K screen gives those
  // their own column. Phones keep that order.
  return (
    <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] min-[2400px]:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1fr)]">
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
                  'rounded-full border px-2.5 py-1 text-xs',
                  b === bucket
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'text-muted-foreground',
                )}
              >
                {bucketLabel(b, t)}
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

        {stats && <BuyReasons stats={stats} />}
      </div>

      <div className="space-y-5 min-[2400px]:contents">
        <div className="space-y-5">
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
        </div>
        <div className="space-y-5">
          <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-2 xl:grid-cols-1 min-[1600px]:grid-cols-2 min-[2400px]:grid-cols-1">
            <ForSale rows={forSale} mainBucket={bucket} zoneTop={zoneTop} unverified={unverified}>
              <GameListings
                productId={product.id}
                rows={listed}
                canMark={canMark}
                mayUndo={mayUndo}
                checked={listingsChecked}
              />
            </ForSale>
            <div className="space-y-3">
              <WatchCard
                productId={product.id}
                cls={cls}
                retail={product.retailPriceBase}
                watches={watches.map((w) => {
                  // The price to act on; a cheaper unverified one is only mentioned.
                  const { ask: best, unverified: other } = chooseAsk(
                    forSale,
                    w.bucket,
                    checks.status,
                  );
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
                      listings: listingsIn(checked, w.bucket),
                    },
                    ...(other && {
                      unverified: {
                        price: other.lowestAskBase!,
                        source: sourceLabel(other.source),
                      },
                    }),
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
          {choice.strategy !== 'target' && (
            <RuleTestCard test={ruleTest} strategyName={t(`strategy.name.${choice.strategy}`)} />
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground xl:col-span-full">{t('strategy.notAdvice')}</p>
    </div>
  );
}
