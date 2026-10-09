'use client';

import { sourceColor, useChartTheme } from '@/components/charts/chart-theme';
import { sourceLabel } from '@/lib/product-display';

const INITIALS: Record<string, string> = {
  snkrdunk: 'S',
  mercari: 'M',
  surugaya: '駿',
  ebay: 'e',
  tcgcsv: 'T',
};

/** Small square mark in the source's fixed color, followed by its name. */
export function SourceBadge({ source, withName = true }: { source: string; withName?: boolean }) {
  const theme = useChartTheme();
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        className="inline-flex size-4 items-center justify-center rounded text-[10px] leading-none font-bold text-white"
        style={{ background: sourceColor(theme, source) }}
      >
        {INITIALS[source] ?? source.slice(0, 1).toUpperCase()}
      </span>
      {withName && <span>{sourceLabel(source)}</span>}
    </span>
  );
}
