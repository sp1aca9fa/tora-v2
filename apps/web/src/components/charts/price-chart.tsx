'use client';

import {
  ColorType,
  CrosshairMode,
  LineSeries,
  type UTCTimestamp,
  createChart,
} from 'lightweight-charts';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { formatYen, tickMarkFormatter, useChartTheme } from './chart-theme';

export interface PriceChartPoint {
  day: string;
  source: string;
  bucket: string | null;
  medianJpy: number;
  count: number;
}

/**
 * Daily sold medians for one bucket, one line per source (fixed source -> color mapping, so a
 * toggle never repaints the others). Bucket chips pick the condition; the holding's own bucket
 * is preselected.
 */
export function PriceChart({
  points,
  defaultBucket,
  sourceLabels,
}: {
  points: PriceChartPoint[];
  defaultBucket: string | null;
  sourceLabels: Record<string, string>;
}) {
  const t = useTranslations('valuation');
  const theme = useChartTheme();
  const el = useRef<HTMLDivElement>(null);

  const buckets = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of points)
      if (p.bucket) counts.set(p.bucket, (counts.get(p.bucket) ?? 0) + p.count);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([b]) => b);
  }, [points]);
  const sources = useMemo(() => [...new Set(points.map((p) => p.source))].sort(), [points]);
  const colorOf = (s: string) => theme.series[sources.indexOf(s) % theme.series.length]!;

  const [bucket, setBucket] = useState<string | null>(
    defaultBucket && buckets.includes(defaultBucket) ? defaultBucket : (buckets[0] ?? null),
  );
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<{ day: string; values: Record<string, number> } | null>(null);
  const visible = points.filter((p) => p.bucket === bucket && !hidden.has(p.source));

  useEffect(() => {
    if (!el.current) return;
    const chart = createChart(el.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: theme.text,
        fontSize: 11,
        attributionLogo: false,
      },
      grid: { vertLines: { visible: false }, horzLines: { color: theme.grid } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, tickMarkFormatter },
      crosshair: { mode: CrosshairMode.Magnet },
      localization: { priceFormatter: formatYen },
    });
    const seriesBySource = new Map<string, ReturnType<typeof chart.addSeries<'Line'>>>();
    for (const source of sources.filter((s) => !hidden.has(s))) {
      const series = chart.addSeries(LineSeries, {
        color: colorOf(source),
        lineWidth: 2,
        pointMarkersVisible: true,
        pointMarkersRadius: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerBorderColor: theme.surface,
        crosshairMarkerBorderWidth: 2,
      });
      series.setData(
        points
          .filter((p) => p.source === source && p.bucket === bucket)
          .map((p) => ({
            time: (Date.parse(`${p.day}T00:00:00Z`) / 1000) as UTCTimestamp,
            value: p.medianJpy,
          })),
      );
      seriesBySource.set(source, series);
    }
    chart.timeScale().fitContent();
    chart.subscribeCrosshairMove((param) => {
      if (typeof param.time !== 'number') return setHover(null);
      const values: Record<string, number> = {};
      for (const [source, series] of seriesBySource) {
        const d = param.seriesData.get(series) as { value?: number } | undefined;
        if (d?.value !== undefined) values[source] = d.value;
      }
      setHover({ day: new Date(param.time * 1000).toISOString().slice(0, 10), values });
    });
    return () => chart.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, bucket, hidden, theme, sources]);

  if (points.length === 0) return <p className="text-sm text-muted-foreground">{t('noHistory')}</p>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t('bucket')}>
        {buckets.map((b) => (
          <button
            key={b}
            type="button"
            role="radio"
            aria-checked={b === bucket}
            onClick={() => setBucket(b)}
            className={cn(
              'rounded-full border px-2.5 py-1 font-mono text-xs',
              b === bucket
                ? 'border-primary bg-primary text-primary-foreground'
                : 'text-muted-foreground',
            )}
          >
            {b}
            {b === defaultBucket && ` · ${t('yours')}`}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        {sources.map((s) => (
          <label key={s} className="inline-flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              className="size-3.5"
              checked={!hidden.has(s)}
              onChange={() =>
                setHidden((h) => {
                  const next = new Set(h);
                  if (next.has(s)) next.delete(s);
                  else next.add(s);
                  return next;
                })
              }
            />
            <span
              className="h-0.5 w-4 rounded-full"
              style={{ background: colorOf(s) }}
              aria-hidden
            />
            <span>{sourceLabels[s] ?? s}</span>
            {hover?.values[s] !== undefined && (
              <span className="font-medium tabular-nums">{formatYen(hover.values[s])}</span>
            )}
          </label>
        ))}
        <span className="text-muted-foreground">
          {hover
            ? hover.day
            : t('daysWithTrades', { count: new Set(visible.map((p) => p.day)).size })}
        </span>
      </div>
      <div ref={el} className="h-56 w-full" role="img" aria-label={t('chartLabel')} />
    </div>
  );
}
