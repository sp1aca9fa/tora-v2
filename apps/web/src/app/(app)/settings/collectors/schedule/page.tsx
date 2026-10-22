import { MORNING_CHECK_HOUR, collectSchedule } from '@tora/db';
import type { Metadata } from 'next';
import { getFormatter, getTranslations } from 'next-intl/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { authed } from '@/lib/auth/guard';
import { sourceLabels } from '@/lib/sources';
import { cn } from '@/lib/utils';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('settings'))('section.schedule.title') };
}

/**
 * When things run on the home server: its checks, the next daily collect and each collector's
 * likely start (from last night's run), what else the collect does, and the other timers.
 */
export default async function SchedulePage() {
  const { db } = await authed();
  const [s, labels, t, format] = await Promise.all([
    collectSchedule(db),
    sourceLabels(),
    getTranslations('schedule'),
    getFormatter(),
  ]);
  const when = (iso: string | null) =>
    iso
      ? format.dateTime(new Date(iso), { weekday: 'short', hour: '2-digit', minute: '2-digit' })
      : '-';
  const time = (iso: string) =>
    format.dateTime(new Date(iso), { hour: '2-digit', minute: '2-digit' });
  const took = (ms: number | null) =>
    ms === null
      ? '-'
      : ms < 60_000
        ? t('underMinute')
        : t('minutes', { m: Math.round(ms / 60_000) });
  const steps = [
    'before',
    'rankings',
    'collectors',
    'opening',
    'closing',
    'backup',
    'alerts',
  ] as const;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('info')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="space-y-1.5 rounded-md bg-muted px-3 py-2.5">
            {s.lastCheck === null ? (
              <p>{t('noChecks')}</p>
            ) : (
              <p className={cn(s.stale && 'font-medium text-destructive')}>
                {s.stale
                  ? t('stale', { last: when(s.lastCheck) })
                  : t('checks', {
                      every: s.intervalMinutes ?? 0,
                      last: time(s.lastCheck),
                      next: when(s.nextCheck),
                    })}
              </p>
            )}
            <p className="font-medium">
              {s.nextCollect
                ? t('nextCollect', { at: when(s.nextCollect) })
                : t('nextCollectUnknown')}
            </p>
            {s.lastCollect && (
              <p className="text-xs text-muted-foreground">
                {t(s.doneToday ? 'doneToday' : 'notToday', {
                  at: when(s.lastCollect.at),
                  level: t(`level.${s.lastCollect.level}`),
                })}
              </p>
            )}
            {s.requested && (
              <p className="text-xs font-medium">{t('requested', { at: when(s.nextCheck) })}</p>
            )}
          </div>

          <section className="space-y-2">
            <h3 className="font-medium">{t('inOrder')}</h3>
            <ol className="space-y-2">
              {steps.map((step, i) => (
                <li key={step} className="space-y-1.5">
                  <p>
                    <span className="mr-2 text-muted-foreground tabular-nums">{i + 1}.</span>
                    <span className="font-medium">{t(`step.${step}`)}</span>{' '}
                    <span className="text-muted-foreground">{t(`stepInfo.${step}`)}</span>
                  </p>
                  {step === 'collectors' && s.collectors.length > 0 && (
                    <div className="overflow-x-auto rounded-lg border">
                      <table className="w-full text-xs">
                        <thead className="text-muted-foreground">
                          <tr className="border-b text-left">
                            <th className="px-3 py-1.5 font-medium">{t('colSource')}</th>
                            <th className="px-3 py-1.5 font-medium">{t('colNext')}</th>
                            <th className="px-3 py-1.5 font-medium">{t('colLast')}</th>
                            <th className="px-3 py-1.5 text-right font-medium">{t('colTook')}</th>
                          </tr>
                        </thead>
                        <tbody className="tabular-nums">
                          {s.collectors.map((c) => (
                            <tr key={c.source} className="border-b last:border-0">
                              <td className="px-3 py-1.5">{labels(c.source)}</td>
                              <td className="px-3 py-1.5">
                                {c.nextStart ? `~${when(c.nextStart)}` : '-'}
                              </td>
                              <td className="px-3 py-1.5">
                                {when(c.lastStart)}{' '}
                                <span
                                  className={cn(
                                    c.status === 'ok'
                                      ? 'text-muted-foreground'
                                      : 'text-amber-700 dark:text-amber-300',
                                  )}
                                >
                                  {t(`status.${c.status}`)}
                                </span>
                              </td>
                              <td className="px-3 py-1.5 text-right">{took(c.lastMs)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </li>
              ))}
            </ol>
            <p className="text-xs text-muted-foreground">{t('estimate')}</p>
          </section>

          <section className="space-y-1.5">
            <h3 className="font-medium">{t('others')}</h3>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              <li>
                {t('other.morning', { hour: `${String(MORNING_CHECK_HOUR).padStart(2, '0')}:00` })}
              </li>
              <li>{t('other.feed')}</li>
              <li>{t('other.update')}</li>
              <li>{t('other.funnel')}</li>
              <li>{t('other.backupCopy')}</li>
            </ul>
          </section>
        </CardContent>
      </Card>
    </div>
  );
}
