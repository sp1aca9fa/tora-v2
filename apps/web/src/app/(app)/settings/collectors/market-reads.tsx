import type { MarketStateView } from '@tora/db';
import { getFormatter, getTranslations } from 'next-intl/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { ConfirmButton } from '../admin/accounts/account-forms';

/** The panel's anchor, for the small link on a collector's row. */
export const EXTRA_READS_ID = 'extra-reads';

/**
 * The extra daytime reads per marketplace (S36 B4): the number a day and today's use, the jobs
 * (failing ones amber, stopped ones red, each with its last error), a pause after a refusal or a
 * stop, and the restart. A table on wider screens, cards on phone.
 */
export async function ExtraReads({
  views,
  labels,
  admin,
  className,
}: {
  views: MarketStateView[];
  labels: Record<string, string>;
  admin: boolean;
  className?: string;
}) {
  const [t, format] = await Promise.all([getTranslations('settings.market'), getFormatter()]);
  const at = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: 'short', timeStyle: 'short' });
  const label = (v: MarketStateView) => labels[v.source] ?? v.source;

  // A stop is red and bold, a pause amber; a used-up day only says when reads go on.
  const state = (v: MarketStateView) =>
    v.stopped ? (
      <span className="font-medium text-destructive">{t('stopped')}</span>
    ) : v.waitUntil ? (
      <span className="text-amber-700 dark:text-amber-400">
        {t('paused', { at: at(v.waitUntil) })}
      </span>
    ) : v.perDay === null ? (
      <span className="text-muted-foreground">
        {t('notRun', { since: v.oldestWaitingAt ? at(v.oldestWaitingAt) : '-' })}
      </span>
    ) : v.used >= v.perDay ? (
      <span className="text-muted-foreground">
        {t('usedUp', { used: v.used, perDay: v.perDay })}
      </span>
    ) : (
      <span className="text-muted-foreground">{t('active')}</span>
    );
  const failing = (v: MarketStateView) =>
    v.failingJobs > 0 && (
      <span className="text-amber-700 dark:text-amber-400">
        {t('jobsFailing', { count: v.failingJobs, most: v.mostFailures })}
      </span>
    );
  const jobs = (v: MarketStateView) => (
    <>
      {t('jobsWaiting', { count: v.waiting })}
      {v.failingJobs > 0 && <span className="block">{failing(v)}</span>}
      {v.stoppedJobs > 0 && (
        <span className="block font-medium text-destructive">
          {t('jobsStopped', { count: v.stoppedJobs })}
        </span>
      )}
    </>
  );
  const restart = (v: MarketStateView) =>
    admin &&
    (v.stopped || v.waitUntil) && (
      <ConfirmButton
        label={t('restart')}
        confirm={t('restartConfirm', { source: label(v) })}
        task={{ kind: 'restartMarket', source: v.source }}
      />
    );
  // The last error of a stopped job, then of a failing one; nothing when there is neither.
  const hasErrors = (v: MarketStateView) =>
    (v.stoppedJobs > 0 && !!v.lastError) || (v.failingJobs > 0 && !!v.lastFailure);
  const errors = (v: MarketStateView) => (
    <>
      {v.stoppedJobs > 0 && v.lastError && (
        <p className="text-xs text-muted-foreground">
          {t('lastError')} <span className="break-words text-foreground">{v.lastError}</span>
        </p>
      )}
      {v.failingJobs > 0 && v.lastFailure && (
        <p className="text-xs text-muted-foreground">
          {t('lastFailure')} <span className="break-words text-foreground">{v.lastFailure}</span>
        </p>
      )}
    </>
  );

  return (
    <Card id={EXTRA_READS_ID} className={cn('min-w-0 scroll-mt-4', className)}>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('info')}</CardDescription>
      </CardHeader>
      <CardContent>
        {/* Phone: one card per marketplace. */}
        <ul className="space-y-2 md:hidden">
          {views.map((v) => (
            <li key={v.source} className="space-y-1 rounded-md border px-3 py-2.5 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{label(v)}</span>
                {restart(v)}
              </div>
              <p>{state(v)}</p>
              <p className="text-xs text-muted-foreground">
                {v.perDay !== null && `${t('usedOfToday', { used: v.used, perDay: v.perDay })} · `}
                {t('jobsWaiting', { count: v.waiting })}
                {v.failingJobs > 0 && (
                  <>
                    {' · '}
                    {failing(v)}
                  </>
                )}
                {v.stoppedJobs > 0 && (
                  <>
                    {' · '}
                    <span className="font-medium text-destructive">
                      {t('jobsStopped', { count: v.stoppedJobs })}
                    </span>
                  </>
                )}
              </p>
              {errors(v)}
            </li>
          ))}
        </ul>
        {/* Wider: one table. */}
        <table className="hidden w-full text-sm md:table">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-1 pr-3 font-normal">{t('marketplace')}</th>
              <th className="py-1 pr-3 text-right font-normal">{t('today')}</th>
              <th className="py-1 pr-3 font-normal">{t('jobs')}</th>
              <th className="py-1 pr-3 font-normal">{t('state')}</th>
              {admin && <th className="py-1" />}
            </tr>
          </thead>
          {views.map((v) => (
            <tbody key={v.source} className="border-t">
              <tr className="align-top">
                <td className="py-2 pr-3 font-medium">{label(v)}</td>
                <td className="py-2 pr-3 text-right whitespace-nowrap tabular-nums">
                  {v.perDay === null ? '-' : t('usedOf', { used: v.used, perDay: v.perDay })}
                </td>
                <td className="py-2 pr-3 whitespace-nowrap">{jobs(v)}</td>
                <td className="py-2 pr-3">{state(v)}</td>
                {admin && <td className="py-1.5 text-right">{restart(v)}</td>}
              </tr>
              {hasErrors(v) && (
                <tr>
                  <td colSpan={admin ? 5 : 4} className="space-y-0.5 pb-2">
                    {errors(v)}
                  </td>
                </tr>
              )}
            </tbody>
          ))}
        </table>
      </CardContent>
    </Card>
  );
}
