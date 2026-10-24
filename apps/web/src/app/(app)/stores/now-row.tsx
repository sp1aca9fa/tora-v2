'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { markLocationSeenAction } from './actions';
import { FreshSince } from './posts-list';

/**
 * A Now row (S25): closed, its summary and how many messages came since it was last opened;
 * opening it marks them read (on the account, so every device agrees) and tints them for a
 * moment. Messages arriving while it is open are read at once and tinted as they appear.
 */
export function NowRow({
  id,
  latest,
  seenAt,
  unread,
  dashed,
  summary,
  children,
}: {
  id: string;
  /** When its newest message was posted: read up to there once opened. */
  latest: string;
  /** When it was last opened ('' never). */
  seenAt: string;
  unread: number;
  dashed: boolean;
  summary: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = useTranslations('stores');
  const open = useRef(false);
  const [readUpTo, setReadUpTo] = useState('');
  // Where this opening's new messages start (kept while open, so updates do not untint them).
  const [since, setSince] = useState<string | null>(null);
  const read = seenAt > readUpTo ? seenAt : readUpTo;
  const shown = read >= latest ? 0 : unread;

  const markRead = () => {
    if (read >= latest) return;
    setReadUpTo(latest);
    void markLocationSeenAction(id, latest);
  };
  useEffect(() => {
    if (open.current) markRead();
  });

  return (
    <details
      className={cn('group rounded-xl border bg-card', dashed && 'border-dashed')}
      onToggle={(e) => {
        open.current = e.currentTarget.open;
        if (!open.current) return;
        setSince(read);
        markRead();
      }}
    >
      <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <div className="min-w-0 flex-1 space-y-0.5">{summary}</div>
        <div className="flex shrink-0 items-center gap-2 pt-0.5">
          {shown > 0 && (
            <span
              className="min-w-5 rounded-full bg-primary px-1.5 text-center text-xs font-medium text-primary-foreground tabular-nums"
              aria-label={t('unread', { n: shown })}
              title={t('unread', { n: shown })}
            >
              {shown}
            </span>
          )}
          <span className="text-xs text-muted-foreground group-open:rotate-90" aria-hidden>
            ▸
          </span>
        </div>
      </summary>
      <FreshSince.Provider value={since}>{children}</FreshSince.Provider>
    </details>
  );
}
