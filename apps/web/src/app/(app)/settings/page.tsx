import {
  MAX_ACTIVE_DEVICES,
  collectorHealth,
  listDevices,
  listRecentCollectorRuns,
} from '@tora/db';
import type { Metadata } from 'next';
import { getFormatter, getTranslations } from 'next-intl/server';
import { logout, revokeDeviceAction } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { authed } from '@/lib/auth/guard';
import { sourceLabel } from '@/lib/product-display';
import { formatJpy } from '@/lib/utils';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('settings'))('title') };
}

export default async function SettingsPage() {
  const { db, user, device: current } = await authed();
  const [runs, health, devices, t, format] = await Promise.all([
    listRecentCollectorRuns(db, 10),
    collectorHealth(db),
    listDevices(db, user.id),
    getTranslations(),
    getFormatter(),
  ]);
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'medium' });
  const dateTime = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: 'short', timeStyle: 'short' });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">{t('settings.title')}</h1>

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.account')}</CardTitle>
          <CardDescription>{t('settings.signedInAs', { username: user.username })}</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={logout}>
            <Button variant="outline">{t('settings.logout')}</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {t('settings.devices', { count: devices.length, max: MAX_ACTIVE_DEVICES })}
          </CardTitle>
          <CardDescription>{t('settings.devicesInfo')}</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y text-sm">
            {devices.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 py-2.5">
                <div>
                  <p className="font-medium">
                    {d.label ?? '-'}
                    {d.id === current.id && (
                      <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs font-normal">
                        {t('settings.thisDevice')}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('settings.deviceDates', {
                      since: date(d.createdAt),
                      seen: date(d.lastSeenAt),
                    })}
                  </p>
                </div>
                <form action={revokeDeviceAction.bind(null, d.id)}>
                  <Button variant="outline" size="sm">
                    {d.id === current.id ? t('settings.logout') : t('settings.revoke')}
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.collectors')}</CardTitle>
          <CardDescription>{t('settings.collectorsInfo')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {health.map((h) => (
            <div key={h.source} className="space-y-2 rounded-md border p-3 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-medium">{sourceLabel(h.source)}</p>
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
              </div>
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
