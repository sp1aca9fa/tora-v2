'use client';

import {
  ColorType,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  LineSeries,
  type UTCTimestamp,
  createChart,
} from 'lightweight-charts';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { formatYen, tickMarkFormatter, useChartTheme } from './chart-theme';

export interface PortfolioPoint {
  date: string;
  valueJpy: number;
  costJpy: number;
  /** Part of the value counted at cost (holdings without a market price that day). */
  atCostJpy: number;
}

/**
 * Market value vs cost of everything held each day, one shared yen axis (holdings without a
 * market price count at cost in the value line). The legend above the plot
 * names both series and shows their values at the hovered day (latest day otherwise).
 */
export function PortfolioChart({ points }: { points: PortfolioPoint[] }) {
  const t = useTranslations('portfolio');
  const theme = useChartTheme();
  const el = useRef<HTMLDivElement>(null);
  const latest = points.at(-1);
  const [hover, setHover] = useState<PortfolioPoint | null>(null);
  const shown = hover ?? latest;

  useEffect(() => {
    if (!el.current) return;
    const chart: IChartApi = createChart(el.current, {
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
      handleScroll: false,
      handleScale: false,
    });
    const line = (color: string): ISeriesApi<'Line'> =>
      chart.addSeries(LineSeries, {
        color,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerRadius: 4,
        crosshairMarkerBorderColor: theme.surface,
        crosshairMarkerBorderWidth: 2,
      });
    const value = line(theme.series[0]!);
    const cost = line(theme.series[1]!);
    const ts = (date: string) => (Date.parse(`${date}T00:00:00Z`) / 1000) as UTCTimestamp;
    value.setData(points.map((p) => ({ time: ts(p.date), value: p.valueJpy })));
    cost.setData(points.map((p) => ({ time: ts(p.date), value: p.costJpy })));
    chart.timeScale().fitContent();
    const byTime = new Map(points.map((p) => [ts(p.date), p]));
    chart.subscribeCrosshairMove((param) => {
      setHover(
        typeof param.time === 'number' ? (byTime.get(param.time as UTCTimestamp) ?? null) : null,
      );
    });
    return () => chart.remove();
  }, [points, theme]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-xs">
        <span className="text-muted-foreground">{shown?.date}</span>
        {[
          { label: t('chartValue'), color: theme.series[0], v: shown?.valueJpy },
          { label: t('chartCost'), color: theme.series[1], v: shown?.costJpy },
        ].map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded-full" style={{ background: s.color }} aria-hidden />
            <span className="text-muted-foreground">{s.label}</span>
            <span className="font-medium tabular-nums">
              {s.v === undefined ? '-' : formatYen(s.v)}
            </span>
          </span>
        ))}
        {shown && shown.atCostJpy > 0 && (
          <span className="text-muted-foreground">
            {t('chartAtCost', { amount: formatYen(shown.atCostJpy) })}
          </span>
        )}
      </div>
      <div ref={el} className="h-48 w-full" role="img" aria-label={t('chartLabel')} />
    </div>
  );
}
