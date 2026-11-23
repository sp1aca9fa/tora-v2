'use client';

import { type ReactNode, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Underlined tabs; every panel is rendered, the others hidden. With `param`, the chosen tab is kept
 * in the address (`?<param>=<key>`), so a tab can be linked to and survives a reload.
 */
export function Tabs({
  tabs,
  initial,
  param,
}: {
  tabs: { key: string; label: ReactNode; content: ReactNode }[];
  initial?: string;
  param?: string;
}) {
  const [current, setCurrent] = useState(initial ?? tabs[0]?.key);
  const choose = (key: string) => {
    setCurrent(key);
    if (!param) return;
    const url = new URL(window.location.href);
    if (key === tabs[0]?.key) url.searchParams.delete(param);
    else url.searchParams.set(param, key);
    window.history.replaceState(window.history.state, '', url);
  };
  return (
    <div className="space-y-4">
      {/* Scrolls sideways on narrow screens without a scrollbar; the line is a shadow under the
          tabs, so the selected tab's underline covers it without overflowing downwards. */}
      <div
        role="tablist"
        className="flex gap-1 overflow-x-auto shadow-[inset_0_-1px_0_var(--border)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={tab.key === current}
            onClick={() => choose(tab.key)}
            className={cn(
              'shrink-0 border-b-2 px-4 py-2 text-sm font-medium transition-colors',
              tab.key === current
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div key={tab.key} role="tabpanel" hidden={tab.key !== current}>
          {tab.content}
        </div>
      ))}
    </div>
  );
}
