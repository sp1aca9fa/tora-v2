import { type Db, type Holding, type Product, loadMarketData, valueHolding } from '@tora/db';
import { getFormatter, getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
        <ValuationMeta v={v} />
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
