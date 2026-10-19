import { judge, productClass, strategyOf } from '@tora/core';
import {
  bucketValueKey,
  currentSupply,
  imageVersions,
  latestSignals,
  listWatches,
  lowestAsk,
  savedBucketValues,
} from '@tora/db';
import { ChevronRight, Plus, PackageOpen } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { AmountsToggle } from '@/components/amounts-toggle';
import { ProductImage } from '@/components/product-image';
import { Button } from '@/components/ui/button';
import { authed } from '@/lib/auth/guard';
import { getMoney } from '@/lib/money-server';
import { franchiseLabel, lotConditionLabel } from '@/lib/product-display';
import { cn } from '@/lib/utils';
import { VERDICT_STYLE, verdictKey } from '../products/[id]/buy-timing';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('nav'))('watchlist') };
}

/**
 * Items the person watches to buy (requirements S9): each item and condition with today's market
 * value and how far it is from the target. Items at or under their target come first.
 */
export default async function WatchlistPage() {
  const { db, user } = await authed();
  const [rows, t, money] = await Promise.all([
    listWatches(db, user.id),
    getTranslations(),
    getMoney(),
  ]);
  const [values, images, supply, timing] = await Promise.all([
    savedBucketValues(
      db,
      rows.map((r) => ({ product: r.product, bucket: r.watch.bucket || null })),
    ),
    imageVersions(
      db,
      rows.map((r) => r.product.id),
    ),
    currentSupply(
      db,
      rows.map((r) => r.product.id),
    ),
    latestSignals(
      db,
      rows.map((r) => ({ productId: r.product.id, bucket: r.watch.bucket || null })),
    ),
  ]);
  const typeLabel = (type: string) =>
    t.has(`sourceRoles.class.${type}`) ? t(`sourceRoles.class.${type}`) : type;
  const items = rows.map((r) => {
    const value = values.get(bucketValueKey(r.product.id, r.watch.bucket || null));
    const now = value?.valuation.unitBase ?? null;
    const target = r.watch.targetPriceBase;
    const ask = lowestAsk(supply.get(r.product.id) ?? [], r.watch.bucket);
    // The value or the lowest ask, whichever is closer to the target.
    const near = [now, ask?.lowestAskBase ?? null].filter((n): n is number => n !== null);
    // Buy timing (S9 part 4) by the person's strategy for the item's type.
    const stats = timing.get(`${r.product.id}|${r.watch.bucket}`)?.stats ?? null;
    const judged = stats
      ? judge(stats, strategyOf(user.preferences, productClass(r.product)))
      : null;
    return {
      ...r,
      now,
      ask,
      judged,
      last: value?.last ?? null,
      gap: near.length && target ? Math.min(...near) - target : null,
    };
  });
  // Under the target first, then good prices, then closest to the target, then the rest as added.
  const rank = (i: (typeof items)[number]) =>
    i.gap !== null && i.gap <= 0 ? 0 : i.judged?.verdict === 'good' ? 1 : 2;
  items.sort((a, b) => rank(a) - rank(b) || (a.gap ?? Infinity) - (b.gap ?? Infinity));
  // The strategy per item type watched (the setup the page asks for until it is done).
  const types = [...new Set(rows.map((r) => productClass(r.product)))];
  const chosen = !!user.preferences?.buyStrategy?.chosenAt;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">{t('nav.watchlist')}</h1>
            <AmountsToggle />
          </div>
          <p className="text-sm text-muted-foreground">{t('watchlist.intro')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/watchlist/opening">
              <PackageOpen /> {t('opening.listTitle')}
            </Link>
          </Button>
          <Button asChild>
            <Link href="/watchlist/add">
              <Plus /> {t('watchlist.add')}
            </Link>
          </Button>
        </div>
      </header>
      {items.length > 0 &&
        (chosen ? (
          <p className="text-sm text-muted-foreground">
            {t('watchlist.strategyLine', {
              list: types
                .map((type) => {
                  const c = strategyOf(user.preferences, type);
                  return `${typeLabel(type)}: ${t(`strategy.name.${c.strategy}`)}${c.strategy === 'margin' ? ` ${c.margin}%` : ''}`;
                })
                .join(' · '),
            })}{' '}
            <Link href="/watchlist/strategy" className="underline">
              {t('buy.change')}
            </Link>
          </p>
        ) : (
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-primary/50 bg-primary/5 px-4 py-4">
            <div className="max-w-xl space-y-1">
              <h2 className="font-semibold">{t('watchlist.setupTitle')}</h2>
              <p className="text-sm text-muted-foreground">{t('watchlist.setupText')}</p>
            </div>
            <Button asChild>
              <Link href="/watchlist/strategy">{t('watchlist.setupButton')}</Link>
            </Button>
          </section>
        ))}
      {items.length === 0 ? (
        <p className="rounded-xl border bg-card px-4 py-6 text-sm text-muted-foreground">
          {t('watchlist.empty')}
        </p>
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {items.map(({ watch, product, now, ask, last, gap, judged }) => {
            const details = [
              lotConditionLabel(watch, product, t),
              t(`kind.${product.kind}`),
              franchiseLabel(product.franchise, t),
            ].filter(Boolean);
            const target = watch.targetPriceBase;
            return (
              <li key={watch.id}>
                <Link
                  href={`/products/${product.id}/buy${watch.bucket ? `?condition=${encodeURIComponent(watch.bucket)}` : ''}`}
                  className="block px-3 py-3 transition-colors hover:bg-accent/50"
                >
                  <div className="flex items-center gap-3">
                    <ProductImage
                      product={product}
                      version={images.get(product.id)}
                      className="size-14 shrink-0"
                    />
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="line-clamp-2 text-sm leading-snug font-medium">
                        {product.name}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {details.join(' · ')}
                      </p>
                      {watch.note && (
                        <p className="truncate text-xs text-muted-foreground">{watch.note}</p>
                      )}
                    </div>
                    <div className="max-w-[45%] shrink-0 space-y-0.5 text-right text-sm">
                      <p
                        className={
                          now !== null ? 'font-medium tabular-nums' : 'text-muted-foreground'
                        }
                      >
                        {now !== null ? money(now) : t('watchlist.noPrice')}
                      </p>
                      {ask && (
                        <p
                          className={cn(
                            'text-xs',
                            target && ask.lowestAskBase! <= target
                              ? 'font-medium text-emerald-700 dark:text-emerald-400'
                              : 'text-muted-foreground',
                          )}
                        >
                          {t.rich('watchlist.askShort', {
                            amount: money(ask.lowestAskBase!),
                            n: (chunks) => <span className="tabular-nums">{chunks}</span>,
                          })}
                        </p>
                      )}
                      {target ? (
                        <p
                          className={cn(
                            'text-xs tabular-nums',
                            gap !== null && gap <= 0
                              ? 'font-medium text-emerald-700 dark:text-emerald-400'
                              : 'text-muted-foreground',
                          )}
                        >
                          {gap !== null && gap <= 0
                            ? t('watchlist.underTarget', { target: money(target) })
                            : gap !== null
                              ? t('watchlist.overTarget', {
                                  amount: money(gap),
                                  target: money(target),
                                })
                              : t('watchlist.targetShort', { target: money(target) })}
                        </p>
                      ) : (
                        last && (
                          <p className="text-xs text-muted-foreground tabular-nums">
                            {t('watchlist.lastSale', { amount: money(last.priceBase) })}
                          </p>
                        )
                      )}
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  </div>
                  {judged && judged.verdict !== 'none' && (
                    <p className="mt-1.5 flex flex-wrap items-center gap-x-2 pl-[68px] text-xs">
                      <span
                        className={cn('rounded px-1.5 font-medium', VERDICT_STYLE[judged.verdict])}
                      >
                        {t(`buy.verdict.${verdictKey(judged)}`)}
                      </span>
                      {judged.zone.top !== null && (
                        <span className="text-muted-foreground">
                          {t.rich('watchlist.zoneShort', {
                            amount: money(judged.zone.top),
                            n: (c) => <span className="amount tabular-nums">{c}</span>,
                          })}
                        </span>
                      )}
                      {judged.limited.length > 0 && (
                        <span className="text-amber-700 dark:text-amber-300">
                          {t('watchlist.limited')}
                        </span>
                      )}
                    </p>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
