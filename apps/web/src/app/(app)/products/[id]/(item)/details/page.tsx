import { canEditProduct, dismissedSourceWarnings, productLines, releaseDates } from '@tora/db';
import { trackingMode } from '@tora/core';
import { ChevronRight, Pencil, Plus } from 'lucide-react';
import Link from 'next/link';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getMoney } from '@/lib/money-server';
import {
  customFieldLines,
  franchiseLabel,
  lineLabel,
  lotConditionLabel,
} from '@/lib/product-display';
import { getTaxonomy } from '@/lib/taxonomy';
import { loadItem, loadValues } from '../../item-data';
import { PriceSources } from '../../price-sources';

type Params = { params: Promise<{ id: string }> };

/**
 * The item's Lots & details sub page (S22): every lot of it with its P/L, what the item is (with
 * edit and merge), and where its prices come from.
 */
export default async function DetailsPage({ params }: Params) {
  const { id } = await params;
  const { db, user, product, lots, owned, mainBucket } = await loadItem(id);
  const [t, format, money, locale, taxonomy, totals, dismissed, lines, released] =
    await Promise.all([
      getTranslations(),
      getFormatter(),
      getMoney(),
      getLocale(),
      getTaxonomy(),
      loadValues(id),
      dismissedSourceWarnings(db, user.id),
      productLines(db, [product]),
      releaseDates(db, [product]),
    ]);
  const { values } = totals;
  const line = lines.get(product.id);
  const release = released.get(product.id);
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'medium' });
  const signed = (n: number) => `${n > 0 ? '▲ +' : n < 0 ? '▼ ' : ''}${money(n)}`;
  const details: [string, string | null | undefined][] = [
    [t('fields.kind'), t(`kind.${product.kind}`)],
    [t('fields.franchise'), franchiseLabel(product.franchise, t)],
    [t('fields.region'), product.region && t(`region.${product.region}`)],
    [t('fields.platform'), product.platform],
    [
      t('fields.setName'),
      [product.setName, product.setCode && `(${product.setCode})`].filter(Boolean).join(' '),
    ],
    [t('fields.cardNumber'), product.cardNumber],
    [t('fields.rarity'), product.rarity],
    [t('fields.variant'), product.variant],
    [t('lineField.label'), line && lineLabel(line, t)],
    [t('fields.releaseDate'), release && t(`release.${release.from}`, { date: release.date })],
    [
      t('fields.retailPriceBase'),
      product.retailPriceBase !== null ? money(product.retailPriceBase) : null,
    ],
    ...customFieldLines(product, taxonomy, locale, t).map((l): [string, string] => [
      l.label,
      l.value,
    ]),
    [t('fields.notes'), product.notes],
  ];

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-5">
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold">{t('product.lots')}</h2>
            <Button asChild variant="outline" size="sm">
              <Link href={`/add?product=${product.id}`}>
                <Plus /> {t(lots.length ? 'holding.addMore' : 'watchlist.bought')}
              </Link>
            </Button>
          </div>
          {lots.length === 0 ? (
            <p className="rounded-xl border bg-card px-4 py-4 text-sm text-muted-foreground">
              {t('product.noLots')}
            </p>
          ) : (
            <>
              <ul className="divide-y rounded-xl border bg-card">
                {lots.map((h) => {
                  const v = values.get(h.id);
                  const info = [
                    date(h.acquiredAt),
                    h.acquiredFrom,
                    h.orderId && `#${h.orderId}`,
                    h.quantity > 1 && t('portfolio.qty', { qty: h.quantity }),
                  ].filter(Boolean);
                  return (
                    <li key={h.id}>
                      <Link
                        href={`/holdings/${h.id}`}
                        className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/50"
                      >
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <p className="text-sm font-medium">
                            {lotConditionLabel(h, product, t) ?? t(`kind.${product.kind}`)}
                            {h.status !== 'owned' && (
                              <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs font-normal">
                                {t(`status.${h.status}`)}
                              </span>
                            )}
                            {trackingMode(h) !== 'investment' && (
                              <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs font-normal">
                                {t(`tracking.short.${trackingMode(h)}`)}
                              </span>
                            )}
                            {h.reviewPending && (
                              <span className="ml-2 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-normal text-amber-700 dark:text-amber-400">
                                {t('product.toReview')}
                              </span>
                            )}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {info.join(' · ')}
                          </p>
                        </div>
                        <div className="shrink-0 text-right text-sm tabular-nums">
                          <p className={v != null ? 'font-medium' : undefined}>
                            {v != null ? money(v) : money(h.costTotalBase)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {v != null
                              ? `${t('portfolio.spentShort', { amount: money(h.costTotalBase) })} · ${signed(v - h.costTotalBase)}`
                              : h.status === 'owned'
                                ? t('valuation.short.none')
                                : t('product.cost')}
                          </p>
                        </div>
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
              <p className="text-xs text-muted-foreground">
                {t('product.spentTotal', { amount: money(totals.spent) })}
                {totals.valued > 0 &&
                  totals.valued < owned.length &&
                  ` · ${t('portfolio.lotsValued', { valued: totals.valued, total: owned.length })}`}
              </p>
            </>
          )}
        </section>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
            <CardTitle>{t('product.details')}</CardTitle>
            {canEditProduct(user, product) && (
              <Button asChild variant="outline" size="sm">
                <Link href={`/products/${product.id}/edit?from=/products/${product.id}/details`}>
                  <Pencil /> {t('product.editOrMerge')}
                </Link>
              </Button>
            )}
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
              {details
                .filter(([, v]) => v)
                .map(([label, v]) => (
                  <div key={label} className="contents">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="break-words">{v}</dd>
                  </div>
                ))}
            </dl>
          </CardContent>
        </Card>
      </div>

      <div id="sources" className="scroll-mt-20 space-y-5">
        <PriceSources
          db={db}
          product={product}
          bucket={mainBucket}
          ownedCostBase={owned.reduce((n, h) => n + h.costTotalBase, 0)}
          warningDismissed={dismissed.has(product.id)}
        />
      </div>
    </div>
  );
}
