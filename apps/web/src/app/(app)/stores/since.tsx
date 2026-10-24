'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * A post's time and how long ago, kept current: green under 30 minutes, amber under 2 hours,
 * grey after (most sales do not last long).
 */
export function Since({ at, time }: { at: string; time: string }) {
  const t = useTranslations('stores');
  const [now, setNow] = useState<number | null>(null);
  // Known only in the browser (the server's page has no "ago"), so set after the first paint.
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);
  const minutes = now === null ? null : Math.max(0, Math.floor((now - Date.parse(at)) / 60_000));
  const tone =
    minutes === null || minutes >= 120
      ? 'bg-muted-foreground/40'
      : minutes < 30
        ? 'bg-green-600'
        : 'bg-amber-500';
  return (
    <span className="inline-flex items-center gap-1.5 tabular-nums">
      <span className={cn('size-2 shrink-0 rounded-full', tone)} aria-hidden />
      {time}
      {minutes !== null && (
        <span className="text-muted-foreground">
          {' '}
          ·{' '}
          {minutes < 60
            ? t('agoMin', { n: minutes })
            : t('agoHours', { h: Math.floor(minutes / 60), m: minutes % 60 })}
        </span>
      )}
    </span>
  );
}
