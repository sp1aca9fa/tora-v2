import { type Valuation, valueUnit } from '@tora/core';
import type { ForeignPrice, MarketData, Product } from '@tora/db';
import { getFormatter, getTranslations } from 'next-intl/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { sourceLabel } from '@/lib/product-display';
import { formatJpy } from '@/lib/utils';

/**
 * The condition US prices are quoted in: TCGplayer prices ungraded near-mint cards and sealed
 * product. The user's own condition when it is one of those, else the usual one.
 */
export function compareBucket(product: Product, mainBucket: string | null): string | null {
  if (product.category !== 'tcg') return null;
  if (product.kind === 'single') return mainBucket?.startsWith('raw:') ? mainBucket : 'raw:A';
  return mainBucket === 'sealed:no_shrink' ? mainBucket : 'sealed:shrink';
}

/** Japan vs US: the Japanese market value next to foreign prices converted to yen (S7). */
export async function MarketCompare({
  product,
  market,
  mainBucket,
  foreign,
}: {
  product: Product;
  market: MarketData;
  mainBucket: string | null;
  foreign: ForeignPrice[];
}) {
  const bucket = compareBucket(product, mainBucket);
  if (!bucket || foreign.length === 0) return null;
  const [t, format] = await Promise.all([getTranslations(), getFormatter()]);
  const observations = market.observations.get(product.id) ?? [];
  const jpOf = (b: string): Valuation => valueUnit({ bucket: b, observations });
  const jp = jpOf(bucket);
  // A graded foreign price (eBay "PSA 10") is compared with the same grade in Japan.
  const graded = mainBucket?.startsWith('graded:') && !foreign.some((f) => f.bucket === mainBucket);
  const money = (n: number, currency: string) =>
    format.number(n, { style: 'currency', currency, maximumFractionDigits: 2 });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('compare.title')}</CardTitle>
        <CardDescription>
          {t('compare.info', { bucket })}
          {graded && ` ${t('compare.graded')}`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y text-sm">
          <li className="flex items-baseline justify-between gap-3 py-2">
            <span>
              {t('compare.japan')}
              {jp.source && (
                <span className="ml-1.5 text-xs text-muted-foreground">
                  {jp.method === 'store'
                    ? t('valuation.store', { source: sourceLabel(jp.source) })
                    : sourceLabel(jp.source)}
                </span>
              )}
            </span>
            <span className="font-medium tabular-nums">
              {jp.unitJpy === null ? t('compare.noJapan') : formatJpy(jp.unitJpy)}
            </span>
          </li>
          {foreign.map((f) => {
            const spread = jp.unitJpy
              ? Math.round(((f.priceJpy - jp.unitJpy) / jp.unitJpy) * 100)
              : null;
            return (
              <li key={`${f.source}|${f.url}|${f.variant}`} className="space-y-0.5 py-2">
                <div className="flex items-baseline justify-between gap-3">
                  <span>
                    {t('compare.us')}
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      {f.url ? (
                        <a href={f.url} target="_blank" rel="noreferrer" className="underline">
                          {sourceLabel(f.source)}
                        </a>
                      ) : (
                        sourceLabel(f.source)
                      )}
                      {f.variant && ` · ${f.variant}`}
                      {f.count !== null && ` · ${t('compare.asks', { count: f.count })}`}
                    </span>
                  </span>
                  <span className="text-right tabular-nums">
                    <span className="font-medium">{formatJpy(f.priceJpy)}</span>
                    {spread !== null && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {t('compare.spread', { pct: spread > 0 ? `+${spread}` : String(spread) })}
                      </span>
                    )}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('compare.converted', {
                    price: money(f.price, f.currency),
                    rate: f.fxRate ? format.number(f.fxRate, { maximumFractionDigits: 2 }) : '-',
                    date: f.fxDate ?? '-',
                  })}
                </p>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
