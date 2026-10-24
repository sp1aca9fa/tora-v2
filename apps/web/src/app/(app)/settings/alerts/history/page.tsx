import { NOTICE_KINDS, type NoticeKind } from '@tora/core';
import {
  ALERT_CHANNEL_KINDS,
  ALERT_LOG_DAYS,
  ALERT_LOG_STATUSES,
  type AlertChannelKind,
  type AlertLogStatus,
  listAlertLog,
} from '@tora/db';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { authed } from '@/lib/auth/guard';
import { cn } from '@/lib/utils';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('settings'))('section.alertHistory.title') };
}

const PAGE = 50;

const STATUS_STYLE = {
  sent: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300',
  failed: 'bg-destructive/15 text-destructive',
} as const;

type Params = Promise<Record<string, string | string[] | undefined>>;

const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null =>
  (list as readonly unknown[]).includes(v) ? (v as T) : null;
const date = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/** Every alert Tora sent the person (S17): newest first, by kind, channel, outcome and date. */
export default async function AlertHistoryPage({ searchParams }: { searchParams: Params }) {
  const { db, user } = await authed();
  const sp = await searchParams;
  const filter = {
    kind: oneOf<NoticeKind>(NOTICE_KINDS, sp.kind),
    channel: oneOf<AlertChannelKind>(ALERT_CHANNEL_KINDS, sp.channel),
    status: oneOf<AlertLogStatus>(ALERT_LOG_STATUSES, sp.status),
    from: date(sp.from),
    to: date(sp.to),
  };
  const before = typeof sp.before === 'string' && sp.before ? sp.before : null;
  const [entries, t, tk, ta, format] = await Promise.all([
    listAlertLog(db, user.id, { ...filter, before, limit: PAGE }),
    getTranslations('alertHistory'),
    getTranslations('alertStyle.kind'),
    getTranslations('alerts'),
    getFormatter(),
  ]);
  const href = (b?: string) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(filter)) if (v) q.set(k, v);
    if (b) q.set('before', b);
    const s = q.toString();
    return `/settings/alerts/history${s ? `?${s}` : ''}`;
  };
  const last = entries.length === PAGE ? entries[entries.length - 1]!.sentAt : null;
  const filtered = Object.values(filter).some(Boolean);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('info', { days: ALERT_LOG_DAYS })}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <form method="get" className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-6 sm:items-end">
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">{t('kind')}</span>
            <NativeSelect name="kind" defaultValue={filter.kind ?? ''}>
              <option value="">{t('all')}</option>
              {NOTICE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {tk(k)}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">{t('channel')}</span>
            <NativeSelect name="channel" defaultValue={filter.channel ?? ''}>
              <option value="">{t('all')}</option>
              {ALERT_CHANNEL_KINDS.map((k) => (
                <option key={k} value={k}>
                  {ta(k)}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">{t('status')}</span>
            <NativeSelect name="status" defaultValue={filter.status ?? ''}>
              <option value="">{t('all')}</option>
              {ALERT_LOG_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`statusName.${s}`)}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">{t('from')}</span>
            <Input type="date" name="from" defaultValue={filter.from ?? ''} />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">{t('to')}</span>
            <Input type="date" name="to" defaultValue={filter.to ?? ''} />
          </label>
          <div className="flex items-center gap-3">
            <Button type="submit">{t('apply')}</Button>
            {filtered && (
              <Link href="/settings/alerts/history" className="underline underline-offset-2">
                {t('clear')}
              </Link>
            )}
          </div>
        </form>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t(filtered ? 'noMatch' : 'empty')}</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {entries.map((e) => (
              <li key={e.id} className="space-y-1 px-3 py-2.5 text-sm">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-2 py-0.5 text-xs',
                      STATUS_STYLE[e.status],
                    )}
                  >
                    {t(`statusName.${e.status}`)}
                  </span>
                  <span className="font-medium">
                    {e.kind && (NOTICE_KINDS as readonly string[]).includes(e.kind)
                      ? tk(e.kind)
                      : t('message')}
                  </span>
                  <span className="text-muted-foreground">
                    {t('via', {
                      channel: ta(e.channelKind),
                      label: e.channelLabel ?? '',
                    })}
                    {!e.channelId && ` (${t('removed')})`}
                  </span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
                    {format.dateTime(new Date(e.sentAt), {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </span>
                </div>
                <p className="break-words whitespace-pre-wrap text-muted-foreground">{e.text}</p>
                {e.error && (
                  <p className="text-xs break-words text-destructive">
                    {t('error', { error: e.error })}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
        {(last || before) && (
          <nav className="flex gap-3 text-sm">
            {before && (
              <Link href={href()} className="underline underline-offset-2">
                {t('newest')}
              </Link>
            )}
            {last && (
              <Link href={href(last)} className="underline underline-offset-2">
                {t('older')}
              </Link>
            )}
          </nav>
        )}
      </CardContent>
    </Card>
  );
}
