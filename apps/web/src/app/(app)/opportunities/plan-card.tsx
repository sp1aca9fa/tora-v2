'use client';

import { type PlanStep, checkPlan } from '@tora/core';
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
  from: ('opportunity' | 'watch' | 'plan')[];
  ticked: boolean;
}

/**
 * A budget and a date (S13 part 4): each item offered with when to buy and at what price; the
 * person ticks items and sees whether they fit. Saved with Save.
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
  const [pending, startTransition] = useTransition();
  const amount = money.parse(budget);
  const chosen = rows.filter((r) => ticked.has(`${r.productId}|${r.bucket}`));
  const check = useMemo(
    () =>
      amount !== null && until
        ? checkPlan(
            chosen.map((r) => r.step),
            amount,
            until,
          )
        : null,
    [chosen, amount, until],
  );
  // Buy now first, then by day, then the prices to wait for.
  const order = { now: 0, from: 1, under: 2, none: 3 };
  const sorted = rows.toSorted(
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
        <Button
          size="sm"
          disabled={pending || amount === null || !until}
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
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('plan.empty')}</p>
      ) : (
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
                    {r.bucket && <span>{bucketLabel(r.bucket, tAll)} · </span>}
                    {r.from.map((f) => t(`plan.fromKind.${f}`)).join(' · ')}
                  </p>
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
                  <p className="text-muted-foreground">{t(`plan.reason.${r.step.reason}`)}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {check && chosen.length > 0 && (
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
    </section>
  );
}
