'use client';

import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

export interface InsightPanel {
  id: string;
  title: string;
  /** Across every item any user holds (not only the user's). */
  market?: boolean;
  /** The panel per period (movers, trades); else `body`. */
  bodies?: { days: number; body: ReactNode }[];
  body: ReactNode;
}

const card = 'rounded-xl border bg-card px-4 py-3';

/**
 * The Summary's insights (requirements S8): one card cycling through the panels every few
 * seconds, with previous / next and pause; or, with rotation off, the panels side by side.
 */
export function InsightsCard({
  panels,
  rotate,
  seconds,
  periods,
}: {
  panels: InsightPanel[];
  rotate: boolean;
  seconds: number;
  periods: number[];
}) {
  const t = useTranslations('portfolio.insights');
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  // One period for every panel that has periods (30 days first).
  const [days, setDays] = useState(30);
  const n = panels.length;
  const bodyOf = (p: InsightPanel) => p.bodies?.find((b) => b.days === days)?.body ?? p.body;
  const periodChips = (
    <div className="flex shrink-0 items-center gap-0.5 rounded-full border p-0.5 text-xs">
      {periods.map((d) => (
        <button
          key={d}
          type="button"
          onClick={() => setDays(d)}
          aria-pressed={d === days}
          className={cn(
            'rounded-full px-2 py-0.5 transition-colors',
            d === days
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {t(`period.${d}`)}
        </button>
      ))}
    </div>
  );
  const title = (p: InsightPanel) => (
    <>
      {p.title}
      {p.market && (
        <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">
          {t('market')}
        </span>
      )}
    </>
  );
  // A new timer per panel: moving by hand gives the next panel its full time.
  useEffect(() => {
    if (!rotate || !playing || n < 2) return;
    const timer = setTimeout(() => setIndex((i) => (i + 1) % n), seconds * 1000);
    return () => clearTimeout(timer);
  }, [rotate, playing, n, seconds, index]);

  if (n === 0) return null;
  if (!rotate) {
    return (
      <div className="space-y-3">
        {panels.some((p) => p.bodies) && <div className="flex justify-end">{periodChips}</div>}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {panels.map((p) => (
            <section key={p.id} className={cn(card, 'space-y-3')}>
              <h2 className="text-sm font-medium">{title(p)}</h2>
              {bodyOf(p)}
            </section>
          ))}
        </div>
      </div>
    );
  }
  const current = index % n;
  const button =
    'rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground';
  return (
    <section className={cn(card, 'space-y-3')} aria-roledescription="carousel">
      {/* On phones the chips and buttons move under a title that would not fit beside them. */}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="min-w-[9rem] flex-1 truncate text-sm font-medium" aria-live="polite">
          {title(panels[current]!)}
        </h2>
        {panels[current]!.bodies && periodChips}
        {n > 1 && (
          <div className="flex shrink-0 items-center">
            <button
              type="button"
              className={button}
              onClick={() => setIndex((current - 1 + n) % n)}
              aria-label={t('previous')}
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              type="button"
              className={button}
              onClick={() => setPlaying(!playing)}
              aria-label={playing ? t('pause') : t('play')}
              aria-pressed={!playing}
            >
              {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
            </button>
            <button
              type="button"
              className={button}
              onClick={() => setIndex((current + 1) % n)}
              aria-label={t('next')}
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        )}
      </div>
      {/* All panels share one cell, so the card keeps the tallest one's height (no jumping). */}
      <div className="grid grid-cols-[minmax(0,1fr)]">
        {panels.map((p, i) => (
          <div
            key={p.id}
            className={cn('[grid-area:1/1]', i !== current && 'invisible')}
            aria-hidden={i !== current}
          >
            {bodyOf(p)}
          </div>
        ))}
      </div>
      {n > 1 && (
        <div className="flex justify-center gap-1.5">
          {panels.map((p, i) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={p.title}
              aria-current={i === current}
              className={cn(
                'size-1.5 rounded-full transition-colors',
                i === current ? 'bg-foreground' : 'bg-muted-foreground/30',
              )}
            />
          ))}
        </div>
      )}
    </section>
  );
}
