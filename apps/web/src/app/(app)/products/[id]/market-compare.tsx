import {
  type Valuation,
  compareBucket as compareIn,
  marketsOf,
  productClass,
  valuationOrder,
} from '@tora/core';
import { type ForeignPrice, type Product, foreignEstimates } from '@tora/db';
import { getFormatter, getTranslations } from 'next-intl/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getRegistry, marketLabels, sourceLabels } from '@/lib/sources';
import { getMoney } from '@/lib/money-server';

/** The condition markets are compared in on the item page (see core `compareBucket`). */
export async function compareBucket(product: Product, mainBucket: string | null) {
  const registry = await getRegistry();
  return compareIn(productClass(product), mainBucket, registry.taxonomy!);
}

/**
 * The primary market against the secondary one, or against every other market (S7, S11, S16;
 * the admin's choice): the value next to one price per market converted to the base currency,
 * the market's reference source's, else a supporting one's.
 */
export async function MarketCompare({
  compare,
  japan,
  product,
  mainBucket,
  foreign,
}: {
  /** See `compareBucket`. */
  compare: { bucket: string; plain: boolean };
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
  const { primary, secondary, compare: mode } = registry.markets ?? {};
  const others =
    mode === 'all'
      ? marketsOf(registry.sources).filter((m) => m !== primary)
      : secondary
        ? [secondary]
        : [];
  const estimates = foreignEstimates(foreign, compare);
  const rows = others.flatMap((market) => {
    const f = valuationOrder(registry, productClass(product), market)
      .map((key) => estimates.find((e) => e.source === key && e.market === market))
      .find((e) => e !== undefined);
    return f ? [{ market, f }] : [];
  });
  if (rows.length === 0) return null;
  const bucket = compare.bucket;
  const [t, format, money] = await Promise.all([getTranslations(), getFormatter(), getMoney()]);
  const all = mode === 'all';
  const markets = {
    primary: marketLabel(primary ?? null),
    secondary: all ? '' : marketLabel(secondary ?? null),
  };
  // A market comparison: a retail price is no market value.
  const jp =
    japan && japan.method !== 'retail' ? japan : { unitBase: null, source: null, method: 'none' };
  const spread = (priceBase: number) =>
    jp.unitBase ? Math.round(((priceBase - jp.unitBase) / jp.unitBase) * 100) : null;
  const signedPct = (pct: number) => (pct > 0 ? `+${pct}` : String(pct));
  const inCurrency = (n: number, currency: string) =>
    format.number(n, { style: 'currency', currency, maximumFractionDigits: 2 });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t(all ? 'compare.titleAll' : 'compare.title', markets)}</CardTitle>
        <CardDescription>
          {t(all ? 'compare.infoAll' : 'compare.info', { bucket, ...markets })}
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
              {jp.unitBase === null ? t('compare.noJapan', markets) : money(jp.unitBase)}
            </span>
          </li>
          {rows.map(({ market, f }) => (
            <li key={market} className="space-y-0.5 py-2">
              <div className="flex items-baseline justify-between gap-3">
                <span>
                  {marketLabel(market)}
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
                  <span className="font-medium">{money(f.priceBase)}</span>
                  {spread(f.priceBase) !== null && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {t('compare.spread', {
                        pct: signedPct(spread(f.priceBase)!),
                        ...markets,
                      })}
                    </span>
                  )}
                </span>
              </div>
              {f.currency !== money.base && (
                <p className="amount text-xs text-muted-foreground">
                  {t('compare.converted', {
                    price: inCurrency(f.price, f.currency),
                    rate: f.fxRate ? inCurrency(f.fxRate, money.base) : '-',
                    currency: f.currency,
                    date: f.fxDate ?? '-',
                  })}
                </p>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
