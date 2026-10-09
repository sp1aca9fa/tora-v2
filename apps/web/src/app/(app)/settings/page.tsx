import { MAX_ACTIVE_DEVICES, listDevices, listRecentCollectorRuns } from '@tora/db';
import type { Metadata } from 'next';
import { getFormatter, getTranslations } from 'next-intl/server';
import { logout, revokeDeviceAction } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { authed } from '@/lib/auth/guard';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('settings'))('title') };
}

export default async function SettingsPage() {
  const { db, user, device: current } = await authed();
  const [runs, devices, t, format] = await Promise.all([
    listRecentCollectorRuns(db, 10),
    listDevices(db, user.id),
    getTranslations(),
    getFormatter(),
  ]);
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'medium' });

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
        <CardContent>
          {runs.length === 0 ? (
            <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
              {t('settings.noRuns')}
            </p>
          ) : (
            <ul className="divide-y text-sm">
              {runs.map((run) => (
                <li key={run.id} className="flex justify-between gap-4 py-2">
                  <span>{run.source}</span>
                  <span className="text-muted-foreground">
                    {t(`runStatus.${run.status}`)} ·{' '}
                    {format.dateTime(new Date(run.startedAt), {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
