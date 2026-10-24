'use client';

import { useSyncExternalStore } from 'react';

/**
 * Chart colors by role. The eight categorical slots of the validated reference palette in its
 * order (light and dark steps; CVD-safe for neighbours, as lines and bars need); text and grid
 * stay neutral. Aqua, yellow and magenta are under 3:1 on white, so every chart has a legend and
 * a table view.
 */
const LIGHT = {
  series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
  text: '#52514e',
  grid: 'rgba(0,0,0,0.06)',
  surface: '#ffffff',
};
const DARK = {
  series: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
  text: '#c3c2b7',
  grid: 'rgba(255,255,255,0.08)',
  surface: '#1c1c1c',
};
export type ChartTheme = typeof LIGHT;

const query = '(prefers-color-scheme: dark)';
const subscribe = (cb: () => void) => {
  const m = window.matchMedia(query);
  m.addEventListener('change', cb);
  return () => m.removeEventListener('change', cb);
};

export function useChartTheme(): ChartTheme {
  const dark = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
  return dark ? DARK : LIGHT;
}

/** Axis labels as M/D (the library default rendered a stray "0" at the year boundary). */
export const tickMarkFormatter = (time: unknown) => {
  if (typeof time !== 'number') return '';
  const d = new Date(time * 1000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
};

/**
 * A source's colour: its fixed slot (from the source registry's order, so a source keeps its
 * colour everywhere, badges and charts), else its place among the sources shown.
 */
export function sourceColor(
  theme: ChartTheme,
  source: string,
  others: string[] = [],
  slot?: number,
): string {
  const at = slot ?? Math.max(0, others.indexOf(source));
  return theme.series[at % theme.series.length]!;
}
