import { ACTIVITY_KINDS, type ActivityEntry, type ActivityKind, listActivity } from '@tora/db';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { nativeName } from '@/i18n/locale';
import { authed } from '@/lib/auth/guard';
import { marketLabels, sourceLabels } from '@/lib/sources';
import { cn } from '@/lib/utils';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('settings'))('section.activity.title') };
}

const PAGE = 50;

const LEVEL_STYLE = {
  ok: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300',
  problem: 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
  failed: 'bg-destructive/15 text-destructive',
} as const;

type Params = Promise<{ kind?: string; before?: string }>;

/**
 * The activity log (S17): collects, backups, imports, admin changes and the app's daily check,
 * newest first. Admins see the whole app (the admin audit log); members their own imports.
 */
export default async function ActivityPage({ searchParams }: { searchParams: Params }) {
  const { db, user } = await authed();
  const admin = user.role === 'admin';
  const sp = await searchParams;
  const kind = (ACTIVITY_KINDS as readonly string[]).includes(sp.kind ?? '')
    ? (sp.kind as ActivityKind)
    : null;
  const before = typeof sp.before === 'string' && sp.before ? sp.before : null;
  const [entries, t, format, sourceLabel, marketLabel] = await Promise.all([
    listActivity(db, { id: user.id, admin }, { kind, before, limit: PAGE }),
    getTranslations(),
    getFormatter(),
    sourceLabels(),
    marketLabels(),
  ]);
  const dateTime = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: 'short', timeStyle: 'short' });
  const kinds: (ActivityKind | null)[] = admin ? [null, ...ACTIVITY_KINDS] : [];
  const href = (k: ActivityKind | null, b?: string) => {
    const q = new URLSearchParams();
    if (k) q.set('kind', k);
    if (b) q.set('before', b);
    const s = q.toString();
    return `/settings/activity${s ? `?${s}` : ''}`;
  };
  const value = (v: unknown) =>
    v === null || v === undefined || v === ''
      ? t('activity.none')
      : Array.isArray(v)
        ? v.map((x) => (x === null ? t('activity.none') : String(x))).join(' / ')
        : String(v);

  /** What the entry says, by kind. */
  function describe(e: ActivityEntry): { title: string; lines: string[] } {
    const d = e.detail as Record<string, unknown>;
    switch (e.kind) {
      case 'collect': {
        const sources = (d.sources as { source: string; status: string }[] | undefined) ?? [];
        const scope = [
          d.market ? marketLabel(String(d.market)) : null,
          d.source ? sourceLabel(String(d.source)) : null,
          d.product,
        ]
          .filter(Boolean)
          .join(', ');
        const lines = d.exitCode
          ? [
              t('activity.collectStopped', { code: Number(d.exitCode) }),
              ...(d.error && !/^exit code/.test(String(d.error))
                ? [t('activity.reason', { reason: String(d.error) })]
                : []),
            ]
          : [t('activity.collect', { observations: format.number(Number(d.observations ?? 0)) })];
        if (scope) lines.push(t('activity.collectScope', { scope }));
        for (const s of sources.filter((s) => s.status !== 'ok')) {
          lines.push(
            t('activity.collectSource', {
              source: sourceLabel(s.source),
              status: t.has(`alertText.status_${s.status}`)
                ? t(`alertText.status_${s.status}`)
                : s.status,
            }),
          );
        }
        return { title: t('activity.kind.collect'), lines };
      }
      case 'backup':
        return {
          title: t('activity.kind.backup'),
          lines: [
            e.level === 'failed'
              ? t('activity.backupFailed', { error: String(d.error ?? '') })
              : t('activity.backup', {
                  mb: (Number(d.bytes ?? 0) / 1024 / 1024).toFixed(1),
                  rows: format.number(Number(d.rows ?? 0)),
                  seconds: Number(d.seconds ?? 0),
                }),
          ],
        };
      case 'import': {
        const o = (d.outcomes ?? {}) as Record<string, number>;
        const method = e.action ?? '';
        return {
          title: t('activity.kind.import', {
            method: t.has(`imports.hub.method.${method}`)
              ? t(`imports.hub.method.${method}`)
              : method,
          }),
          lines: [
            t('activity.import', {
              imported: (o.imported ?? 0) + (o.matched ?? 0) + (o.updated ?? 0),
              existing: o.existing ?? 0,
              skipped: o.skipped ?? 0,
              problem: o.problem ?? 0,
            }),
          ],
        };
      }
      case 'check':
        return {
          title: t('activity.kind.check'),
          lines: [
            t(e.action === 'no_backup' ? 'activity.noBackup' : 'activity.noCollect', {
              hours: Number(d.hours ?? 0),
              last: d.last ? dateTime(String(d.last)) : '-',
            }),
          ],
        };
      case 'admin': {
        const action = e.action ?? '';
        const title = t.has(`activity.admin.${action}`) ? t(`activity.admin.${action}`) : action;
        const { from, to, ...rest } = d;
        // Names people know for the keys the change stores.
        const named = (k: string, v: unknown): string => {
          if (Array.isArray(v)) return v.map((x) => named(k, x)).join(' / ');
          if (v === null || v === undefined) return t('activity.none');
          const key = String(v);
          if (k === 'language') return nativeName(key);
          if (k === 'source' || k === 'other') return sourceLabel(key);
          if (k === 'market') return marketLabel(key);
          if (k === 'role' && t.has(`activity.role.${key}`))
            return `(${t(`activity.role.${key}`)})`;
          if (k === 'cls') {
            if (t.has(`sourceRoles.class.${key}`)) return t(`sourceRoles.class.${key}`);
            if (t.has(`kind.${key}`)) return t(`kind.${key}`);
          }
          if (action === 'sourceRole' && t.has(`sourceRoles.role.${key}`)) {
            return t(`sourceRoles.role.${key}`);
          }
          return value(v);
        };
        // What `from` and `to` hold, named like the keys above.
        const TO_KEYS: Record<string, string> = {
          markets: 'market',
          languages: 'language',
          identity: 'source',
        };
        const toKey = TO_KEYS[action] ?? 'to';
        const lines: string[] = [];
        const extra = Object.entries(rest)
          .filter(([k]) => k !== 'step')
          .map(([k, v]) => named(k, v))
          .join(', ')
          .replace(', (', ' (');
        if (extra) lines.push(extra);
        if ('to' in d) {
          lines.push(
            'from' in d
              ? t('activity.fromTo', { from: named(toKey, from), to: named(toKey, to) })
              : named(toKey, to),
          );
        }
        return { title, lines };
      }
    }
  }

  const who = (e: ActivityEntry) =>
    e.actor
      ? t('activity.by', { name: e.actor })
      : e.kind === 'admin'
        ? t('activity.byTerminal')
        : e.kind === 'check'
          ? t('activity.byApp')
          : e.kind === 'import'
            ? null
            : t('activity.byPc');

  const last = entries.length === PAGE ? entries[entries.length - 1]!.occurredAt : null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('activity.title')}</CardTitle>
        <CardDescription>{admin ? t('activity.info') : t('activity.infoMember')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {kinds.length > 0 && (
          <nav className="flex flex-wrap gap-1.5 text-sm">
            {kinds.map((k) => (
              <Link
                key={k ?? 'all'}
                href={href(k)}
                aria-current={k === kind ? 'page' : undefined}
                className={cn(
                  'rounded-full border px-2.5 py-0.5',
                  k === kind ? 'bg-foreground text-background' : 'hover:bg-muted',
                )}
              >
                {t(`activity.filter.${k ?? 'all'}`)}
              </Link>
            ))}
          </nav>
        )}
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('activity.empty')}</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {entries.map((e) => {
              const { title, lines } = describe(e);
              const by = who(e);
              return (
                <li key={e.id} className="space-y-1 px-3 py-2.5 text-sm">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span
                      className={cn(
                        'shrink-0 rounded-full px-2 py-0.5 text-xs',
                        LEVEL_STYLE[e.level],
                      )}
                    >
                      {t(`activity.level.${e.level}`)}
                    </span>
                    <span className="min-w-0 font-medium break-words">{title}</span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
                      {dateTime(e.occurredAt)}
                    </span>
                  </div>
                  {lines.map((line, i) => (
                    <p key={i} className="break-words text-muted-foreground">
                      {line}
                    </p>
                  ))}
                  <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                    {by && <span>{by}</span>}
                    {e.alertedAt && (
                      <span>{t('activity.alerted', { date: dateTime(e.alertedAt) })}</span>
                    )}
                    {e.href && (
                      <Link href={e.href} className="underline underline-offset-2">
                        {t('activity.open')}
                      </Link>
                    )}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
        {(last || before) && (
          <nav className="flex gap-3 text-sm">
            {before && (
              <Link href={href(kind)} className="underline underline-offset-2">
                {t('activity.newest')}
              </Link>
            )}
            {last && (
              <Link href={href(kind, last)} className="underline underline-offset-2">
                {t('activity.older')}
              </Link>
            )}
          </nav>
        )}
      </CardContent>
    </Card>
  );
}
