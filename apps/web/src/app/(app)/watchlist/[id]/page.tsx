import {
  KIND_CASE_MONTHS,
  type LevelChange,
  type Paid,
  WISH_TRIAL_NIGHTS,
  localDate,
  parseWishState,
} from '@tora/core';
import {
  type WishCopy,
  type WishEstimateView,
  type WishHistoryLine,
  type WishShopEntry,
  type WishSourceView,
  type WishView,
  gameShopPage,
  kindCases,
  wishView,
} from '@tora/db';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import { InfoTag } from '@/app/(app)/opportunities/info-tag';
import { AmountsToggle } from '@/components/amounts-toggle';
import { PriceChart } from '@/components/charts/price-chart';
import { UnverifiedNote } from '@/components/unverified-note';
import { Button } from '@/components/ui/button';
import { authed } from '@/lib/auth/guard';
import { makeMoney } from '@/lib/money';
import { getMoney } from '@/lib/money-server';
import { lotConditionLabel, bucketLabel } from '@/lib/product-display';
import { sourceLabels } from '@/lib/sources';
import { cn } from '@/lib/utils';
import { withdrawFactAction } from './actions';
import { EstimateForm, FactForm, PriceForms } from './forms';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('wish.page'))('title') };
}

const LEVEL_SOURCE = 'level';
/** Copies listed per source before "show N more" (fix round 1, item 13). */
const SHOWN_COPIES = 3;

/**
 * A game wish's page (S36 C2, spec W15): the copies buyable after the last nightly read, the level
 * (Terms "Level"), its bounds, estimates, facts and history. The person's own game wish only: another
 * person's wish is not found (`wishView` reads it for its owner only), and a card or sealed wish has
 * no such page, it opens the item's buy page as before. "Check needed" shows only the shop's copies
 * and the link to the check (S36 A2: nothing from unchecked sales).
 */
export default async function WishPage({ params }: { params: Promise<{ id: string }> }) {
  const { db, user } = await authed();
  const { id } = await params;
  const v = await wishView(db, user.id, id, { role: user.role });
  if (!v) notFound();
  if (v.state === 'not_game')
    redirect(
      `/products/${v.product.id}/buy${v.watch.bucket ? `?condition=${encodeURIComponent(v.watch.bucket)}` : ''}`,
    );
  const [shopPage, tAll, t, money, sourceLabel, format, locale] = await Promise.all([
    gameShopPage(db, v.product.id),
    getTranslations(),
    getTranslations('wish.page'),
    getMoney(),
    sourceLabels(),
    getFormatter(),
    getLocale(),
  ]);
  const day = (d: string) =>
    format.dateTime(new Date(`${d}T00:00:00Z`), { dateStyle: 'medium', timeZone: 'UTC' });
  const when = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'medium' });
  const share = (s: number) =>
    format.number(s, { style: 'percent', maximumFractionDigits: 1, signDisplay: 'exceptZero' });
  const signed = (n: number) => (n > 0 ? `+${money(n)}` : money(n));
  const change = (c: LevelChange) =>
    t('changeText', { amount: signed(c.amount), share: share(c.share), from: day(c.from.day) });
  // As paid (Terms "As paid"): the stored price plus what the buyer adds; not known is said, never 0.
  const paid = (price: number, p: Paid) =>
    p.known ? money(p.amount) : t('plusShipping', { amount: money(price) });
  const checked = v.state === 'confirmed';

  const section = (title: React.ReactNode, body: React.ReactNode, extra?: React.ReactNode) => (
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">{title}</h2>
        {extra}
      </div>
      {body}
    </section>
  );
  // Said only on a source not read on N (its last read day), or one read on N that found nothing,
  // worded with last night or N's date (fix round 2, items 3 and 8).
  const readOn = (s: { day: string; current: boolean; none: boolean }) =>
    s.none ? (
      <span className="text-xs text-muted-foreground">
        {v.night !== null ? t('noneFound') : t('noneFoundOn', { date: day(s.day) })}
      </span>
    ) : s.current ? null : (
      <span className="text-xs text-muted-foreground">{t('lastRead', { date: day(s.day) })}</span>
    );

  const copyLine = (source: string, c: WishCopy) => (
    <li
      key={`${source}|${c.ref}`}
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 py-1.5"
    >
      <span className="min-w-0">
        {c.url ? (
          <a
            href={c.url}
            target="_blank"
            rel="noreferrer"
            className="line-clamp-2 break-words underline-offset-2 hover:underline"
          >
            {c.title || t('untitled', { source: sourceLabel(source) })}
          </a>
        ) : (
          <span className="line-clamp-2 break-words">
            {c.title || t('untitled', { source: sourceLabel(source) })}
          </span>
        )}
        <span className="block text-[11px] text-muted-foreground">
          {[c.seller, bucketLabel(c.bucket, tAll)].filter(Boolean).join(' · ')}
        </span>
      </span>
      <span className="text-right tabular-nums">{paid(c.price, c.paid)}</span>
    </li>
  );

  // Three copies per source; the rest behind "show N more", N from the source's count (item 13).
  const sourceBlock = (s: WishSourceView) => {
    const more = s.count - SHOWN_COPIES;
    return (
      <div key={s.source} className="space-y-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-medium">{sourceLabel(s.source)}</h3>
          {readOn(s)}
        </div>
        {s.none ? null : s.status === 'unverified' ? (
          <p className="text-xs">
            {s.unverifiedPrice !== null && (
              <UnverifiedNote amount={money(s.unverifiedPrice)} source={sourceLabel(s.source)} />
            )}{' '}
            <Link
              href={`/watchlist/${v.watch.id}/check`}
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              {tAll('wish.checkLink')}
            </Link>
          </p>
        ) : s.copies.length ? (
          <>
            <ul className="divide-y text-sm">
              {s.copies.slice(0, SHOWN_COPIES).map((c) => copyLine(s.source, c))}
            </ul>
            {more > 0 && (
              <details className="text-sm">
                <summary className="min-h-8 cursor-pointer text-xs text-muted-foreground">
                  {s.capped ? t('showMoreCapped', { count: more }) : t('showMore', { count: more })}
                </summary>
                <ul className="divide-y">
                  {s.copies.slice(SHOWN_COPIES).map((c) => copyLine(s.source, c))}
                </ul>
                {s.count > s.copies.length && (
                  <p className="text-xs text-muted-foreground">
                    {t('moreCopies', { count: s.count - s.copies.length })}
                  </p>
                )}
              </details>
            )}
          </>
        ) : (
          <p className="text-xs text-muted-foreground">{t('noCopies')}</p>
        )}
        {s.apart.length > 0 && (
          <details className="text-xs">
            <summary className="min-h-8 cursor-pointer text-muted-foreground">
              {t('apart', { count: s.apart.length, label: bucketLabel('cond:used', tAll) })}
            </summary>
            <ul className="divide-y text-sm">{s.apart.map((c) => copyLine(s.source, c))}</ul>
          </details>
        )}
      </div>
    );
  };

  const shopEntry = (e: WishShopEntry, i: number) => (
    <li key={i} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 py-1.5">
      <span className="min-w-0">
        {e.url ? (
          <a
            href={e.url}
            target="_blank"
            rel="noreferrer"
            className="underline-offset-2 hover:underline"
          >
            {bucketLabel(e.bucket, tAll)}
          </a>
        ) : (
          bucketLabel(e.bucket, tAll)
        )}
        {(e.seller || e.stock !== null) && (
          <span className="block text-[11px] text-muted-foreground">
            {[e.seller, e.stock !== null && t('stock', { count: e.stock })]
              .filter(Boolean)
              .join(' · ')}
          </span>
        )}
      </span>
      <span className="text-right tabular-nums">{paid(e.price, e.paid)}</span>
    </li>
  );

  const copies = section(
    t('copies'),
    <div className="space-y-4">
      {v.night === null && (
        <p className="text-sm text-muted-foreground">
          {v.lastRun ? t('staleNight', { date: day(v.lastRun) }) : t('noNight')}
        </p>
      )}
      {v.shop.map((shop) => {
        const own = shop.entries.filter((e) => e.kind !== 'outside');
        const outside = shop.entries.filter((e) => e.kind === 'outside');
        return (
          <div key={shop.source} className="space-y-1">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-medium">{sourceLabel(shop.source)}</h3>
              {readOn(shop)}
            </div>
            {shop.outOfStock && <p className="text-xs text-muted-foreground">{t('outOfStock')}</p>}
            {own.length > 0 && <ul className="divide-y text-sm">{own.map(shopEntry)}</ul>}
            {outside.length > 0 && (
              <>
                <h4 className="pt-1 text-xs font-medium text-muted-foreground">
                  {t('outside', { shop: sourceLabel(shop.source) })}
                </h4>
                <ul className="divide-y text-sm">
                  {outside.slice(0, SHOWN_COPIES).map(shopEntry)}
                </ul>
                {outside.length > SHOWN_COPIES && (
                  <details className="text-sm">
                    <summary className="min-h-8 cursor-pointer text-xs text-muted-foreground">
                      {t('showMore', { count: outside.length - SHOWN_COPIES })}
                    </summary>
                    <ul className="divide-y">{outside.slice(SHOWN_COPIES).map(shopEntry)}</ul>
                  </details>
                )}
              </>
            )}
          </div>
        );
      })}
      {checked && v.sources.map(sourceBlock)}
      {!v.shop.length && !(checked && v.sources.length) && v.lastRun !== null && (
        <p className="text-sm text-muted-foreground">{t('noCopies')}</p>
      )}
      {v.credits.length > 0 && (
        <ul className="space-y-0.5 text-[11px] text-muted-foreground">
          {v.credits.map((c) => (
            <li key={c.source}>
              <a href={c.url} target="_blank" rel="noreferrer" className="underline">
                {c.text}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>,
  );

  // The alert in words (S36 C3): why none comes, or what it counts; and how often the wish was in.
  const target = v.watch.targetPriceBase;
  const unreadable = parseWishState(v.watch.alertState?.wish) === 'invalid';
  const alertWords = [
    target === null && t('noPriceAlert'),
    v.checkWhy && t('checkAlert', { why: t(`checkWhy.${v.checkWhy}`) }),
    // An alert will come: said too, with whether a copy was there at the last read; none can while
    // no source's listings are checked.
    target !== null &&
      !v.checkWhy &&
      !unreadable &&
      t(
        v.listingsUnread
          ? 'alertUnread'
          : v.cheapest && v.cheapest.counted <= target
            ? 'alertOnOne'
            : 'alertOnNone',
      ),
    v.needsCondition && t('anyCondition'),
    unreadable && t('invalidState'),
  ].filter((x): x is string => !!x);
  const trial =
    v.trial &&
    t(v.trial.counted < WISH_TRIAL_NIGHTS ? 'trialSoFar' : 'trial', {
      in: v.trial.in,
      counted: v.trial.counted,
    });
  const term = (label: string, value: React.ReactNode) => (
    <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words">{value}</dd>
    </div>
  );
  // The saved-search helper (S36 C4), behind an expander: the search as sent, to copy.
  const helper = v.helper.length > 0 && (
    <details className="text-sm">
      <summary className="min-h-8 cursor-pointer text-muted-foreground">{t('helper')}</summary>
      <p className="max-w-prose text-xs text-muted-foreground">{t('helperNote')}</p>
      {v.helper.map((h) => (
        <div key={h.source} className="mt-2 space-y-0.5">
          <h3 className="font-medium">{sourceLabel(h.source)}</h3>
          <dl className="space-y-0.5">
            {term(t('helperWords'), <span className="select-all">{h.words.join(' ')}</span>)}
            {h.excluded.length > 0 &&
              term(t('helperExcluded'), <span className="select-all">{h.excluded.join(' ')}</span>)}
            {h.categoryId !== null &&
              term(
                t('helperCategory'),
                h.categoryUrl ? (
                  <a href={h.categoryUrl} target="_blank" rel="noreferrer" className="underline">
                    {t('helperCategoryLink')}
                  </a>
                ) : (
                  t('helperCategoryId', { id: h.categoryId })
                ),
              )}
            {h.cap !== null &&
              term(
                t('helperCap'),
                h.plusShipping ? t('helperCapShipping', { amount: money(h.cap) }) : money(h.cap),
              )}
          </dl>
        </div>
      ))}
    </details>
  );
  const price = section(
    t('settings'),
    <>
      {alertWords.map((w) => (
        <p key={w} className="max-w-prose text-sm">
          {w}
        </p>
      ))}
      <PriceForms wishId={v.watch.id} target={v.watch.targetPriceBase} bucket={v.watch.bucket} />
      {trial && <p className="max-w-prose text-sm tabular-nums">{trial}</p>}
      {helper}
    </>,
  );

  // The facts line (item 12): what is known, no verdict and no color; unknown parts left out. The
  // cheapest is N's only, "as of <date>" only when N is not last night (fix round 2, items 4, 8).
  const c = v.cheapest;
  const levelNow = checked ? (v.level?.current.level ?? null) : null;
  const line = [
    c
      ? v.night !== null
        ? t('line.cheapest', { amount: paid(c.price, c.paid), source: sourceLabel(c.source) })
        : t('line.cheapestOld', {
            amount: paid(c.price, c.paid),
            source: sourceLabel(c.source),
            date: day(c.day),
          })
      : v.night !== null
        ? t('line.noCopy')
        : v.lastRun !== null
          ? t('line.noCopyOld', { date: day(v.lastRun) })
          : t('line.noCopyNone'),
    levelNow !== null && t('line.level', { amount: money(levelNow) }),
    v.watch.targetPriceBase !== null && t('line.price', { amount: money(v.watch.targetPriceBase) }),
  ]
    .filter(Boolean)
    .join(' · ');
  const factsLine = line && (
    <p className="text-sm tabular-nums">{line.charAt(0).toUpperCase() + line.slice(1)}</p>
  );

  const header = (
    <header className="space-y-1">
      <Link
        href="/watchlist"
        className="inline-flex min-h-9 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> {t('back')}
      </Link>
      <div className="flex items-center gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{v.product.name}</h1>
        <AmountsToggle />
      </div>
      <p className="text-sm text-muted-foreground">
        {[lotConditionLabel(v.watch, v.product, tAll), tAll(`wish.state.${v.state}`)]
          .filter(Boolean)
          .join(' · ')}{' '}
        <Link
          href={`/products/${v.product.id}`}
          className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
        >
          {t('itemPage')} <ExternalLink className="size-3" aria-hidden />
        </Link>
      </p>
      {factsLine}
      {/* The shop's page is linked by a person: until then its prices and facts are not read. */}
      {shopPage.state !== 'linked' && (
        <p className="max-w-prose text-sm text-amber-700 dark:text-amber-300">
          {shopPage.state === 'pending'
            ? t('shopPending', { count: shopPage.pending })
            : t('shopNone')}{' '}
          <Link
            href={`/products/${v.product.id}/details#sources`}
            className="underline underline-offset-2"
          >
            {t('shopLink')}
          </Link>
        </p>
      )}
    </header>
  );

  if (!checked)
    return (
      <div className="space-y-5">
        {header}
        {/* The warning and the shop's copies side by side from half a widescreen up (item 11). */}
        <div className="grid items-start gap-5 xl:grid-cols-2">
          <div className="space-y-2 rounded-lg border border-amber-500/50 bg-amber-50 px-4 py-3 text-sm xl:col-start-1 dark:bg-amber-950/40">
            <p className="max-w-prose">{t('checkNeeded')}</p>
            <Button asChild size="sm">
              <Link href={`/watchlist/${v.watch.id}/check`}>{tAll('wish.checkLink')}</Link>
            </Button>
            <p className="max-w-prose text-xs text-muted-foreground">{t('checkWhat')}</p>
          </div>
          <div className="xl:col-start-2 xl:row-span-2 xl:row-start-1">{copies}</div>
          <div className="xl:col-start-1">{price}</div>
        </div>
      </div>
    );

  const b = v.bounds;
  const hasBounds = !!(b?.buyback || b?.newCopy || b?.listPrice);
  // Nothing recorded at all: one card with the two "add" actions, not four empty ones (item 17).
  const empty =
    !v.estimates.length && !v.facts.length && !v.recorded.length && !hasBounds && !v.history.length;
  // The estimate form's helper (spec wishlist-tracked, Cases): tracked games of its kind, read-only,
  // in the wish's condition (good when it has none, said in the table's line).
  const kindBucket = v.watch.bucket || 'cond:good';
  const kinds = await kindCases(db, v.product.id, kindBucket);
  const addEstimate = (
    <details>
      <summary className="min-h-9 cursor-pointer text-sm font-medium text-primary">
        {t('estimate.open')}
      </summary>
      <div className="mt-3 space-y-3">
        {kindsTable(kinds, kindBucket, v.product.platform, { t, tAll, money, day, locale })}
        <EstimateForm wishId={v.watch.id} />
      </div>
    </details>
  );
  const addFact = (
    <details>
      <summary className="min-h-9 cursor-pointer text-sm font-medium text-primary">
        {t('fact.open')}
      </summary>
      <div className="mt-3">
        <FactForm wishId={v.watch.id} today={localDate()} />
      </div>
    </details>
  );

  const recordedCards = empty ? (
    section(
      t('empty'),
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">{t('emptyText')}</p>
        {addEstimate}
        {addFact}
      </div>,
    )
  ) : (
    <>
      {section(
        t('estimates'),
        <div className="space-y-4">
          {v.estimates.length > 0 ? (
            <ul className="space-y-3">
              {v.estimates.map((e) => estimateLine(e, { t, tAll, money, day, when, locale }))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t('noEstimates')}</p>
          )}
          {addEstimate}
        </div>,
      )}
      {section(
        t('facts'),
        <div className="space-y-3">
          {v.facts.length === 0 && v.recorded.length === 0 && (
            <p className="text-sm text-muted-foreground">{t('noFacts')}</p>
          )}
          {v.facts.length > 0 && (
            <ul className="space-y-1 text-sm">
              {v.facts.map((f, i) => (
                <li key={i}>
                  {f.kind === 'buyback_change'
                    ? t('fact.buybackChange', {
                        source: sourceLabel(f.source),
                        change: change(f.change),
                      })
                    : f.kind === 'shop_out'
                      ? t('fact.shopOut', {
                          source: sourceLabel(f.source),
                          nights: f.nights,
                          since: day(f.since),
                        })
                      : t('fact.noNewCopy', { nights: f.nights, since: day(f.since) })}
                </li>
              ))}
            </ul>
          )}
          {v.recorded.length > 0 && (
            <ul className="divide-y text-sm">
              {v.recorded.map((f) => (
                <li key={f.id} className="flex items-start justify-between gap-3 py-1.5">
                  <span className="min-w-0">
                    <span className="font-medium">{day(f.day)}</span> · {t(`factKind.${f.kind}`)}
                    {f.text && `: ${f.text}`}
                    <span className="block text-[11px] text-muted-foreground">
                      {t('recordedBy', {
                        name: f.recordedByName ?? t('someone'),
                        date: when(f.recordedAt),
                      })}
                      {f.sourceUrl && (
                        <>
                          {' · '}
                          <a
                            href={f.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="underline"
                          >
                            {t('fact.source')}
                          </a>
                        </>
                      )}
                    </span>
                  </span>
                  {f.mayDelete && (
                    <form action={withdrawFactAction.bind(null, v.watch.id, f.id)}>
                      <Button type="submit" variant="ghost" size="sm" className="h-7 px-2 text-xs">
                        {t('fact.delete')}
                      </Button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
          {addFact}
        </div>,
      )}
      {section(
        t('history'),
        <div className="space-y-2">
          {v.history.length ? (
            <ul className="space-y-1 text-sm">
              {v.history.map((h) => historyLine(h, { t, day, sourceLabel }))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t('noHistory')}</p>
          )}
        </div>,
      )}
    </>
  );

  // Three columns on a full widescreen (copies | level and limits | estimates, facts, history), two
  // from half a widescreen (copies and the price form | the rest), one on the phone (item 11). Each
  // column stacks its cards, so a short card leaves no hole beside a tall one. The two widths' grid
  // classes never overlap (fix round 2, item 6): `xl:grid-cols-2` would win over the wider one.
  return (
    <div className="space-y-5">
      {header}
      <div className="grid items-start gap-5 xl:max-[2559px]:grid-cols-2 min-[2560px]:grid-cols-3">
        <div className="flex flex-col gap-5">
          {copies}
          {price}
        </div>
        <div className="flex flex-col gap-5 min-[2560px]:col-span-2 min-[2560px]:grid min-[2560px]:grid-cols-2 min-[2560px]:items-start">
          <div className="flex flex-col gap-5">
            {levelSection(v, { t, money, day, change, sourceLabel, locale })}
            {!empty && boundsSection(v, { t, money, day, change, sourceLabel, locale, paid })}
          </div>
          <div className="flex flex-col gap-5">{recordedCards}</div>
        </div>
      </div>
    </div>
  );
}

type T = Awaited<ReturnType<typeof getTranslations<'wish.page'>>>;
type Money = Awaited<ReturnType<typeof getMoney>>;
interface Tools {
  t: T;
  money: Money;
  day: (d: string) => string;
  change: (c: LevelChange) => string;
  sourceLabel: (s: string) => string;
  locale: string;
}

/**
 * The level (Terms "Level"): today's with its count, window and 4-week change; the chart of the
 * level over time, with the record line only while records are shown (`wishRecordShown`). No
 * level: why, with the first day a window would be whole when a hole is the cause; the 90 days'
 * low and high only when their as-paid prices are known.
 */
function levelSection(v: WishView, { t, money, day, change, sourceLabel }: Tools) {
  const l = v.level;
  const c = l?.current;
  const box = (body: React.ReactNode, sub = false) => (
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <div>
        <h2 className="font-semibold">{t('level.title')}</h2>
        {sub && <p className="text-xs text-muted-foreground">{t('level.sub')}</p>}
      </div>
      {body}
    </section>
  );
  // No condition chosen: no level, and that is the reason said (fix round 1, item 8).
  if (v.needsCondition)
    return box(<p className="text-sm text-muted-foreground">{t('level.needsCondition')}</p>);
  if (!l || !c) return box(<p className="text-sm text-muted-foreground">{t('level.notYet')}</p>);
  const how = (
    <details className="text-xs">
      <summary className="min-h-8 cursor-pointer text-muted-foreground">{t('level.how')}</summary>
      <div className="mt-1 space-y-1 text-muted-foreground">
        <p>{t('level.rule')}</p>
        {c.sources.length > 0 && (
          <p>{t('level.counted', { list: c.sources.map((s) => sourceLabel(s)).join(', ') })}</p>
        )}
        {Object.entries(c.left ?? {}).map(([s, why]) => (
          <p key={s}>{t(`level.left.${why}`, { source: sourceLabel(s) })}</p>
        ))}
        {Object.entries(c.rowsUnknown ?? {}).map(([s, n]) => (
          <p key={s}>{t('level.rowsUnknown', { source: sourceLabel(s), count: n })}</p>
        ))}
      </div>
    </details>
  );
  if (c.level === null) {
    const reason =
      c.reason === 'not_covered'
        ? c.wholeOn
          ? t('level.hole', { date: day(c.wholeOn) })
          : t('level.holeNoDay')
        : c.reason === 'cost_unknown'
          ? t('level.costUnknown')
          : t('level.tooFew', { count: c.n });
    return box(
      <div className="space-y-2 text-sm">
        <p>{reason}</p>
        {c.n > 0 && c.low !== null && c.high !== null ? (
          <p className="text-muted-foreground">
            {t('level.range90', { count: c.n, low: money(c.low), high: money(c.high) })}
          </p>
        ) : (
          // Said once: the cost-unknown reason already says it (item 17).
          c.reason !== 'cost_unknown' &&
          c.unknownCost > 0 && <p className="text-muted-foreground">{t('level.noPaid')}</p>
        )}
        {how}
      </div>,
    );
  }
  const record = l.record;
  return box(
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="text-2xl font-semibold tabular-nums">{money(c.level)}</p>
        <InfoTag
          label={t('level.basis', { count: c.n, window: c.window, date: day(c.day) })}
          className="px-0 py-0 font-normal text-muted-foreground"
        >
          <span className="block">{t('level.rule')}</span>
        </InfoTag>
      </div>
      <p className="text-sm">
        {l.change ? t('level.change', { change: change(l.change) }) : t('level.noChange')}
      </p>
      {record && (
        <p className="text-sm text-muted-foreground">
          {t('level.record', { amount: money(record.level), date: day(record.day) })}
          {l.nearLow && (
            <span className="ml-2 rounded bg-emerald-100 px-1.5 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
              {t('level.nearLow')}
            </span>
          )}
        </p>
      )}
      {l.young?.young && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {t('level.young', { days: l.young.ageDays })}
        </p>
      )}
      {l.series.length > 1 && (
        <PriceChart
          points={l.series.map((d) => ({
            day: d.day,
            source: LEVEL_SOURCE,
            bucket: v.watch.bucket,
            medianBase: d.level,
            count: d.n,
            estimated: 0,
          }))}
          defaultBucket={v.watch.bucket}
          sourceLabels={{ [LEVEL_SOURCE]: t('level.title') }}
          hideBuckets
          summary={t('level.days', { count: l.series.length })}
          marks={
            record
              ? [
                  {
                    price: record.level,
                    title: t('level.recordShort'),
                    legend: t('level.record', {
                      amount: money(record.level),
                      date: day(record.day),
                    }),
                  },
                ]
              : undefined
          }
        />
      )}
      {how}
    </div>,
    true,
  );
}

/**
 * The bounds (S36 C1 "Bounds"): the shop's buyback price under, the cheapest new copy over (naming
 * its source), the list price as the shop shows it, in its own currency (its share waits for A5).
 * Each is left out when unknown, never shown as 0.
 */
function boundsSection(
  v: WishView,
  {
    t,
    money,
    day,
    change,
    sourceLabel,
    locale,
    paid,
  }: Tools & { paid: (price: number, p: Paid) => string },
) {
  const b = v.bounds;
  // Each number with its label ("Shop buys at", "New copy from", "List price"; item 14).
  const row = (key: string, label: string, amount: string, detail: React.ReactNode) => (
    <div key={key} className="contents">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>
        <span className="font-medium tabular-nums">{amount}</span>
        <span className="block text-xs text-muted-foreground">{detail}</span>
      </dd>
    </div>
  );
  const rows = [
    b?.buyback &&
      row(
        'buyback',
        t('bounds.buybackLabel'),
        money(b.buyback.price),
        <>
          {t('bounds.buyback', { source: sourceLabel(b.buyback.source), date: day(b.buyback.day) })}
          {b.buyback.change && <span className="block">{change(b.buyback.change)}</span>}
        </>,
      ),
    b?.newCopy &&
      row(
        'new',
        t('bounds.newCopyLabel'),
        paid(b.newCopy.price, b.newCopy.paid),
        t('bounds.newCopy', { source: sourceLabel(b.newCopy.source), date: day(b.newCopy.day) }),
      ),
    b?.listPrice &&
      row(
        'list',
        t('bounds.listLabel'),
        makeMoney({ base: b.listPrice.currency, locale })(b.listPrice.amount),
        <>
          {t(`bounds.list.${b.listPrice.tax}`, { source: sourceLabel(b.listPrice.source) })}
          {b.listPrice.seenAt && (
            <span className="block">
              {t('bounds.seen', { date: day(b.listPrice.seenAt.slice(0, 10)) })}
            </span>
          )}
        </>,
      ),
  ].filter(Boolean);
  return (
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <h2 className="font-semibold">{t('bounds.title')}</h2>
      {rows.length ? (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">{rows}</dl>
      ) : (
        <p className="text-sm text-muted-foreground">{t('bounds.none')}</p>
      )}
    </section>
  );
}

/**
 * "Games of its kind" (spec wishlist-tracked, Cases): the tracked games kindCases gives, with the
 * basis said (same maker or series, or the console only) and a month's column only where at least
 * one case has a level (none has one until someone wished and checked it: said in a line, never 0).
 * No model, no prediction. The list price keeps its own currency.
 */
function kindsTable(
  k: Awaited<ReturnType<typeof kindCases>>,
  bucket: string,
  platform: string | null,
  {
    t,
    tAll,
    money,
    day,
    locale,
  }: Pick<Tools, 't' | 'money' | 'day' | 'locale'> & {
    tAll: Awaited<ReturnType<typeof getTranslations>>;
  },
) {
  const months = KIND_CASE_MONTHS.filter((m) => k.counts[m] > 0);
  const console = platform ?? k.console ?? '';
  const pct = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 });
  return (
    <details className="rounded-lg border px-3 py-2 text-sm">
      <summary className="min-h-8 cursor-pointer font-medium">
        {t('kinds.open')} ({k.cases.length})
      </summary>
      <div className="mt-2 space-y-2">
        <p className="text-xs text-muted-foreground">
          {k.basis === null ? t('kinds.unknown') : t(`kinds.${k.basis}`, { console })}
        </p>
        {k.basis !== null && !k.cases.length && (
          <p className="text-xs text-muted-foreground">{t('kinds.none')}</p>
        )}
        {k.cases.length > 0 && !months.length && (
          <p className="text-xs text-muted-foreground">{t('kinds.noLevels')}</p>
        )}
        {months.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {t('kinds.condition', { condition: bucketLabel(bucket, tAll) })}
          </p>
        )}
        {k.cases.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3 font-normal">{t('kinds.name')}</th>
                  <th className="py-1 pr-3 font-normal">{t('kinds.released')}</th>
                  <th className="py-1 pr-3 text-right font-normal">{t('kinds.list')}</th>
                  {months.map((m) => (
                    <th key={m} className="py-1 pr-3 text-right font-normal">
                      {t('kinds.months', { months: m, count: k.counts[m] })}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {k.cases.map((c) => (
                  <tr key={c.productId}>
                    <td className="py-1 pr-3 break-words">{c.name}</td>
                    <td className="py-1 pr-3 whitespace-nowrap">
                      {c.releaseDate ? day(c.releaseDate) : '-'}
                    </td>
                    <td className="py-1 pr-3 text-right tabular-nums">
                      {c.listPrice
                        ? makeMoney({ base: c.listPrice.currency, locale })(c.listPrice.amount)
                        : '-'}
                    </td>
                    {months.map((m) => {
                      const at = c.at.find((a) => a.months === m);
                      return (
                        <td key={m} className="py-1 pr-3 text-right tabular-nums">
                          {at?.level != null ? money(at.level) : '-'}
                          {at?.ofList != null && (
                            <span className="block text-muted-foreground">
                              {t('kinds.ofList', { share: pct.format(at.ofList) })}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </details>
  );
}

/** An estimate, labeled as one, with its date and author, and what happened since. */
function estimateLine(
  e: WishEstimateView,
  {
    t,
    tAll,
    money,
    day,
    when,
    locale,
  }: Pick<Tools, 't' | 'money' | 'day' | 'locale'> & {
    tAll: Awaited<ReturnType<typeof getTranslations>>;
    when: (iso: string) => string;
  },
) {
  // An estimate in another currency than the base keeps its own (money carries its currency).
  const own = e.currency === money.base ? money : makeMoney({ base: e.currency, locale });
  const o = e.outcome;
  return (
    <li key={e.id} className="space-y-0.5 text-sm">
      <p>
        <span className="rounded bg-muted px-1.5 text-xs font-medium">{t('estimate.label')}</span>{' '}
        <span className="font-medium tabular-nums">
          {t('estimate.range', { low: own(e.low), high: own(e.high) })}
        </span>
        {e.settleBy && ` · ${t('estimate.by', { month: e.settleBy })}`}
      </p>
      <p className="text-xs text-muted-foreground">
        {[
          e.basis && t(`basis.${e.basis}`),
          ...e.risks.map((r) => (r.kind === 'other' ? (r.text ?? '') : t(`risk.${r.kind}`))),
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
      <p className="text-xs text-muted-foreground">
        {t('estimate.entered', { name: e.author ?? t('someone'), date: when(e.enteredAt) })}
      </p>
      {e.sources.length > 0 && (
        <ul className="text-xs">
          {e.sources.map((s) => (
            <li key={s} className="truncate">
              {/^https?:\/\//.test(s) ? (
                <a href={s} target="_blank" rel="noreferrer" className="underline">
                  {s}
                </a>
              ) : (
                s
              )}
            </li>
          ))}
        </ul>
      )}
      {o && (
        <p
          className={cn(
            'text-xs',
            o.is === 'inside' && 'text-emerald-700 dark:text-emerald-400',
            (o.is === 'under' || o.is === 'over') && 'text-amber-700 dark:text-amber-400',
          )}
        >
          {o.is === 'other_condition'
            ? e.bucket
              ? t('outcome.otherCondition', { condition: bucketLabel(e.bucket, tAll) })
              : t('outcome.otherConditionOld')
            : o.is === 'pending'
              ? t('outcome.pending')
              : o.is === 'unknown' || o.level === null || o.day === null
                ? t(UNKNOWN_KEY[(o.is === 'unknown' && o.why) || 'no_level'])
                : t(`outcome.${o.is}`, { level: money(o.level), date: day(o.day) })}
        </p>
      )}
    </li>
  );
}

const UNKNOWN_KEY = {
  no_month: 'outcome.noMonth',
  no_level: 'outcome.noLevel',
  currency: 'outcome.currency',
} as const;

/** One compact line per source: its first covered day and count; the ranges behind an expander. */
function historyLine(
  h: WishHistoryLine,
  { t, day, sourceLabel }: { t: T; day: (d: string) => string; sourceLabel: (s: string) => string },
) {
  const range = ([a, b]: readonly [string, string]) =>
    a === b ? day(a) : t('range', { from: day(a), to: day(b) });
  return (
    <li key={h.source}>
      <details>
        <summary className="min-h-8 cursor-pointer">
          <span className="font-medium">{sourceLabel(h.source)}</span>:{' '}
          {h.first ? t('historyLine', { date: day(h.first), count: h.days }) : t('historyNone')}
          {h.job && (
            <span className="ml-1 text-amber-700 dark:text-amber-400">
              · {t(`job.${h.job.state}`, { kind: h.job.kind })}
            </span>
          )}
        </summary>
        <ul className="mt-1 space-y-0.5 pl-4 text-xs text-muted-foreground">
          {h.by.map((b) => (
            <li key={b.how}>
              {t(`how.${b.how}`)}: {b.ranges.map(range).join(', ')}
            </li>
          ))}
        </ul>
      </details>
    </li>
  );
}
