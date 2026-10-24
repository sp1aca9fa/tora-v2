'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

/** The feed as /api/stores/state reports it (null: it never sent anything). */
interface FeedState {
  at: string;
  source: string | null;
  board: string | null;
  posts: number;
  next: { board: string | null; at: string } | null;
  watched: { key: string; readAt: string | null }[];
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
 * Asks every 15 s (and when the page is looked at again); opens the Feed page.
 */
export function FeedPill() {
  const t = useTranslations('stores.pill');
  const [feed, setFeed] = useState<FeedState | null | undefined>(undefined);
  const [now, setNow] = useState(0);
  useEffect(() => {
    const check = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const state = (await (await fetch('/api/stores/state')).json()) as {
          status?: FeedState | null;
        };
        setFeed(state.status ?? null);
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
  }, []);
  if (feed === undefined || !now) return null;

  let tone: 'ok' | 'reading' | 'late' | 'silent' | 'none';
  let text: string;
  if (!feed) {
    tone = 'none';
    text = t('none');
  } else {
    const last = t('last', {
      board: feed.board ?? feed.source ?? '-',
      time: clock(feed.at),
      posts: feed.posts,
    });
    const next = feed.next ? Date.parse(feed.next.at) - now : null;
    const nextBoard = feed.next?.board ?? feed.board ?? '';
    const quiet = feed.watched.filter((b) => !b.readAt || now - Date.parse(b.readAt) > SILENT_MS);
    if (now - Date.parse(feed.at) > SILENT_MS) {
      tone = 'silent';
      text = t('silent', { time: clock(feed.at) });
    } else if (next !== null && next < -DUE_MS) {
      tone = 'late';
      text = `${t('late', { board: nextBoard, time: clock(feed.next!.at) })} · ${last}`;
    } else if (next !== null && next <= 0) {
      tone = 'reading';
      text = `${t('reading', { board: nextBoard })} · ${last}`;
    } else {
      tone = quiet.length ? 'late' : 'ok';
      const s = next === null ? null : Math.ceil(next / 1000);
      text = [
        quiet.length ? t('quiet', { boards: quiet.map((b) => b.key).join(', ') }) : t('online'),
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
  return (
    <Link
      href="/stores/feed"
      aria-live="polite"
      className={cn(
        'fixed right-3 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-20 flex max-w-[calc(100vw-1.5rem)] items-center gap-2 rounded-full border bg-card/95 px-3 py-1.5 text-xs tabular-nums shadow-md backdrop-blur md:right-4 md:bottom-4',
        tone === 'late' && 'border-amber-500/60',
        tone === 'silent' && 'border-destructive/60 text-destructive',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'size-2 shrink-0 rounded-full',
          tone === 'ok' && 'bg-green-600',
          tone === 'reading' && 'animate-pulse bg-green-600',
          tone === 'late' && 'bg-amber-500',
          tone === 'silent' && 'bg-destructive',
          tone === 'none' && 'bg-muted-foreground/40',
        )}
      />
      <span className="truncate">
        {text}
        {tone === 'reading' && <span className="feed-dots" aria-hidden />}
      </span>
    </Link>
  );
}
