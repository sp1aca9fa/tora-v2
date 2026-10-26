'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { trackNowAction } from './actions';

/** The feed as /api/stores/state reports it (null: it never sent anything). */
interface FeedState {
  at: string;
  source: string | null;
  board: string | null;
  posts: number;
  next: { board: string | null; at: string } | null;
  watched: { key: string; readAt: string | null }[];
}

/** Whether the board tracker reads now (its working hours), as /api/stores/state reports it. */
interface Tracking {
  on: boolean;
  why: 'always' | 'hours' | 'hour' | 'untilStart' | 'outside';
  until: string | null;
  resumeAt: string | null;
  since: string | null;
  hours: { from: string; to: string } | null;
}

/** A feed or a watched board silent this long is stopped (as on the Feed page). */
const SILENT_MS = 10 * 60_000;
/** After its next read was due, how long the feed may take to load, read and send. */
const DUE_MS = 90_000;

const clock = (at: string) => at.slice(11, 16);

/**
 * The store feed at a glance on every Stores page (S25): a pill in a corner saying whether it
 * runs, the board it read last and when, and its next read counting down; "reading" with moving
 * dots while a read is due, amber when late or a watched board gives no posts, red when silent.
 * When the tracker does not run (outside its working hours, or silent), a red bar at the top of
 * the page says so, with admins' buttons to track outside the hours once. Asks every 15 s (and
 * when the page is looked at again); the pill opens the Feed page.
 */
export function FeedPill({ admin }: { admin: boolean }) {
  const t = useTranslations('stores.pill');
  const [feed, setFeed] = useState<FeedState | null | undefined>(undefined);
  const [tracking, setTracking] = useState<Tracking | null>(null);
  const [now, setNow] = useState(0);
  const [pending, startTransition] = useTransition();
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    const check = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const state = (await (await fetch('/api/stores/state')).json()) as {
          status?: FeedState | null;
          tracking?: Tracking;
        };
        setFeed(state.status ?? null);
        setTracking(state.tracking ?? null);
        setNow(Date.now());
      } catch {
        // Offline for a moment: the next check tries again.
      }
    };
    void check();
    const ask = setInterval(check, 15_000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    document.addEventListener('visibilitychange', check);
    return () => {
      clearInterval(ask);
      clearInterval(tick);
      document.removeEventListener('visibilitychange', check);
    };
  }, [asked]);
  if (feed === undefined || !now) return null;

  const stopped = tracking && !tracking.on;
  // Silence counts from the start of the tracking hours: the feed rested before.
  const since = tracking?.on && tracking.since ? Date.parse(tracking.since) : 0;
  const heard = feed ? Math.max(Date.parse(feed.at), since) : 0;
  const silent = !stopped && !!feed && now - heard > SILENT_MS;
  const starting = !stopped && !!feed && Date.parse(feed.at) < since;

  let tone: 'ok' | 'reading' | 'late' | 'silent' | 'none' | 'stopped';
  let text: string;
  // "Online" goes on wide screens only (the green dot says it on a phone).
  let lead: string | null = null;
  if (!feed) {
    tone = 'none';
    text = t('none');
  } else if (stopped) {
    tone = 'stopped';
    text = t('stopped');
  } else {
    const last = t('last', {
      board: feed.board ?? feed.source ?? '-',
      time: clock(feed.at),
      posts: feed.posts,
    });
    const next = feed.next ? Date.parse(feed.next.at) - now : null;
    const nextBoard = feed.next?.board ?? feed.board ?? '';
    const quiet = feed.watched.filter((b) => !b.readAt || now - Date.parse(b.readAt) > SILENT_MS);
    if (silent) {
      tone = 'silent';
      text = t('silent', { time: clock(feed.at) });
    } else if (starting) {
      tone = 'reading';
      text = `${t('starting')} · ${last}`;
    } else if (next !== null && next < -DUE_MS) {
      tone = 'late';
      text = `${t('late', { board: nextBoard, time: clock(feed.next!.at) })} · ${last}`;
    } else if (next !== null && next <= 0) {
      tone = 'reading';
      text = `${t('reading', { board: nextBoard })} · ${last}`;
    } else {
      tone = quiet.length ? 'late' : 'ok';
      if (!quiet.length) lead = t('online');
      const s = next === null ? null : Math.ceil(next / 1000);
      text = [
        quiet.length ? t('quiet', { boards: quiet.map((b) => b.key).join(', ') }) : null,
        last,
        s === null
          ? null
          : t('next', {
              board: nextBoard,
              in: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`,
            }),
      ]
        .filter(Boolean)
        .join(' · ');
    }
  }
  const track = (kind: 'hour' | 'untilStart') =>
    startTransition(async () => {
      await trackNowAction(kind);
      setAsked((n) => n + 1);
    });
  const extra = tracking?.on && (tracking.why === 'hour' || tracking.why === 'untilStart');
  return (
    <>
      {(stopped || silent) && (
        <div
          role="alert"
          className="space-y-2 rounded-lg border-2 border-destructive bg-destructive/10 px-4 py-3 text-destructive"
        >
          <p className="text-base font-bold sm:text-lg">
            {stopped
              ? t('stoppedTitle', {
                  hours: tracking.hours ? `${tracking.hours.from}-${tracking.hours.to}` : '-',
                })
              : t('silentTitle', { time: clock(feed!.at) })}
          </p>
          <p className="text-sm">
            {stopped
              ? tracking.resumeAt
                ? t('resumes', { time: clock(tracking.resumeAt) })
                : null
              : t('silentInfo')}
          </p>
          {stopped && admin && (
            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                size="sm"
                variant="destructive"
                disabled={pending}
                onClick={() => track('hour')}
              >
                {t('trackHour')}
              </Button>
              {tracking.resumeAt && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => track('untilStart')}
                >
                  {t('trackUntilStart', { time: clock(tracking.resumeAt) })}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
      {extra && tracking.until && (
        <p className="rounded-lg border border-amber-500/60 bg-amber-500/10 px-4 py-2 text-sm">
          {t('extra', { time: clock(tracking.until) })}
        </p>
      )}
      <Link
        href="/stores/feed"
        aria-live="polite"
        className={cn(
          'fixed right-3 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-20 flex max-w-[calc(100vw-1.5rem)] items-center gap-2 rounded-2xl border sm:rounded-full bg-card/95 px-3 py-1.5 text-xs tabular-nums shadow-md backdrop-blur md:right-4 md:bottom-4',
          tone === 'late' && 'border-amber-500/60',
          (tone === 'silent' || tone === 'stopped') && 'border-destructive/60 text-destructive',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'size-2 shrink-0 rounded-full',
            tone === 'ok' && 'bg-green-600',
            tone === 'reading' && 'animate-pulse bg-green-600',
            tone === 'late' && 'bg-amber-500',
            (tone === 'silent' || tone === 'stopped') && 'bg-destructive',
            tone === 'none' && 'bg-muted-foreground/40',
          )}
        />
        <span className="line-clamp-2 sm:truncate">
          {lead && <span className="max-sm:hidden">{lead} · </span>}
          {text}
          {tone === 'reading' && <span className="feed-dots" aria-hidden />}
        </span>
      </Link>
    </>
  );
}
