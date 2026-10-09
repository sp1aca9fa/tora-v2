import { listRecentCollectorRuns } from '@tora/db';
import type { Metadata } from 'next';
import { getFormatter, getTranslations } from 'next-intl/server';
import { logout } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { authedDb } from '@/lib/auth/guard';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('settings'))('title') };
}

export default async function SettingsPage() {
  const db = await authedDb();
  const [runs, t, format] = await Promise.all([
    listRecentCollectorRuns(db, 10),
    getTranslations(),
    getFormatter(),
  ]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">{t('settings.title')}</h1>

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

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.account')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={logout}>
            <Button variant="outline">{t('settings.logout')}</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
