import { judge, productClass, strategyOf } from '@tora/core';
import {
  askChecks,
  bucketValueKey,
  currentSupply,
  imageVersions,
  chooseAsk,
  latestSignals,
  listWatches,
  savedBucketValues,
  wishStates,
  type WishState,
  type WishView,
  wishViews,
} from '@tora/db';
import { ChevronRight, Plus, PackageOpen } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { AmountsToggle } from '@/components/amounts-toggle';
import { ProductImage } from '@/components/product-image';
import { UnverifiedNote } from '@/components/unverified-note';
import { Button } from '@/components/ui/button';
import { authed } from '@/lib/auth/guard';
import { getMoney } from '@/lib/money-server';
import { sourceLabels } from '@/lib/sources';
import { franchiseLabel, lotConditionLabel } from '@/lib/product-display';
import { cn } from '@/lib/utils';
import { VERDICT_STYLE, verdictKey } from '../products/[id]/buy-timing';
import { showsPrices } from './wish-prices';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('nav'))('watchlist') };
}

/**
 * The wishlist (requirements S9, S36 B1): each item and condition with today's market value and how
 * far it is from the target. Items at or under their target come first. A game wish reads "check
 * needed" until its sales are confirmed (`wishStates`), and until then shows no price, ask, gap,
 * buy timing or last sale (fix C5): they would come from sales nobody checked. A confirmed game wish
 * shows them as cards and sealed do.
 */
export default async function WatchlistPage() {
  const { db, user } = await authed();
  const [rows, t, money, sourceLabel, format] = await Promise.all([
    listWatches(db, user.id),
    getTranslations(),
    getMoney(),
    sourceLabels(),
    getFormatter(),
  ]);
  const day = (d: string) =>
    format.dateTime(new Date(`${d}T00:00:00Z`), { dateStyle: 'medium', timeZone: 'UTC' });
  const [values, images, supply, timing, checks, states] = await Promise.all([
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
    askChecks(
      db,
      rows.map((r) => r.product),
    ),
    wishStates(
      db,
      rows.map((r) => r.product),
    ),
  ]);
  // A game wish's card (S36 C2): the cheapest checked copy as paid, the level and the person's
  // price, from the loader the wish page uses; no verdict.
  const games = await wishViews(
    db,
    user.id,
    rows.filter((r) => states.get(r.product.id)?.state !== 'not_game').map((r) => r.watch.id),
    { detail: false },
  );
  const typeLabel = (type: string) =>
    t.has(`sourceRoles.class.${type}`) ? t(`sourceRoles.class.${type}`) : type;
  const items = rows.map((r) => {
    const value = values.get(bucketValueKey(r.product.id, r.watch.bucket || null));
    const now = value?.valuation.unitBase ?? null;
    const target = r.watch.targetPriceBase;
    const state = states.get(r.product.id)?.state ?? 'not_game';
    const game = games.get(r.watch.id) ?? null;
    if (state !== 'not_game') {
      // The cheapest checked copy of N at its counted price: a copy of unknown shipping counts on its
      // stored price and is said "plus shipping" (S36 C2, C3; fix round 2, item 5).
      const cheapest = game?.cheapest?.counted ?? null;
      return {
        ...r,
        state,
        game,
        now: null,
        ask: null,
        unverified: null,
        judged: null,
        last: null,
        gap: cheapest !== null && target ? cheapest - target : null,
      };
    }
    if (!showsPrices(state))
      return {
        ...r,
        state,
        game,
        now: null,
        ask: null,
        unverified: null,
        judged: null,
        last: null,
        gap: null,
      };
    // The gap and the order use the price to act on (S36 A2: a game's cheapest checked ask; cards
    // and sealed: every ask, as before); a cheaper unverified one is only mentioned, muted.
    const { ask, unverified } = chooseAsk(
      supply.get(r.product.id) ?? [],
      r.watch.bucket,
      checks.status,
    );
    // The value or the lowest ask, whichever is closer to the target.
    const near = [now, ask?.lowestAskBase ?? null].filter((n): n is number => n !== null);
    // Buy timing (S9 part 4) by the person's strategy for the item's type.
    const stats = timing.get(`${r.product.id}|${r.watch.bucket}`)?.stats ?? null;
    const judged = stats
      ? judge(stats, strategyOf(user.preferences, productClass(r.product)))
      : null;
    return {
      ...r,
      state,
      game,
      now,
      ask,
      unverified,
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
          {items.map(({ watch, product, state, game, now, ask, unverified, last, gap, judged }) => {
            const details = [
              lotConditionLabel(watch, product, t),
              t(`kind.${product.kind}`),
              franchiseLabel(product.franchise, t),
            ].filter(Boolean);
            const target = watch.targetPriceBase;
            return (
              // The whole row opens the item (the name's link covers it), and the unverified note's
              // tap hint sits above that cover: a button may not be inside a link.
              <li
                key={watch.id}
                className="relative px-3 py-3 transition-colors hover:bg-accent/50"
              >
                <div className="flex items-center gap-3">
                  <ProductImage
                    product={product}
                    version={images.get(product.id)}
                    className="size-14 shrink-0"
                  />
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="line-clamp-2 text-sm leading-snug font-medium">
                      <Link
                        href={
                          state !== 'not_game'
                            ? `/watchlist/${watch.id}`
                            : `/products/${product.id}/buy${watch.bucket ? `?condition=${encodeURIComponent(watch.bucket)}` : ''}`
                        }
                        className="after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
                      >
                        {product.name}
                      </Link>
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{details.join(' · ')}</p>
                    {watch.note && (
                      <p className="truncate text-xs text-muted-foreground">{watch.note}</p>
                    )}
                    {state !== 'not_game' && (
                      <p className="text-xs">
                        <Link
                          href={`/watchlist/${watch.id}/check`}
                          className={cn(
                            'relative z-10 inline-flex min-h-6 items-center rounded-full px-2 font-medium underline-offset-2 hover:underline',
                            state === 'check_needed'
                              ? 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200'
                              : 'bg-muted text-foreground',
                          )}
                        >
                          {t(`wish.state.${state}`)}
                        </Link>
                      </p>
                    )}
                  </div>
                  {state !== 'not_game' ? (
                    <GameCardPrices
                      game={game}
                      state={state}
                      target={target}
                      gap={gap}
                      t={t}
                      money={money}
                      day={day}
                    />
                  ) : (
                    <div className="max-w-[45%] shrink-0 space-y-0.5 text-right text-sm">
                      <p
                        className={
                          now !== null ? 'font-medium tabular-nums' : 'text-muted-foreground'
                        }
                      >
                        {now !== null
                          ? money(now)
                          : t(!ask && unverified ? 'askCheck.noChecked' : 'watchlist.noPrice')}
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
                      {unverified && (
                        <p className="text-xs">
                          <UnverifiedNote
                            align="end"
                            amount={money(unverified.lowestAskBase!)}
                            source={sourceLabel(unverified.source)}
                          />
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
                  )}
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
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * A game wish's prices on its card (S36 C2; fix round 1, item 20), in the page's order: the
 * cheapest checked copy of the last run's day N, as paid ("plus shipping" when the added cost is
 * not known; N's date when N is not last night; none: "no checked copy" the same way), then the person's price with the difference, then the level, muted. Green only
 * for "at or under your price"; "check needed" shows only the person's price. No buy verdict.
 */
function GameCardPrices({
  game,
  state,
  target,
  gap,
  t,
  money,
  day,
}: {
  game: WishView | null;
  state: WishState;
  target: number | null;
  gap: number | null;
  t: Awaited<ReturnType<typeof getTranslations>>;
  money: Awaited<ReturnType<typeof getMoney>>;
  day: (d: string) => string;
}) {
  const priceLine = (
    <p
      className={cn(
        'text-xs tabular-nums',
        target && gap !== null && gap <= 0
          ? 'font-medium text-emerald-700 dark:text-emerald-400'
          : 'text-muted-foreground',
      )}
    >
      {!target
        ? t('wish.page.card.noPrice')
        : gap !== null && gap <= 0
          ? t('wish.page.card.under', { target: money(target) })
          : gap !== null
            ? t('wish.page.card.over', { amount: money(gap), target: money(target) })
            : t('wish.page.card.price', { target: money(target) })}
    </p>
  );
  if (state === 'check_needed')
    return (
      <div className="max-w-[45%] shrink-0 space-y-0.5 text-right text-sm">
        <p className="text-muted-foreground">{t('wish.needsCheck')}</p>
        {priceLine}
      </div>
    );
  const c = game?.cheapest ?? null;
  const level = game?.level?.current.level ?? null;
  const amount = c
    ? c.paid.known
      ? money(c.paid.amount)
      : t('wish.page.plusShipping', { amount: money(c.price) })
    : null;
  return (
    <div className="max-w-[45%] shrink-0 space-y-0.5 text-right text-sm">
      <p className={amount ? 'font-medium tabular-nums' : 'text-muted-foreground'}>
        {c && amount
          ? game?.night
            ? t('wish.page.card.cheapest', { amount })
            : t('wish.page.card.cheapestOld', { amount, date: day(c.day) })
          : game?.night
            ? t('wish.page.card.noCopyLast')
            : game?.lastRun
              ? t('wish.page.card.noCopyOld', { date: day(game.lastRun) })
              : t('wish.page.card.noCopy')}
      </p>
      {priceLine}
      <p className="text-xs text-muted-foreground tabular-nums">
        {level !== null
          ? t('wish.page.card.level', { amount: money(level) })
          : t('wish.page.card.noLevel')}
      </p>
    </div>
  );
}
