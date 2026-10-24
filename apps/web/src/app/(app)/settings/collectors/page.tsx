import {
  collectSchedule,
  collectRequest,
  collectorHealth,
  collectorTimes,
  lastBackup,
  listRecentCollectorRuns,
} from '@tora/db';
import { ChevronRight } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { authed } from '@/lib/auth/guard';
import { sourceLabels } from '@/lib/sources';
import { getMoney } from '@/lib/money-server';
import { ConfirmButton } from '../admin/accounts/account-forms';
import { CollectWindowForm } from '../collect-window-form';
import { bucketLabel } from '@/lib/product-display';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('settings'))('section.collectors.title') };
}

/** The daily backup has not run for two days. */
const backupStale = (at: string) => Date.now() - Date.parse(at) > 2 * 86_400_000;

export default async function CollectorSettingsPage() {
  const money = await getMoney();
  const { db, user } = await authed();
  const admin = user.role === 'admin';
  const [schedule, sourceLabel, runs, health, times, backup, request, t, format] =
    await Promise.all([
      collectSchedule(db),
      sourceLabels(),
      listRecentCollectorRuns(db, 10),
      collectorHealth(db),
      collectorTimes(db),
      admin ? lastBackup(db) : null,
      admin ? collectRequest(db) : null,
      getTranslations(),
      getFormatter(),
    ]);
  // "12 min", "1 h 05 min"; under a minute: "<1 min".
  const duration = (ms: number) => {
    const min = Math.round(ms / 60_000);
    if (min < 1) return t('settings.underMinute');
    if (min < 60) return t('settings.minutes', { m: min });
    return t('settings.hoursMinutes', {
      h: Math.floor(min / 60),
      m: String(min % 60).padStart(2, '0'),
    });
  };
  const dateTime = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: 'short', timeStyle: 'short' });
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('settings.collectors')}</CardTitle>
          <CardDescription>{t('settings.collectorsInfo')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm">
            {schedule.nextCollect
              ? t('schedule.nextCollect', {
                  at: format.dateTime(new Date(schedule.nextCollect), {
                    weekday: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  }),
                })
              : t('schedule.nextCollectUnknown')}{' '}
            <Link href="/settings/collectors/schedule" className="font-medium underline">
              {t('schedule.link')}
            </Link>
          </p>
          {Object.keys(times.sources).length > 0 && (
            <div className="space-y-2 rounded-md bg-muted px-3 py-2.5 text-sm">
              <p className={times.over ? 'font-medium text-destructive' : undefined}>
                {t('settings.nightTotal', {
                  total: duration(times.night),
                  window: t('settings.hours', { count: times.windowHours }),
                })}
              </p>
              {times.over && (
                <p className="text-xs text-muted-foreground">{t('settings.nightOver')}</p>
              )}
              {user.role === 'admin' && <CollectWindowForm hours={times.windowHours} />}
            </div>
          )}
          {admin && (
            // "Collect now" (S21): the home PC takes it within the hour.
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted px-3 py-2.5 text-sm">
              <p>
                {!request
                  ? t('accounts.collectInfo')
                  : request.takenAt
                    ? t('accounts.collectTaken', { at: dateTime(request.takenAt) })
                    : t('accounts.collectWaiting', { at: dateTime(request.requestedAt) })}
              </p>
              {!(request && !request.takenAt) && (
                <ConfirmButton
                  label={t('accounts.collectNow')}
                  confirm={t('accounts.collectConfirm')}
                  task={{ kind: 'collect' }}
                />
              )}
            </div>
          )}
          {admin && (
            // The home PC's daily database copy (S6): stale after two days.
            <p
              className={
                !backup || backupStale(backup.at)
                  ? 'rounded-md border border-destructive/40 px-3 py-2.5 text-sm font-medium text-destructive'
                  : 'rounded-md bg-muted px-3 py-2.5 text-sm'
              }
            >
              {backup
                ? t('settings.lastBackup', {
                    date: dateTime(backup.at),
                    mb: (backup.bytes / 1024 / 1024).toFixed(1),
                    rows: backup.rows,
                  })
                : t('settings.noBackup')}
            </p>
          )}
          {health.map((h) => {
            const time = times.sources[h.source];
            return (
              // Collapsed: the name and the last run's status; open for the details.
              <details key={h.source} className="group rounded-md border text-sm">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
                  <span className="flex items-center gap-1.5 font-medium">
                    <ChevronRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90" />
                    {sourceLabel(h.source)}
                  </span>
                  {h.lastRun && (
                    <span
                      className={
                        h.lastRun.status === 'ok' && !time?.long
                          ? 'text-right text-xs text-muted-foreground'
                          : 'text-right text-xs font-medium text-destructive'
                      }
                    >
                      {t(`runStatus.${h.lastRun.status}`)} · {dateTime(h.lastRun.startedAt)}
                      {time && ` · ${duration(time.last)}`}
                    </span>
                  )}
                </summary>
                <div className="space-y-2 border-t px-3 py-2.5">
                  <p className="text-xs text-muted-foreground">
                    {t('settings.sourceCounts', { linked: h.linked, pending: h.pending })}
                    {h.lastRun &&
                      ` · ${t('settings.lastRunCounts', { requests: h.lastRun.requests, added: h.lastRun.observationsAdded })}`}
                  </p>
                  {time && (
                    <p
                      className={
                        time.long ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'
                      }
                    >
                      {time.usual === null
                        ? t('settings.runTime', { time: duration(time.last) })
                        : t(time.long ? 'settings.runTimeLong' : 'settings.runTimeUsual', {
                            time: duration(time.last),
                            usual: duration(time.usual),
                          })}
                    </p>
                  )}
                  {h.lastRun?.error && (
                    <pre className="overflow-x-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap">
                      {h.lastRun.error}
                    </pre>
                  )}
                  {h.stale.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-destructive">{t('settings.stale')}</p>
                      <ul className="text-xs text-muted-foreground">
                        {h.stale.map((s) => (
                          <li key={s.product.id}>
                            {s.product.name} ·{' '}
                            {s.lastSuccessAt ? dateTime(s.lastSuccessAt) : t('settings.never')}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {h.jumps.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-destructive">{t('settings.jumps')}</p>
                      <ul className="text-xs text-muted-foreground">
                        {h.jumps.map((j) => (
                          <li key={`${j.product.id}-${j.bucket}`}>
                            {j.product.name} ({j.bucket ? bucketLabel(j.bucket, t) : '-'}):{' '}
                            {money(Math.round(j.before))} → {money(Math.round(j.recent))}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </details>
            );
          })}
          {runs.length === 0 ? (
            <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
              {t('settings.noRuns')}
            </p>
          ) : (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">
                {t('settings.recentRuns')}
              </summary>
              <ul className="mt-2 divide-y">
                {runs.map((run) => (
                  <li key={run.id} className="flex justify-between gap-4 py-2">
                    <span>{sourceLabel(run.source)}</span>
                    <span className="text-muted-foreground">
                      {t(`runStatus.${run.status}`)} · {dateTime(run.startedAt)} ·{' '}
                      {t('settings.lastRunCounts', {
                        requests: run.requests,
                        added: run.observationsAdded,
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
