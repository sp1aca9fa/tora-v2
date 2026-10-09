'use client';

import { useSyncExternalStore } from 'react';

/**
 * Chart colors by role. Categorical slots 1-3 of the validated reference palette (light and
 * dark steps, all-pairs CVD-safe); text and grid stay neutral. Aqua is under 3:1 on white, so
 * every chart has a legend and a table view.
 */
const LIGHT = {
  series: ['#2a78d6', '#eb6834', '#1baf7a'],
  text: '#52514e',
  grid: 'rgba(0,0,0,0.06)',
  surface: '#ffffff',
};
const DARK = {
  series: ['#3987e5', '#d95926', '#199e70'],
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

const yen = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' });
export const formatYen = (v: number) => yen.format(Math.round(v));

/** Axis labels as M/D (the library default rendered a stray "0" at the year boundary). */
export const tickMarkFormatter = (time: unknown) => {
  if (typeof time !== 'number') return '';
  const d = new Date(time * 1000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
};

/** Fixed color slot per source, so a source keeps its color everywhere (badges and charts). */
const SOURCE_SLOTS: Record<string, number> = { snkrdunk: 0, mercari: 1, surugaya: 2 };

export function sourceColor(theme: ChartTheme, source: string, others: string[] = []): string {
  const slot = SOURCE_SLOTS[source] ?? Math.max(0, others.indexOf(source));
  return theme.series[slot % theme.series.length]!;
}
