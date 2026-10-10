import { type Db, type Holding, type Product, loadMarketData, valueHolding } from '@tora/db';
import { getFormatter, getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { SourceBadge } from '@/components/source-badge';
import { Trend } from '@/components/trend';
import { ValuationMeta } from '@/components/valuation-meta';
import { sourceLabel } from '@/lib/product-display';
import { formatJpy } from '@/lib/utils';
import { ManualPriceForm } from './manual-price-form';
import { clearManualPriceAction, setManualPriceAction } from './valuation-actions';

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
  const [t, format, market] = await Promise.all([
    getTranslations('valuation'),
    getFormatter(),
    loadMarketData(db, userId, [product.id]),
  ]);
  const v = valueHolding(holding, product, market);
  const now = new Date();
  /** "~5 hours ago" for recent (approximate) trades, else the date. */
  const when = (iso: string, approximate: boolean) => {
    const at = new Date(iso);
    if (now.getTime() - at.getTime() < 7 * 86_400_000) {
      return `${approximate ? '~' : ''}${format.relativeTime(at, now)}`;
    }
    return format.dateTime(at, { dateStyle: 'medium' });
  };
  const pl = v.valueJpy === null ? null : v.valueJpy - holding.costTotalJpy;

  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs text-muted-foreground">{t('title')}</p>
            <p className="text-2xl font-semibold tabular-nums">
              {v.valueJpy === null ? '-' : formatJpy(v.valueJpy)}
            </p>
            {holding.quantity > 1 && v.unitJpy !== null && (
              <p className="text-xs text-muted-foreground">
                {t('perUnit', { amount: formatJpy(v.unitJpy), qty: holding.quantity })}
              </p>
            )}
          </div>
          {pl !== null && (
            <div className="text-right">
              <p className="text-xs text-muted-foreground">{t('pl')}</p>
              <p className="font-medium tabular-nums">
                {pl > 0 ? '▲ +' : pl < 0 ? '▼ ' : ''}
                {formatJpy(pl)}
              </p>
            </div>
          )}
        </div>
        {v.last && (
          <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="text-muted-foreground">{t('lastSale')}</span>
            <span className="font-medium tabular-nums">{formatJpy(v.last.priceJpy)}</span>
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
        <ValuationMeta v={v} />
        {v.method === 'median' && v.estimatedSamples > 0 && (
          <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
            {t('estimatedSamples', { count: v.estimatedSamples, total: v.sampleSize })}
          </p>
        )}
        {v.sources.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-2">
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
                    {src.last ? formatJpy(src.last.priceJpy) : '-'}
                  </span>
                </p>
                <p className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
                  <span>
                    {src.medianJpy === null
                      ? t('noMedian')
                      : t('medianOf', { count: src.sampleSize, days: src.windowDays ?? 0 })}
                  </span>
                  <span className="tabular-nums">
                    {src.medianJpy === null ? '' : formatJpy(src.medianJpy)}{' '}
                    <Trend pct={src.trendPct} />
                  </span>
                </p>
              </div>
            ))}
          </div>
        )}
        {bucket && (
          <p className="text-xs text-muted-foreground">
            {t('bucket')}: <code>{bucket}</code>
          </p>
        )}
        {v.method === 'none' && <p className="text-sm text-muted-foreground">{t('noDataHint')}</p>}
        {v.buylist && (
          <p className="text-sm">
            {t('buylist', {
              price: formatJpy(v.buylist.priceJpy),
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
