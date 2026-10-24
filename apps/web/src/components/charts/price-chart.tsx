'use client';

import {
  AreaSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  LineSeries,
  type UTCTimestamp,
  createChart,
} from 'lightweight-charts';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useAmountsHidden } from '@/components/amounts-toggle';
import { useSourceDisplay } from '@/components/sources-context';
import { sourceColor, tickMarkFormatter, useChartTheme } from './chart-theme';
import { useMoney } from '@/components/money-context';
import { bucketLabel } from '@/lib/product-display';

export interface PriceChartPoint {
  day: string;
  source: string;
  bucket: string | null;
  medianBase: number;
  count: number;
  /** Trades that day whose lot size was estimated (the source did not report it). */
  estimated: number;
}

/** Buy timing's lines over the chart, in the item's main condition (S22). */
export interface PriceGuides {
  /** The buy zone's top: everything under it is shaded. */
  zoneTop: number | null;
  /** The lower and upper quarter of the last 180 days' daily prices. */
  low: number | null;
  high: number | null;
  /** The lowest ask now. */
  ask: number | null;
}

const ZONE_LINE = 'rgba(16,185,129,0.7)';
const ZONE_FILL = 'rgba(16,185,129,0.12)';
const ASK_COLOR = '#d97706';

/**
 * Daily sold medians for one bucket, one line per source (fixed source -> color mapping, so a
 * toggle never repaints the others). Bucket chips pick the condition; the holding's own bucket
 * is preselected.
 */
export function PriceChart({
  points,
  defaultBucket,
  sourceLabels,
  guides,
  className = 'h-56',
}: {
  points: PriceChartPoint[];
  defaultBucket: string | null;
  sourceLabels: Record<string, string>;
  /** Shown while the main condition (`defaultBucket`) is picked. */
  guides?: PriceGuides;
  /** The chart's height. */
  className?: string;
}) {
  const money = useMoney();
  const locale = useLocale();
  const t = useTranslations('valuation');
  const tAll = useTranslations();
  const tg = useTranslations('buy.chart');
  const theme = useChartTheme();
  // Amounts hidden: the lines stay, the yen axis and hover labels go.
  const amountsHidden = useAmountsHidden();
  const el = useRef<HTMLDivElement>(null);

  const buckets = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of points)
      if (p.bucket) counts.set(p.bucket, (counts.get(p.bucket) ?? 0) + p.count);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([b]) => b);
  }, [points]);
  const sources = useMemo(() => [...new Set(points.map((p) => p.source))].sort(), [points]);
  const display = useSourceDisplay();
  // Each source's fixed colour; if two on this chart would share one (more sources than colours),
  // their place among the chart's sources instead.
  const fixed =
    new Set(sources.map((s) => (display(s)?.slot ?? -1) % theme.series.length)).size ===
      sources.length && sources.every((s) => display(s));
  const colorOf = (s: string) =>
    fixed ? sourceColor(theme, s, sources, display(s)?.slot) : sourceColor(theme, s, sources);

  const [bucket, setBucket] = useState<string | null>(
    defaultBucket && buckets.includes(defaultBucket) ? defaultBucket : (buckets[0] ?? null),
  );
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<{ day: string; values: Record<string, number> } | null>(null);
  const visible = points.filter((p) => p.bucket === bucket && !hidden.has(p.source));
  const shownGuides = guides && bucket === defaultBucket ? guides : null;

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
      rightPriceScale: { borderVisible: false, visible: !amountsHidden },
      timeScale: { borderVisible: false, tickMarkFormatter },
      crosshair: { mode: CrosshairMode.Magnet, horzLine: { labelVisible: !amountsHidden } },
      localization: { priceFormatter: money, locale },
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
            value: p.medianBase,
          })),
      );
      seriesBySource.set(source, series);
    }
    const days = points
      .filter((p) => p.bucket === bucket)
      .map((p) => p.day)
      .sort();
    if (shownGuides && days.length) {
      const values = [shownGuides.zoneTop, shownGuides.low, shownGuides.high, shownGuides.ask];
      const known = values.filter((v): v is number => v !== null);
      // The zone as a shaded area under its top; the other guides as lines on it. The scale
      // stretches to keep them all in view.
      const zone = chart.addSeries(AreaSeries, {
        lineColor: shownGuides.zoneTop !== null ? ZONE_LINE : 'transparent',
        topColor: shownGuides.zoneTop !== null ? ZONE_FILL : 'transparent',
        bottomColor: shownGuides.zoneTop !== null ? ZONE_FILL : 'transparent',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        autoscaleInfoProvider: () =>
          known.length
            ? { priceRange: { minValue: Math.min(...known), maxValue: Math.max(...known) } }
            : null,
      });
      const level = shownGuides.zoneTop ?? known[0];
      if (level !== undefined) {
        zone.setData(
          [days[0]!, days.at(-1)!].map((day) => ({
            time: (Date.parse(`${day}T00:00:00Z`) / 1000) as UTCTimestamp,
            value: level,
          })),
        );
      }
      const line = (price: number | null, color: string, lineStyle: LineStyle, title: string) =>
        price !== null &&
        zone.createPriceLine({
          price,
          color,
          lineWidth: 1,
          lineStyle,
          axisLabelVisible: !amountsHidden,
          title: amountsHidden ? '' : title,
        });
      line(shownGuides.low, theme.text, LineStyle.Dotted, tg('lowShort'));
      line(shownGuides.high, theme.text, LineStyle.Dotted, tg('highShort'));
      line(shownGuides.ask, ASK_COLOR, LineStyle.Dashed, tg('askShort'));
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
  }, [points, bucket, hidden, theme, sources, amountsHidden, money, locale, shownGuides]);

  if (points.length === 0) return <p className="text-sm text-muted-foreground">{t('noHistory')}</p>;
  const estimatedDays = new Set(visible.filter((p) => p.estimated > 0).map((p) => p.day));
  const lastEstimated = [...estimatedDays].sort().at(-1);

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
              'rounded-full border px-2.5 py-1 text-xs',
              b === bucket
                ? 'border-primary bg-primary text-primary-foreground'
                : 'text-muted-foreground',
            )}
          >
            {bucketLabel(b, tAll)}
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
              <span className="font-medium tabular-nums">{money(hover.values[s])}</span>
            )}
          </label>
        ))}
        <span className="text-muted-foreground">
          {hover
            ? hover.day
            : t('daysWithTrades', { count: new Set(visible.map((p) => p.day)).size })}
          {hover && estimatedDays.has(hover.day) && (
            <span className="text-amber-700 dark:text-amber-400"> · {t('estimatedDay')}</span>
          )}
        </span>
      </div>
      {lastEstimated && (
        <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          {t('estimatedNote', { date: lastEstimated })}
        </p>
      )}
      <div ref={el} className={cn('w-full', className)} role="img" aria-label={t('chartLabel')} />
      {shownGuides && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {shownGuides.zoneTop !== null && (
            <li className="inline-flex items-center gap-1.5">
              <span
                className="h-2.5 w-4 rounded-sm border"
                style={{ background: ZONE_FILL, borderColor: ZONE_LINE }}
                aria-hidden
              />
              {tg('zone', { amount: money(shownGuides.zoneTop) })}
            </li>
          )}
          {shownGuides.low !== null && shownGuides.high !== null && (
            <li className="inline-flex items-center gap-1.5">
              <span className="w-4 border-t border-dotted border-current" aria-hidden />
              {tg('range', { low: money(shownGuides.low), high: money(shownGuides.high) })}
            </li>
          )}
          {shownGuides.ask !== null && (
            <li className="inline-flex items-center gap-1.5">
              <span
                className="w-4 border-t border-dashed"
                style={{ borderColor: ASK_COLOR }}
                aria-hidden
              />
              {tg('ask', { amount: money(shownGuides.ask) })}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
