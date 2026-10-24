import { appUrl, statusTokenCreatedAt } from '@tora/db';
import type { Metadata } from 'next';
import { getFormatter, getTranslations } from 'next-intl/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { adminOnly } from '@/lib/auth/guard';
import { serverStatus } from '@/lib/server-status';
import { cn } from '@/lib/utils';
import { StatusTokenForm } from './token-form';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('settings'))('section.server.title') };
}

export const dynamic = 'force-dynamic';

/**
 * The server's status (S10): version, services and timers, disk, the end of each log; read-only.
 * The same answers `/api/server/status` gives a helper holding the read-only token.
 */
export default async function ServerStatusPage() {
  const { db } = await adminOnly();
  const [status, since, base, t, format] = await Promise.all([
    serverStatus(db, { lines: 40 }),
    statusTokenCreatedAt(db),
    appUrl(db),
    getTranslations('server'),
    getFormatter(),
  ]);
  const when = (iso: string | null) =>
    iso ? format.dateTime(new Date(iso), { dateStyle: 'short', timeStyle: 'short' }) : '-';
  const v = status.version;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('info')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="space-y-1 rounded-md bg-muted px-3 py-2.5">
            <p className="font-medium">
              {v.commit
                ? t('version', { commit: v.commit, date: when(v.date), subject: v.subject ?? '' })
                : t('noVersion')}
            </p>
            <p>
              {t('host', {
                platform: status.host.platform,
                node: v.node,
                up: status.host.uptimeHours,
                app: status.host.appUptimeHours,
              })}
            </p>
            <p>
              {t('memory', {
                free: status.host.memoryFreeMb,
                total: status.host.memoryTotalMb,
                load: status.host.load.join(' '),
              })}
            </p>
            {status.disks.map((d) => (
              <p key={d.name}>
                {t('disk', { name: t(`diskName.${d.name}`), free: d.freeGb, total: d.totalGb })}
              </p>
            ))}
            <p>
              {t('last', { collect: when(status.last.collect), backup: when(status.last.backup) })}
            </p>
          </div>
          <section className="space-y-1">
            <h3 className="font-medium">{t('units')}</h3>
            {status.units ? (
              <ul className="divide-y rounded-md border">
                {status.units.map((u) => (
                  <li key={u.unit} className="flex flex-wrap items-baseline gap-x-2 px-3 py-1.5">
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-xs',
                        u.active === 'failed'
                          ? 'bg-destructive/15 text-destructive'
                          : u.active === 'active'
                            ? 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300'
                            : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {u.active} / {u.sub}
                    </span>
                    <span className="font-mono text-xs">{u.unit}</span>
                    <span className="text-muted-foreground">{u.description}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">
                {t('noUnits', { reason: status.unitsError ?? '' })}
              </p>
            )}
          </section>
          {status.timers && status.timers.length > 0 && (
            <section className="space-y-1">
              <h3 className="font-medium">{t('timers')}</h3>
              <ul className="divide-y rounded-md border">
                {status.timers.map((x) => (
                  <li key={x.unit} className="flex flex-wrap items-baseline gap-x-3 px-3 py-1.5">
                    <span className="font-mono text-xs">{x.unit}</span>
                    <span className="text-muted-foreground">
                      {t('timer', { next: when(x.next), last: when(x.last) })}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section className="space-y-1">
            <h3 className="font-medium">{t('logs')}</h3>
            {status.logs.length === 0 ? (
              <p className="text-muted-foreground">{t('noLogs')}</p>
            ) : (
              status.logs.map((l) => (
                <details key={l.name} className="rounded-md border">
                  <summary className="cursor-pointer px-3 py-1.5 font-mono text-xs">
                    {l.name}
                  </summary>
                  <pre className="max-h-96 overflow-auto border-t px-3 py-2 text-xs whitespace-pre-wrap break-words">
                    {l.lines.join('\n')}
                  </pre>
                </details>
              ))
            )}
          </section>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('token')}</CardTitle>
          <CardDescription>{t('tokenInfo')}</CardDescription>
        </CardHeader>
        <CardContent>
          <StatusTokenForm
            since={since ? when(since) : null}
            url={`${base ?? ''}/api/server/status`}
          />
        </CardContent>
      </Card>
    </div>
  );
}
