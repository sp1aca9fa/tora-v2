import { type Db, type Holding, type Product, valueHoldings } from '@tora/db';
import { getFormatter, getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { SourceBadge } from '@/components/source-badge';
import { Trend } from '@/components/trend';
import { ValuationMeta } from '@/components/valuation-meta';
import { ManualPriceForm } from './manual-price-form';
import { clearManualPriceAction, setManualPriceAction } from './valuation-actions';
import { bucketLabel } from '@/lib/product-display';
import { sourceLabels } from '@/lib/sources';
import { getMoney } from '@/lib/money-server';

/** Current value of the holding: how it was computed, P/L, buylist floor, manual override. */
export async function ValuationCard({
  db,
  userId,
  holding,
  product,
  bucket,
}: {
  db: Db;
  userId: string;
  holding: Holding;
  product: Product;
  bucket: string | null;
}) {
  const money = await getMoney();
  const sourceLabel = await sourceLabels();
  const [t, tAll, format, values] = await Promise.all([
    getTranslations('valuation'),
    getTranslations(),
    getFormatter(),
    valueHoldings(db, userId, [{ holding, product }]),
  ]);
  const v = values.get(holding.id)!;
  const now = new Date();
  /** "~5 hours ago" for recent (approximate) trades, else the date. */
  const when = (iso: string, approximate: boolean) => {
    const at = new Date(iso);
    if (now.getTime() - at.getTime() < 7 * 86_400_000) {
      return `${approximate ? '~' : ''}${format.relativeTime(at, now)}`;
    }
    return format.dateTime(at, { dateStyle: 'medium' });
  };
  const pl = v.valueBase === null ? null : v.valueBase - holding.costTotalBase;

  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs text-muted-foreground">{t('title')}</p>
            <p className="text-2xl font-semibold tabular-nums">
              {v.valueBase === null ? '-' : money(v.valueBase)}
            </p>
            {holding.quantity > 1 && v.unitBase !== null && (
              <p className="amount text-xs text-muted-foreground">
                {t('perUnit', { amount: money(v.unitBase), qty: holding.quantity })}
              </p>
            )}
          </div>
          {pl !== null && (
            <div className="text-right">
              <p className="text-xs text-muted-foreground">{t('pl')}</p>
              <p className="font-medium tabular-nums">
                {pl > 0 ? '▲ +' : pl < 0 ? '▼ ' : ''}
                {money(pl)}
              </p>
            </div>
          )}
        </div>
        {v.last && (
          <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="text-muted-foreground">{t('lastSale')}</span>
            <span className="font-medium tabular-nums">{money(v.last.priceBase)}</span>
            <span className="text-xs text-muted-foreground">
              {sourceLabel(v.last.source)} · {when(v.last.observedAt, v.last.approximate)}
            </span>
            {v.trendPct !== null && (
              <span className="text-xs text-muted-foreground">
                <Trend pct={v.trendPct} /> {t('vsMedian')}
              </span>
            )}
          </p>
        )}
        <ValuationMeta v={v} source={sourceLabel(v.source ?? '')} />
        {v.method === 'median' && v.estimatedSamples > 0 && (
          <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
            {t('estimatedSamples', { count: v.estimatedSamples, total: v.sampleSize })}
          </p>
        )}
        {v.sources.length > 0 && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {v.sources.map((src) => (
              <div key={src.source} className="space-y-1 rounded-md border px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <SourceBadge source={src.source} />
                  {src.last && (
                    <span className="text-xs text-muted-foreground">
                      {when(src.last.observedAt, src.last.approximate)}
                    </span>
                  )}
                </div>
                <p className="flex items-baseline justify-between gap-2">
                  <span className="text-xs text-muted-foreground">{t('lastSale')}</span>
                  <span className="font-medium tabular-nums">
                    {src.last ? money(src.last.priceBase) : '-'}
                  </span>
                </p>
                <p className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
                  <span>
                    {src.medianBase === null
                      ? t('noMedian')
                      : t('medianOf', { count: src.sampleSize, days: src.windowDays ?? 0 })}
                  </span>
                  <span className="tabular-nums">
                    {src.medianBase === null ? '' : money(src.medianBase)}{' '}
                    <Trend pct={src.trendPct} />
                  </span>
                </p>
              </div>
            ))}
          </div>
        )}
        {bucket && (
          <p className="text-xs text-muted-foreground">
            {t('bucket')}: {bucketLabel(bucket, tAll)}
          </p>
        )}
        {v.method === 'none' && <p className="text-sm text-muted-foreground">{t('noDataHint')}</p>}
        {v.buylist && (
          <p className="amount text-sm">
            {t('buylist', {
              price: money(v.buylist.priceBase),
              source: sourceLabel(v.buylist.source),
              date: format.dateTime(new Date(v.buylist.observedAt), { dateStyle: 'medium' }),
            })}
          </p>
        )}
        {bucket && (
          <details className="text-sm" open={v.method === 'none'}>
            <summary className="cursor-pointer text-muted-foreground">{t('manualTitle')}</summary>
            <div className="mt-2 space-y-2">
              {v.method === 'manual' && (
                <form action={clearManualPriceAction.bind(null, product.id, holding.id, bucket)}>
                  <p className="text-xs text-muted-foreground">{t('manualActive')}</p>
                  <Button variant="ghost" size="sm">
                    {t('clearManual')}
                  </Button>
                </form>
              )}
              <ManualPriceForm
                action={setManualPriceAction.bind(null, product.id, holding.id, bucket)}
              />
              <p className="text-xs text-muted-foreground">{t('manualHint')}</p>
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
