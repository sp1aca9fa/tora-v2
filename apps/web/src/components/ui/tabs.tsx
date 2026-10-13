'use client';

import { type ReactNode, useState } from 'react';
import { cn } from '@/lib/utils';

/** Underlined tabs; every panel is rendered, the others hidden. */
export function Tabs({
  tabs,
  initial,
}: {
  tabs: { key: string; label: ReactNode; content: ReactNode }[];
  initial?: string;
}) {
  const [current, setCurrent] = useState(initial ?? tabs[0]?.key);
  return (
    <div className="space-y-4">
      <div role="tablist" className="flex gap-1 overflow-x-auto border-b">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={tab.key === current}
            onClick={() => setCurrent(tab.key)}
            className={cn(
              '-mb-px shrink-0 border-b-2 px-4 py-2 text-sm font-medium transition-colors',
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
