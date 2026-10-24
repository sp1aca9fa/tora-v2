'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { markLocationSeenAction } from './actions';

/**
 * A Now row (S25): closed, its summary and how many messages came since it was last opened;
 * opening it marks them read (on the account, so every device agrees).
 */
export function NowRow({
  id,
  latest,
  unread,
  dashed,
  summary,
  children,
}: {
  id: string;
  /** When its newest message was posted: read up to there once opened. */
  latest: string;
  unread: number;
  dashed: boolean;
  summary: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = useTranslations('stores');
  const [readUpTo, setReadUpTo] = useState('');
  const shown = readUpTo >= latest ? 0 : unread;
  return (
    <details
      className={cn('group rounded-xl border bg-card', dashed && 'border-dashed')}
      onToggle={(e) => {
        if (!e.currentTarget.open || shown === 0) return;
        setReadUpTo(latest);
        void markLocationSeenAction(id, latest);
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
      {children}
    </details>
  );
}
