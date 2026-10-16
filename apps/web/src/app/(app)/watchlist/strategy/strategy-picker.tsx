'use client';

import {
  type DayPrice,
  DEFAULT_MARGIN,
  type ReplayResult,
  STRATEGIES,
  type StrategyChoice,
  type StrategyKey,
  replay,
} from '@tora/core';
import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState, useTransition } from 'react';
import { useMoney } from '@/components/money-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { saveStrategyAction } from '../actions';

export interface StrategyTypeView {
  type: string;
  label: string;
  suggested: StrategyChoice;
  current: StrategyChoice;
  /** The person chose for this type (else the current one is the suggestion). */
  chosen: boolean;
  sample: { name: string; productId: string; condition: string | null; series: DayPrice[] } | null;
}

export function StrategyPicker({ types, asOf }: { types: StrategyTypeView[]; asOf: string }) {
  const t = useTranslations('strategy');
  const [pending, start] = useTransition();
  const unchosen = types.filter((v) => !v.chosen);
  const panels = types.map((v) => ({
    key: v.type,
    label: v.label,
    content: <TypePanel view={v} asOf={asOf} />,
  }));
  return (
    <div className="space-y-4">
      {unchosen.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/40 bg-primary/5 px-4 py-3 text-sm">
          <p>{t('suggestAll', { count: unchosen.length })}</p>
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              start(() =>
                saveStrategyAction(Object.fromEntries(unchosen.map((v) => [v.type, v.suggested]))),
              )
            }
          >
            {t('useSuggestions')}
          </Button>
        </div>
      )}
      {types.length === 0 ? (
        <p className="rounded-xl border bg-card px-4 py-6 text-sm text-muted-foreground">
          {t('noTypes')}
        </p>
      ) : types.length === 1 ? (
        panels[0]!.content
      ) : (
        <Tabs tabs={panels} />
      )}
      <p className="text-xs text-muted-foreground">{t('notAdvice')}</p>
    </div>
  );
}

const same = (a: StrategyChoice, b: StrategyChoice) =>
  a.strategy === b.strategy && (a.strategy !== 'margin' || a.margin === b.margin);

function TypePanel({ view, asOf }: { view: StrategyTypeView; asOf: string }) {
  const t = useTranslations('strategy');
  const money = useMoney();
  const [pending, start] = useTransition();
  const [picked, setPicked] = useState<StrategyKey>(view.current.strategy);
  const [margin, setMargin] = useState(
    view.current.margin ?? view.suggested.margin ?? DEFAULT_MARGIN,
  );
  const series = useMemo(() => view.sample?.series ?? [], [view.sample]);
  const results = useMemo(() => {
    const out = {} as Record<StrategyKey, ReplayResult | null>;
    for (const s of STRATEGIES) {
      out[s] =
        s === 'target' || s === 'margin' || !series.length
          ? null
          : replay(series, { strategy: s }, asOf);
    }
    return out;
  }, [series, asOf]);
  const marginResult = useMemo(
    () => (series.length ? replay(series, { strategy: 'margin', margin }, asOf) : null),
    [series, asOf, margin],
  );
  const resultOf = (s: StrategyKey) => (s === 'margin' ? marginResult : results[s]);
  const choice: StrategyChoice =
    picked === 'margin' ? { strategy: 'margin', margin } : { strategy: picked };
  const inUse = view.chosen && same(choice, view.current);

  return (
    <div className="space-y-4">
      {view.sample ? (
        <div className="space-y-2 rounded-xl border bg-card p-4">
          <p className="text-sm">
            {t('example')} <span className="font-medium">{view.sample.name}</span>
            {view.sample.condition && (
              <span className="ml-1 font-mono text-xs text-muted-foreground">
                {view.sample.condition}
              </span>
            )}
          </p>
          <SampleChart
            series={series}
            asOf={asOf}
            calls={resultOf(picked)?.calls ?? []}
            label={(n) => money(n)}
          />
          <p className="text-xs text-muted-foreground">{t('chartLegend')}</p>
        </div>
      ) : (
        <p className="rounded-xl border bg-card px-4 py-4 text-sm text-muted-foreground">
          {t('noSample')}
        </p>
      )}

      <ul className="grid gap-2 sm:grid-cols-2">
        {STRATEGIES.map((s) => {
          const r = resultOf(s);
          const active = s === picked;
          return (
            <li key={s}>
              <button
                type="button"
                onClick={() => setPicked(s)}
                aria-pressed={active}
                className={cn(
                  'h-full w-full space-y-1 rounded-xl border bg-card p-3 text-left text-sm transition-colors',
                  active ? 'border-primary ring-1 ring-primary' : 'hover:bg-accent/50',
                )}
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{t(`name.${s}`)}</span>
                  {view.suggested.strategy === s && (
                    <span className="rounded bg-primary/10 px-1.5 text-xs text-primary">
                      {t('suggested')}
                    </span>
                  )}
                  {view.chosen && view.current.strategy === s && (
                    <span className="inline-flex items-center gap-0.5 rounded bg-emerald-500/15 px-1.5 text-xs text-emerald-700 dark:text-emerald-300">
                      <Check className="size-3" /> {t('inUse')}
                    </span>
                  )}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {t(`about.${s}`, { margin })}
                </span>
                {r && (
                  <span className="block text-xs">
                    {t('calls', { count: r.calls.length })}
                    {r.avgPaid !== null && r.avgAll ? (
                      <>
                        {' · '}
                        {t(r.avgPaid <= r.avgAll ? 'paidUnder' : 'paidOver', {
                          pct: Math.abs(Math.round((r.avgPaid / r.avgAll - 1) * 100)),
                        })}
                      </>
                    ) : null}
                    {r.checked > 0 && (
                      <>
                        {' · '}
                        {t('after90', { higher: r.higher, checked: r.checked })}
                      </>
                    )}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {picked === 'margin' && (
        <label className="flex items-center gap-2 text-sm">
          {t('marginLabel')}
          <Input
            type="number"
            min={1}
            max={50}
            value={margin}
            onChange={(e) => setMargin(Math.min(50, Math.max(1, Number(e.target.value) || 1)))}
            className="w-20"
          />
          %
        </label>
      )}

      <Button
        disabled={pending || inUse}
        onClick={() => start(() => saveStrategyAction({ [view.type]: choice }))}
      >
        {inUse ? t('inUse') : t('use', { name: t(`name.${picked}`), type: view.label })}
      </Button>
    </div>
  );
}

/** The sample's daily prices over the last year, with the days a strategy called a buy. */
function SampleChart({
  series,
  asOf,
  calls,
  label,
}: {
  series: DayPrice[];
  asOf: string;
  calls: string[];
  label: (n: number) => string;
}) {
  const end = Date.parse(`${asOf}T00:00:00Z`);
  const start = end - 365 * 86_400_000;
  const points = series.filter((p) => {
    const d = Date.parse(`${p.day}T00:00:00Z`);
    return d > start && d <= end;
  });
  if (points.length < 2) return null;
  const prices = points.map((p) => p.price);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const W = 600;
  const H = 160;
  const x = (day: string) => ((Date.parse(`${day}T00:00:00Z`) - start) / (end - start)) * W;
  const y = (v: number) => (hi === lo ? H / 2 : H - 8 - ((v - lo) / (hi - lo)) * (H - 16));
  const called = new Set(calls);
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-40 w-full" preserveAspectRatio="none" aria-hidden>
        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
          className="text-muted-foreground"
          points={points.map((p) => `${x(p.day)},${y(p.price)}`).join(' ')}
        />
        {points
          .filter((p) => called.has(p.day))
          .map((p) => (
            <circle
              key={p.day}
              cx={x(p.day)}
              cy={y(p.price)}
              r={3.5}
              className="fill-emerald-600 dark:fill-emerald-400"
            />
          ))}
      </svg>
      <span className="amount absolute top-0 left-0 text-xs text-muted-foreground tabular-nums">
        {label(hi)}
      </span>
      <span className="amount absolute bottom-0 left-0 text-xs text-muted-foreground tabular-nums">
        {label(lo)}
      </span>
    </div>
  );
}
