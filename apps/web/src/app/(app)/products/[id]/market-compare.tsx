import type { Valuation } from '@tora/core';
import { type ForeignPrice, type Product, foreignEstimates } from '@tora/db';
import { getFormatter, getTranslations } from 'next-intl/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatJpy } from '@/lib/utils';
import { sourceLabels } from '@/lib/sources';

/**
 * The condition US prices are quoted in: TCGplayer prices ungraded near-mint cards and sealed
 * product. The user's own condition when it is one of those, else the usual one.
 */
export function compareBucket(product: Product, mainBucket: string | null): string | null {
  if (product.category !== 'tcg') return null;
  if (product.kind === 'single') return mainBucket?.startsWith('raw:') ? mainBucket : 'raw:A';
  return mainBucket === 'sealed:no_shrink' ? mainBucket : 'sealed:shrink';
}

/**
 * Japan vs US: the Japanese market value next to one estimated price per foreign source,
 * converted to yen (S7).
 */
export async function MarketCompare({
  bucket,
  japan,
  mainBucket,
  foreign,
}: {
  /** See `compareBucket`. */
  bucket: string;
  /** The Japanese market value in that bucket. */
  japan: Valuation | null;
  mainBucket: string | null;
  foreign: ForeignPrice[];
}) {
  const sourceLabel = await sourceLabels();
  const estimates = foreignEstimates(foreign);
  if (estimates.length === 0) return null;
  const [t, format] = await Promise.all([getTranslations(), getFormatter()]);
  // A market comparison: a retail price is no market value.
  const jp =
    japan && japan.method !== 'retail' ? japan : { unitJpy: null, source: null, method: 'none' };
  // Graded lots are compared at the ungraded condition on both sides.
  const graded = mainBucket?.startsWith('graded:');
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
          {estimates.map((f) => {
            const spread = jp.unitJpy
              ? Math.round(((f.priceJpy - jp.unitJpy) / jp.unitJpy) * 100)
              : null;
            return (
              <li key={f.source} className="space-y-0.5 py-2">
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
                      {f.count !== null
                        ? ` · ${t('compare.asks', { count: f.count })}`
                        : f.of > 1
                          ? ` · ${t('compare.middleOf', { count: f.of })}`
                          : f.variant && ` · ${f.variant}`}
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
                <p className="amount text-xs text-muted-foreground">
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
