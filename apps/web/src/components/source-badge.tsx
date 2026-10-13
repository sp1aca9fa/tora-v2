'use client';

import { sourceColor, useChartTheme } from '@/components/charts/chart-theme';
import { useSourceDisplay } from '@/components/sources-context';

/** Small square mark in the source's fixed color, followed by its name. */
export function SourceBadge({ source, withName = true }: { source: string; withName?: boolean }) {
  const theme = useChartTheme();
  const display = useSourceDisplay()(source);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        className="inline-flex size-4 items-center justify-center rounded text-[10px] leading-none font-bold text-white"
        style={{ background: sourceColor(theme, source, [], display?.slot) }}
      >
        {display?.badge ?? source.slice(0, 1).toUpperCase()}
      </span>
      {withName && <span>{display?.label ?? source}</span>}
    </span>
  );
}
