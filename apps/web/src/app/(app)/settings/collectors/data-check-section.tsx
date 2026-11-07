import { type DataCheckDescribed, type DataCheckKind, dataCheckLine } from '@tora/core';
import { dataCheckView } from '@tora/db';
import { getFormatter, getTranslations } from 'next-intl/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getMoney } from '@/lib/money-server';
import { bucketLabel } from '@/lib/product-display';
import { cn } from '@/lib/utils';
import type { authed } from '@/lib/auth/guard';

type Db = Awaited<ReturnType<typeof authed>>['db'];

/** Two mornings without a check: the page says so, not only `alerts after-run`. */
const STALE_DAYS = 2;

const STATUS_STYLE = {
  watching: 'text-emerald-700 dark:text-emerald-400',
  learning: 'text-muted-foreground',
  tooFew: 'text-muted-foreground',
  notSeen: 'text-amber-700 dark:text-amber-400',
} as const;
/** A source with an open finding never reads green beside its warning. */
const NEEDS_LOOK_STYLE = 'font-medium text-amber-700 dark:text-amber-400';

const runStale = (day: string) =>
  Date.now() - Date.parse(`${day}T12:00:00`) > STALE_DAYS * 86_400_000;

/**
 * Tora's check of its own data (S30), for admins: is it running, what is it watching, what is open.
 * Reads one setting row. Source findings first and item findings under them, in columns when wide.
 */
export async function DataCheckSection({ db }: { db: Db }) {
  const [view, t, format, money] = await Promise.all([
    dataCheckView(db),
    getTranslations(),
    getFormatter(),
    getMoney(),
  ]);
  const day = (d: string) => format.dateTime(new Date(`${d}T12:00:00`), { dateStyle: 'short' });
  const stale = view.lastRun && runStale(view.lastRun);
  const line = (f: DataCheckDescribed) => {
    const l = dataCheckLine(f, money, (b) => bucketLabel(b, t));
    return t(`alertText.${l.key}`, l.params);
  };
  // Open, but not firing on the last morning: what it says is from that day.
  const lastSeen = (f: DataCheckDescribed) =>
    view.lastRun && f.lastSeenOn < view.lastRun ? (
      <span className="text-xs text-muted-foreground">
        {' '}
        {t('settings.dataCheck.lastSeen', { date: day(f.lastSeenOn) })}
      </span>
    ) : null;
  const isItem = (kind: DataCheckKind) => kind === 'apart';
  const sources = view.open.filter((f) => !isItem(f.kind));
  const items = view.open.filter((f) => isItem(f.kind));
  const openSources = new Set(sources.map((f) => f.source));
  const nothingOpen = view.sources.some((s) => s.status === 'watching')
    ? 'settings.dataCheck.clear'
    : view.sources.some((s) => s.status === 'learning')
      ? 'settings.dataCheck.notYet'
      : null;
  return (
    <Card id="data-check" className="scroll-mt-20">
      <CardHeader>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <CardTitle>{t('settings.dataCheck.title')}</CardTitle>
          <p
            className={cn(
              'text-sm',
              !view.lastRun || stale ? 'font-medium text-destructive' : 'text-muted-foreground',
            )}
          >
            {!view.lastRun
              ? t('settings.dataCheck.never')
              : t(stale ? 'settings.dataCheck.stale' : 'settings.dataCheck.lastRun', {
                  date: day(view.lastRun),
                })}
          </p>
        </div>
        <CardDescription>{t('settings.dataCheck.info')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-x-8 gap-y-4 min-[2400px]:grid-cols-[minmax(16rem,1fr)_minmax(0,3fr)]">
        <div>
          <h3 className="mb-1 text-sm font-medium">{t('settings.dataCheck.sources')}</h3>
          <ul className="grid gap-x-6 sm:grid-cols-2 min-[2400px]:grid-cols-1">
            {view.sources.map((s) => (
              <li
                key={s.source}
                className="flex items-baseline justify-between gap-3 border-b py-1.5 text-sm last:border-b-0 sm:[&:nth-last-child(2):nth-child(odd)]:border-b-0 min-[2400px]:[&:nth-last-child(2):nth-child(odd)]:border-b"
              >
                <span>{s.label}</span>
                <span
                  className={cn(
                    'text-right text-xs',
                    openSources.has(s.source) ? NEEDS_LOOK_STYLE : STATUS_STYLE[s.status],
                  )}
                >
                  {openSources.has(s.source)
                    ? t('settings.dataCheck.needsLook')
                    : s.status === 'learning'
                      ? t('settings.dataCheck.learning', { nights: s.nights })
                      : s.status === 'notSeen'
                        ? t('settings.dataCheck.notSeen', { date: day(s.lastSeen) })
                        : t(`settings.dataCheck.${s.status}`)}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="space-y-4">
          {view.open.length === 0 && nothingOpen && (
            <p className="rounded-md bg-muted px-3 py-2.5 text-sm">{t(nothingOpen)}</p>
          )}
          {sources.length > 0 && (
            <div>
              <h3 className="mb-1 text-sm font-medium">{t('settings.dataCheck.findings')}</h3>
              <ul className="space-y-1.5">
                {sources.map((f) => (
                  <li
                    key={f.key}
                    className="rounded-md border border-amber-500/40 px-3 py-2 text-sm"
                  >
                    {line(f)}{' '}
                    <span className="text-xs text-muted-foreground">
                      {t('settings.dataCheck.since', { date: day(f.openedOn) })}
                    </span>
                    {lastSeen(f)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {items.length > 0 && (
            <details open={items.length <= 6} className="text-sm">
              <summary className="cursor-pointer font-medium">
                {t('settings.dataCheck.items')} ({items.length})
              </summary>
              <p className="mt-1 text-xs text-muted-foreground">
                {t('settings.dataCheck.itemsInfo')}
              </p>
              <ul className="mt-1 grid gap-x-6 min-[2400px]:grid-cols-2">
                {items.map((f) => (
                  <li key={f.key} className="border-b py-1.5 last:border-b-0">
                    {line(f)}
                    {lastSeen(f)}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
