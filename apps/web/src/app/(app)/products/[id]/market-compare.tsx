import { type Valuation, productClass, valuationOrder } from '@tora/core';
import { type ForeignPrice, type Product, foreignEstimates } from '@tora/db';
import { getFormatter, getTranslations } from 'next-intl/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatJpy } from '@/lib/utils';
import { getRegistry, marketLabels, sourceLabels } from '@/lib/sources';

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
 * Primary vs secondary market (S7, S11; e.g. Japan vs US): the value next to one secondary
 * price converted to yen, the secondary market's reference source's, else a supporting one's.
 */
export async function MarketCompare({
  bucket,
  japan,
  product,
  mainBucket,
  foreign,
}: {
  /** See `compareBucket`. */
  bucket: string;
  /** The primary market value in that bucket. */
  japan: Valuation | null;
  product: Product;
  mainBucket: string | null;
  foreign: ForeignPrice[];
}) {
  const [sourceLabel, marketLabel, registry] = await Promise.all([
    sourceLabels(),
    marketLabels(),
    getRegistry(),
  ]);
  const { primary, secondary } = registry.markets ?? {};
  if (!secondary) return null;
  const estimates = foreignEstimates(foreign);
  const f = valuationOrder(registry, productClass(product), secondary)
    .map((key) => estimates.find((e) => e.source === key))
    .find((e) => e !== undefined);
  if (!f) return null;
  const [t, format] = await Promise.all([getTranslations(), getFormatter()]);
  const markets = { primary: marketLabel(primary), secondary: marketLabel(secondary) };
  // A market comparison: a retail price is no market value.
  const jp =
    japan && japan.method !== 'retail' ? japan : { unitJpy: null, source: null, method: 'none' };
  const spread = jp.unitJpy ? Math.round(((f.priceJpy - jp.unitJpy) / jp.unitJpy) * 100) : null;
  const money = (n: number, currency: string) =>
    format.number(n, { style: 'currency', currency, maximumFractionDigits: 2 });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('compare.title', markets)}</CardTitle>
        <CardDescription>
          {t('compare.info', { bucket, ...markets })}
          {/* Graded lots are compared at the ungraded condition on both sides. */}
          {mainBucket?.startsWith('graded:') && ` ${t('compare.graded')}`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y text-sm">
          <li className="flex items-baseline justify-between gap-3 py-2">
            <span>
              {markets.primary}
              {jp.source && (
                <span className="ml-1.5 text-xs text-muted-foreground">
                  {jp.method === 'store'
                    ? t('valuation.store', { source: sourceLabel(jp.source) })
                    : sourceLabel(jp.source)}
                </span>
              )}
            </span>
            <span className="font-medium tabular-nums">
              {jp.unitJpy === null ? t('compare.noJapan', markets) : formatJpy(jp.unitJpy)}
            </span>
          </li>
          <li className="space-y-0.5 py-2">
            <div className="flex items-baseline justify-between gap-3">
              <span>
                {markets.secondary}
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
                    {t('compare.spread', {
                      pct: spread > 0 ? `+${spread}` : String(spread),
                      ...markets,
                    })}
                  </span>
                )}
              </span>
            </div>
            <p className="amount text-xs text-muted-foreground">
              {t('compare.converted', {
                price: money(f.price, f.currency),
                rate: f.fxRate ? format.number(f.fxRate, { maximumFractionDigits: 2 }) : '-',
                currency: f.currency,
                date: f.fxDate ?? '-',
              })}
            </p>
          </li>
        </ul>
      </CardContent>
    </Card>
  );
}
