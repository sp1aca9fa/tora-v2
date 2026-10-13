'use client';

import { type ReactNode, useState } from 'react';
import { cn } from '@/lib/utils';

export interface SourceTab {
  key: string;
  label: string;
  /** Suggestions waiting on this source (shown as a count). */
  waiting: number;
  content: ReactNode;
}

export interface MarketTab {
  key: string;
  label: string;
  sources: SourceTab[];
}

/** Price sources: a tab per market, and inside it a tab per source. */
export function SourceTabs({
  markets,
  initial,
}: {
  markets: MarketTab[];
  /** The source shown first (its market opens with it). */
  initial: string;
}) {
  const start = markets.find((m) => m.sources.some((s) => s.key === initial)) ?? markets[0]!;
  const [market, setMarket] = useState(start.key);
  const [chosen, setChosen] = useState<Record<string, string>>({ [start.key]: initial });
  const current = markets.find((m) => m.key === market) ?? start;
  const source = chosen[current.key] ?? current.sources[0]?.key;
  const waitingIn = (m: MarketTab) => m.sources.reduce((n, s) => n + s.waiting, 0);
  const count = (n: number) =>
    n > 0 && (
      <span className="ml-1.5 rounded-full bg-amber-500/20 px-1.5 text-xs text-amber-700 dark:text-amber-300">
        {n}
      </span>
    );

  return (
    <div className="space-y-4">
      {markets.length > 1 && (
        <div role="tablist" className="flex gap-1 border-b">
          {markets.map((m) => (
            <button
              key={m.key}
              type="button"
              role="tab"
              aria-selected={m.key === current.key}
              onClick={() => setMarket(m.key)}
              className={cn(
                '-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors',
                m.key === current.key
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {m.label}
              {count(waitingIn(m))}
            </button>
          ))}
        </div>
      )}
      <div role="tablist" className="flex flex-wrap gap-1.5">
        {current.sources.map((s) => (
          <button
            key={s.key}
            type="button"
            role="tab"
            aria-selected={s.key === source}
            onClick={() => setChosen({ ...chosen, [current.key]: s.key })}
            className={cn(
              'rounded-full border px-3 py-1 text-sm transition-colors',
              s.key === source
                ? 'border-primary bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {s.label}
            {count(s.waiting)}
          </button>
        ))}
      </div>
      {markets.flatMap((m) =>
        m.sources.map((s) => (
          <div
            key={`${m.key}|${s.key}`}
            role="tabpanel"
            hidden={m.key !== current.key || s.key !== source}
            className="space-y-5"
          >
            {s.content}
          </div>
        )),
      )}
    </div>
  );
}
