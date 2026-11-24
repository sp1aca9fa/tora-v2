import { TRACKED_PASTE_MAX, localDate, pickName } from '@tora/core';
import { getDb, listConsoles, listTrackedGames, trackedRestOn, trackedTotals } from '@tora/db';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import { adminOnly } from '@/lib/auth/guard';
import { sourceLabels } from '@/lib/sources';
import { cn } from '@/lib/utils';
import { TrackedAddForm } from './add-form';
import { RestSwitch, TrackedRowActions } from './tracked-controls';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('settings'))('section.tracked.title') };
}

/** The list's columns from half a widescreen up (phones: one card per game). */
const COLS =
  'xl:grid xl:grid-cols-[minmax(6rem,1fr)_minmax(9rem,2.5fr)_repeat(4,minmax(6rem,1fr))_minmax(8.5rem,auto)] xl:items-center xl:gap-3';

const PAGE = '/settings/admin/tracked';

/** The filter's value for a console key (`none`: the console is unknown). */
const filterKey = (key: string | null) => key ?? 'none';

/**
 * Tracked games (S36 step D, spec wishlist-tracked W18): console games read before anyone wishes
 * for them, install data of no person. Admins only (here and in every action). Phones: totals, the
 * add form, then a card per game; from `xl` the totals and the form side by side over the full-width
 * table; from `2xl` the table with a side column (form over totals); from 2400 px totals, table and
 * form in three columns. A filter by console when more than one has games (`?console=`).
 */
export default async function TrackedGamesPage({
  searchParams,
}: {
  searchParams: Promise<{ console?: string }>;
}) {
  const { user } = await adminOnly();
  const { console: picked } = await searchParams;
  const db = getDb();
  const [games, totals, restOn, consoles, label, t, format, locale] = await Promise.all([
    listTrackedGames(db, user.id),
    trackedTotals(db, user.id),
    trackedRestOn(db),
    listConsoles(db),
    sourceLabels(),
    getTranslations('tracked'),
    getFormatter(),
    getLocale(),
  ]);
  const today = localDate();
  const day = (d: string) =>
    format.dateTime(new Date(`${d.slice(0, 10)}T00:00:00Z`), {
      dateStyle: 'medium',
      timeZone: 'UTC',
    });
  const consoleName = (key: string | null) => {
    const row = consoles.find((c) => c.key === key);
    return row ? pickName(row.names, locale, row.key) : (key ?? t('unknownConsole'));
  };
  const perConsole = new Map<string | null, number>();
  for (const g of games) perConsole.set(g.console, (perConsole.get(g.console) ?? 0) + 1);
  const selected =
    perConsole.size > 1 && [...perConsole.keys()].some((k) => filterKey(k) === picked)
      ? picked
      : null;
  const shown = selected ? games.filter((g) => filterKey(g.console) === selected) : games;
  const n = totals.nightly;

  const totalsCard = (
    <section className="space-y-3 rounded-xl border bg-card p-4 text-sm">
      <h2 className="font-semibold">{t('totals', { count: games.length })}</h2>
      <div className="space-y-1">
        <h3 className="font-medium">{t('weekly')}</h3>
        {totals.weekly.length ? (
          <ul className="space-y-1">
            {totals.weekly.map((w) => (
              <li
                key={w.source}
                className={cn(w.perDayNeeded > w.perDay && 'text-amber-700 dark:text-amber-300')}
              >
                {t('weeklyNeed', {
                  source: label(w.source),
                  atLeast: w.atLeast ? 'yes' : 'no',
                  need: w.perDayNeeded,
                  perDay: w.perDay,
                  used: w.usedToday,
                })}
                {w.perDayNeeded > w.perDay && <span className="block">{t('overNumber')}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">{t('noWeekly')}</p>
        )}
      </div>
      <div className="space-y-1">
        <h3 className="font-medium">{t('nightly')}</h3>
        <p>
          {!n.source
            ? t('noShop')
            : n.minutes === null
              ? t('nightlyUnknown', { source: label(n.source), games: n.games })
              : t('nightlyMinutes', {
                  source: label(n.source),
                  games: n.games,
                  minutes: n.minutes,
                })}
        </p>
        {n.source && n.toConfirm > 0 && (
          <p className="text-muted-foreground">{t('nightlyToConfirm', { count: n.toConfirm })}</p>
        )}
      </div>
      <div className="border-t pt-3">
        <RestSwitch on={restOn} />
      </div>
    </section>
  );

  const value = (labelKey: string, text: React.ReactNode) => (
    <span className="block text-xs whitespace-nowrap text-muted-foreground xl:text-sm xl:text-foreground">
      <span className="xl:hidden">{t(labelKey)}: </span>
      {text}
    </span>
  );
  const filter = perConsole.size > 1 && (
    <nav aria-label={t('filter')} className="flex flex-wrap gap-1.5 text-sm">
      {[
        [null, t('filterAll', { count: games.length })] as const,
        ...[...perConsole].map(
          ([key, count]) => [filterKey(key), `${consoleName(key)} (${count})`] as const,
        ),
      ].map(([key, text]) => (
        <Link
          key={key ?? ''}
          href={key ? `${PAGE}?console=${encodeURIComponent(key)}` : PAGE}
          aria-current={selected === key ? 'page' : undefined}
          className={cn(
            'flex min-h-8 items-center rounded-full border px-3',
            selected === key
              ? 'border-primary bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {text}
        </Link>
      ))}
    </nav>
  );
  const shopText = (g: (typeof games)[number]) =>
    g.shop === 'linked' ? (
      t('shopLinked')
    ) : g.shop === 'pending' ? (
      <Link
        href={`/products/${g.productId}/details#sources`}
        className="text-primary hover:underline"
      >
        {t('shopToCheck', { count: g.toCheck })}
      </Link>
    ) : (
      <span className="text-muted-foreground">
        {t(g.shop === 'rest' ? 'shopRest' : 'shopNone')}
      </span>
    );
  const list = games.length ? (
    <div className="xl:rounded-xl xl:border xl:bg-card">
      <div className={cn('hidden px-3 py-2 text-xs text-muted-foreground', COLS)} aria-hidden>
        <span>{t('console')}</span>
        <span>{t('name')}</span>
        <span>{t('since')}</span>
        <span>{t('lastWeekly')}</span>
        <span>{t('onPc')}</span>
        <span>{t('shop')}</span>
        <span />
      </div>
      <ul className="grid gap-2 sm:grid-cols-2 xl:block xl:divide-y xl:border-t">
        {shown.map((g) => (
          <li
            key={g.productId}
            className={cn(
              'space-y-1 rounded-lg border p-3 xl:space-y-0 xl:rounded-none xl:border-0 xl:px-3 xl:py-1.5',
              COLS,
            )}
          >
            <span className="block text-xs text-muted-foreground xl:text-sm">
              {consoleName(g.console)}
            </span>
            <span className="block min-w-0 font-medium break-words">
              {g.name}
              {g.wished && (
                <span
                  title={t('wishedInfo')}
                  className="ml-2 rounded bg-muted px-1.5 text-xs font-normal"
                >
                  {t('wished')}
                </span>
              )}
              {g.tier === 'rest' && (
                <span className="ml-2 rounded border px-1.5 text-xs font-normal">
                  {t('tierName.rest')}
                </span>
              )}
            </span>
            {value('since', day(g.addedAt))}
            {value(
              'lastWeekly',
              g.tier === 'rest' ? (
                t('monthlyOnly')
              ) : g.lastWeeklyRead ? (
                day(g.lastWeeklyRead)
              ) : (
                <span className="text-muted-foreground">{t('noneYet')}</span>
              ),
            )}
            {g.onPc && g.onPcAt ? (
              value('onPc', day(g.onPcAt))
            ) : (
              <span className="hidden xl:block" />
            )}
            {value('shop', shopText(g))}
            <TrackedRowActions productId={g.productId} name={g.name} onPc={g.onPc} today={today} />
          </li>
        ))}
      </ul>
    </div>
  ) : (
    <p className="rounded-xl border p-4 text-sm text-muted-foreground">{t('empty')}</p>
  );

  return (
    <div className="space-y-4">
      <div className="space-y-1 text-sm text-muted-foreground">
        <p>{t('info')}</p>
        <details className="max-w-prose">
          <summary className="cursor-pointer">{t('more')}</summary>
          <p className="mt-1">{t('moreText')}</p>
          <p className="mt-1">{t('moreShop')}</p>
        </details>
      </div>
      <div className="grid items-start gap-5 xl:grid-cols-2 2xl:grid-cols-[minmax(0,1fr)_22rem] min-[2400px]:grid-cols-[22rem_minmax(0,1fr)_28rem]">
        <div className="min-w-0 xl:col-start-1 xl:row-start-1 2xl:col-start-2 2xl:row-start-2 min-[2400px]:col-start-1 min-[2400px]:row-start-1">
          {totalsCard}
        </div>
        <section className="min-w-0 space-y-3 rounded-xl border bg-card p-4 xl:col-start-2 xl:row-start-1 min-[2400px]:col-start-3">
          <h2 className="font-semibold">{t('add')}</h2>
          <TrackedAddForm max={TRACKED_PASTE_MAX} />
        </section>
        <div className="min-w-0 space-y-3 xl:col-span-2 xl:col-start-1 xl:row-start-2 2xl:col-span-1 2xl:row-span-2 2xl:row-start-1 min-[2400px]:col-start-2 min-[2400px]:row-span-1">
          {filter}
          {list}
        </div>
      </div>
    </div>
  );
}
