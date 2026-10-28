'use client';

import { type MixOption, type PlanStep, checkPlan, suggestMix, swapInMix } from '@tora/core';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useMemo, useState, useTransition } from 'react';
import { useMoney } from '@/components/money-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { savePlanAction } from './actions';
import { bucketLabel } from '@/lib/product-display';

export interface PlanRow {
  productId: string;
  bucket: string;
  name: string;
  step: PlanStep;
  /** None: an item only a suggested mix brings in. */
  from: ('opportunity' | 'watch' | 'plan')[];
  ticked: boolean;
  mix: MixOption;
  /** Its proven signals' (and admin's picks') names. */
  signals: string[];
}

/**
 * A budget and a date (S13 part 4): each item offered with when to buy and at what price; the
 * person ticks items and sees whether they fit, or has a varied mix suggested (S27) and swaps its
 * picks. Saved with Save.
 */
export function PlanCard({
  rows,
  budget: savedBudget,
  until: savedUntil,
  today,
}: {
  rows: PlanRow[];
  budget: number | null;
  until: string | null;
  today: string;
}) {
  const t = useTranslations('opportunities');
  const tAll = useTranslations();
  const money = useMoney();
  const [budget, setBudget] = useState(money.input(savedBudget));
  const [until, setUntil] = useState(savedUntil ?? '');
  const [ticked, setTicked] = useState(
    new Set(rows.filter((r) => r.ticked).map((r) => `${r.productId}|${r.bucket}`)),
  );
  const [message, setMessage] = useState<string | null>(null);
  // The picks of the last suggested mix: they can be swapped.
  const [suggested, setSuggested] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const amount = money.parse(budget);
  const chosen = rows.filter((r) => ticked.has(`${r.productId}|${r.bucket}`));
  const check = useMemo(
    () =>
      amount !== null
        ? checkPlan(
            chosen.map((r) => r.step),
            amount,
            until || '9999-12-31',
          )
        : null,
    [chosen, amount, until],
  );
  const options = rows.map((r) => r.mix);
  const suggest = () => {
    if (amount === null) return;
    const mix = suggestMix(options, amount, until || null);
    setTicked(new Set(mix));
    setSuggested(new Set(mix));
    const spent = mix.reduce(
      (sum, k) => sum + (options.find((o) => o.key === k)?.step.price ?? 0),
      0,
    );
    // Few items with a reason to buy: the rest of the budget is left free, not filled.
    setMessage(
      !mix.length
        ? t('plan.noMix')
        : spent < amount * 0.7
          ? t('plan.thinMix', { count: mix.length })
          : null,
    );
  };
  const swap = (key: string) => {
    if (amount === null) return;
    const next = swapInMix(options, [...ticked], key, amount, until || null);
    if (!next) {
      setMessage(t('plan.noSwap'));
      return;
    }
    setTicked(new Set([...ticked].filter((k) => k !== key).concat(next)));
    setSuggested(new Set([...suggested].filter((k) => k !== key).concat(next)));
    setMessage(null);
  };
  // Shown: the items offered, and those a mix picked.
  const shown = rows.filter((r) => r.from.length || ticked.has(`${r.productId}|${r.bucket}`));
  // Buy now first, then by day, then the prices to wait for.
  const order = { now: 0, from: 1, under: 2, none: 3 };
  const sorted = shown.toSorted(
    (a, b) =>
      order[a.step.when] - order[b.step.when] ||
      (a.step.day ?? '').localeCompare(b.step.day ?? '') ||
      a.name.localeCompare(b.name),
  );
  const whenText = (s: PlanStep) =>
    s.when === 'now'
      ? t('plan.now')
      : s.when === 'from'
        ? t('plan.from', { day: s.day ?? '' })
        : s.when === 'under'
          ? t('plan.under', { price: s.price !== null ? money(s.price) : '-' })
          : t('plan.none');

  return (
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <div className="space-y-1">
        <h2 className="font-semibold">{t('plan.title')}</h2>
        <p className="max-w-3xl text-xs text-muted-foreground">{t('plan.intro')}</p>
        <details className="max-w-3xl text-xs text-muted-foreground">
          <summary className="cursor-pointer">{t('plan.howTitle')}</summary>
          <p className="mt-1">{t('plan.how')}</p>
        </details>
      </div>
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">
            {t('plan.budget', { symbol: money.symbol })}
          </span>
          <Input
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            inputMode="decimal"
            className="h-9 w-36"
          />
        </label>
        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">{t('plan.until')}</span>
          <Input
            type="date"
            value={until}
            min={today}
            onChange={(e) => setUntil(e.target.value)}
            className="h-9 w-44"
          />
        </label>
        <Button size="sm" disabled={amount === null} onClick={suggest}>
          {t('plan.suggest')}
        </Button>
        {amount === null && (
          <span className="text-xs text-muted-foreground">{t('plan.needBudget')}</span>
        )}
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('plan.empty')}</p>
      ) : (
        <h3 className="text-xs font-medium text-muted-foreground">{t('plan.listFrom')}</h3>
      )}
      {shown.length > 0 && (
        <ul className="divide-y rounded-lg border text-sm">
          {sorted.map((r) => {
            const key = `${r.productId}|${r.bucket}`;
            const late = !!until && r.step.when === 'from' && (r.step.day ?? '') > until;
            return (
              <li key={key} className="flex items-start gap-3 px-3 py-2">
                <input
                  type="checkbox"
                  className="mt-1 size-4"
                  checked={ticked.has(key)}
                  onChange={(e) => {
                    const next = new Set(ticked);
                    if (e.target.checked) next.add(key);
                    else next.delete(key);
                    setTicked(next);
                  }}
                />
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/products/${r.productId}/buy${r.bucket ? `?condition=${encodeURIComponent(r.bucket)}` : ''}`}
                    className="line-clamp-2 hover:underline"
                  >
                    {r.name}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {[
                      r.bucket && bucketLabel(r.bucket, tAll),
                      ...r.from.map((f) => t(`plan.fromKind.${f}`)),
                      !r.from.length && t('plan.fromKind.mix'),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  {r.signals.length > 0 && (
                    <p className="text-xs text-emerald-700 dark:text-emerald-400">
                      {r.signals.join(' · ')}
                    </p>
                  )}
                  {suggested.has(key) && ticked.has(key) && (
                    <button
                      type="button"
                      className="text-xs text-muted-foreground underline"
                      onClick={() => swap(key)}
                    >
                      {t('plan.swap')}
                    </button>
                  )}
                </div>
                <div className="shrink-0 text-right text-xs">
                  <p
                    className={cn(
                      'font-medium',
                      r.step.when === 'now' && 'text-emerald-700 dark:text-emerald-400',
                      late && 'text-amber-700 dark:text-amber-300',
                    )}
                  >
                    {whenText(r.step)}
                  </p>
                  {r.step.price !== null && r.step.when !== 'under' && (
                    <p className="tabular-nums">{money(r.step.price)}</p>
                  )}
                  {r.step.when !== 'none' && (
                    <p className="text-muted-foreground">{t(`plan.reason.${r.step.reason}`)}</p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {check && (
          <p
            className={cn(
              'text-sm',
              check.left < 0 ? 'text-destructive' : 'text-emerald-700 dark:text-emerald-400',
            )}
          >
            {t('plan.total', {
              count: chosen.length,
              total: money(check.total),
              left: money(Math.abs(check.left)),
              over: check.left < 0 ? 'over' : 'left',
            })}
            {check.late > 0 && ` ${t('plan.late', { count: check.late })}`}
            {check.undated > 0 && ` ${t('plan.undated', { count: check.undated })}`}
          </p>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={pending || amount === null}
          onClick={() =>
            startTransition(async () => {
              const r = await savePlanAction({
                budget: amount ?? 0,
                until,
                items: chosen.map((c) => ({ productId: c.productId, bucket: c.bucket })),
              });
              setMessage(r.error ? t(`plan.error.${r.error}`) : t('plan.saved'));
            })
          }
        >
          {t('plan.save')}
        </Button>
        {message && <span className="text-xs text-muted-foreground">{message}</span>}
      </div>
    </section>
  );
}
