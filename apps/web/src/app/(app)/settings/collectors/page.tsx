import { collectorHealth, listRecentCollectorRuns } from '@tora/db';
import { ChevronRight } from 'lucide-react';
import type { Metadata } from 'next';
import { getFormatter, getTranslations } from 'next-intl/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { authed } from '@/lib/auth/guard';
import { sourceLabels } from '@/lib/sources';
import { formatJpy } from '@/lib/utils';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('settings'))('section.collectors.title') };
}

export default async function CollectorSettingsPage() {
  const { db } = await authed();
  const [sourceLabel, runs, health, t, format] = await Promise.all([
    sourceLabels(),
    listRecentCollectorRuns(db, 10),
    collectorHealth(db),
    getTranslations(),
    getFormatter(),
  ]);
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
          {health.map((h) => (
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
                      h.lastRun.status === 'ok'
                        ? 'text-xs text-muted-foreground'
                        : 'text-xs font-medium text-destructive'
                    }
                  >
                    {t(`runStatus.${h.lastRun.status}`)} · {dateTime(h.lastRun.startedAt)}
                  </span>
                )}
              </summary>
              <div className="space-y-2 border-t px-3 py-2.5">
                <p className="text-xs text-muted-foreground">
                  {t('settings.sourceCounts', { linked: h.linked, pending: h.pending })}
                  {h.lastRun &&
                    ` · ${t('settings.lastRunCounts', { requests: h.lastRun.requests, added: h.lastRun.observationsAdded })}`}
                </p>
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
                          {j.product.name} <code>{j.bucket ?? '-'}</code>:{' '}
                          {formatJpy(Math.round(j.before))} → {formatJpy(Math.round(j.recent))}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </details>
          ))}
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
