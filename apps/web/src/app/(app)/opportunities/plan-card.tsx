'use client';

import {
  type MixOption,
  type PlanStep,
  checkPlan,
  monthEnd,
  monthlyRoom,
  nameSearch,
  suggestMix,
  swapInMix,
} from '@tora/core';
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
 * picks. A name search (`q`) narrows the list and the mix; ticked items it hides still count.
 * Every month (S27): the budget is a monthly amount, this month's purchases count against it and
 * the plan runs to the month's end. Saved with Save.
 */
export function PlanCard({
  rows,
  budget: savedBudget,
  until: savedUntil,
  monthly: savedMonthly,
  spent,
  today,
  q,
}: {
  rows: PlanRow[];
  budget: number | null;
  until: string | null;
  monthly: boolean;
  /** This month's purchases: their cost, how many lots (with no cost), their keys. */
  spent: { total: number; lots: number; noCost: number; keys: string[] };
  today: string;
  q: string | null;
}) {
  const t = useTranslations('opportunities');
  const tAll = useTranslations();
  const money = useMoney();
  const [budget, setBudget] = useState(money.input(savedBudget));
  const [until, setUntil] = useState(savedUntil ?? '');
  const [monthly, setMonthly] = useState(savedMonthly);
  const [ticked, setTicked] = useState(
    new Set(rows.filter((r) => r.ticked).map((r) => `${r.productId}|${r.bucket}`)),
  );
  const [message, setMessage] = useState<string | null>(null);
  // The picks of the last suggested mix: they can be swapped.
  const [suggested, setSuggested] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const amount = money.parse(budget);
  // A monthly plan: what is left of this month's amount, by the month's last day.
  const by = monthly ? monthEnd(today) : until;
  const bought = new Set(monthly ? spent.keys : []);
  const month = amount !== null ? monthlyRoom(amount, spent.total, bought, ticked) : null;
  const room = monthly ? (month?.room ?? null) : amount;
  const chosen = rows.filter((r) => ticked.has(`${r.productId}|${r.bucket}`));
  // Ticked items bought this month are in what was spent, not counted again.
  const toBuy = chosen.filter((r) => !bought.has(`${r.productId}|${r.bucket}`));
  const check = useMemo(
    () =>
      room !== null
        ? checkPlan(
            toBuy.map((r) => r.step),
            room,
            by || '9999-12-31',
          )
        : null,
    [toBuy, room, by],
  );
  const match = q ? nameSearch(q) : null;
  const searched = match ? rows.filter((r) => match(r.name)) : rows;
  // Items bought this month are not offered again.
  const options = searched.filter((r) => !bought.has(r.mix.key)).map((r) => r.mix);
  const suggest = () => {
    if (room === null) return;
    const mix = suggestMix(options, Math.max(0, room), by || null);
    // Ticked items bought this month stay ticked (they are in what was spent).
    setTicked(new Set([...mix, ...[...ticked].filter((k) => bought.has(k))]));
    setSuggested(new Set(mix));
    const used = mix.reduce(
      (sum, k) => sum + (options.find((o) => o.key === k)?.step.price ?? 0),
      0,
    );
    // Few items with a reason to buy: the rest of the budget is left free, not filled.
    setMessage(
      !mix.length
        ? t('plan.noMix')
        : used < room * 0.7
          ? t('plan.thinMix', { count: mix.length })
          : null,
    );
  };
  const swap = (key: string) => {
    if (room === null) return;
    const next = swapInMix(
      options,
      month && monthly ? month.toBuy : [...ticked],
      key,
      Math.max(0, room),
      by || null,
    );
    if (!next) {
      setMessage(t('plan.noSwap'));
      return;
    }
    setTicked(new Set([...ticked].filter((k) => k !== key).concat(next)));
    setSuggested(new Set([...suggested].filter((k) => k !== key).concat(next)));
    setMessage(null);
  };
  // Shown: the items offered, and those a mix picked.
  const offered = (list: PlanRow[]) =>
    list.filter((r) => r.from.length || ticked.has(`${r.productId}|${r.bucket}`));
  const shown = offered(searched);
  // Buy now first, then by day, then the prices to wait for.
  const order = { now: 0, from: 1, under: 2, none: 3 };
  const sorted = shown.toSorted(
    (a, b) =>
      order[a.step.when] - order[b.step.when] ||
      (a.step.day ?? '').localeCompare(b.step.day ?? '') ||
      a.name.localeCompare(b.name),
  );
  // What to buy now, what to wait on (a day, a price), what has no price yet (S27).
  const groups = (
    [
      ['now', sorted.filter((r) => r.step.when === 'now')],
      ['wait', sorted.filter((r) => r.step.when === 'from' || r.step.when === 'under')],
      ['none', sorted.filter((r) => r.step.when === 'none')],
    ] as const
  ).filter(([, list]) => list.length > 0);
  const boughtTicked = chosen.length - toBuy.length;
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
        <label className="flex h-9 items-center gap-2">
          <input
            type="checkbox"
            className="size-4"
            checked={monthly}
            onChange={(e) => setMonthly(e.target.checked)}
          />
          <span>{t('plan.monthly')}</span>
        </label>
        {!monthly && (
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
        )}
        <Button size="sm" disabled={amount === null} onClick={suggest}>
          {t('plan.suggest')}
        </Button>
        {amount === null && (
          <span className="text-xs text-muted-foreground">{t('plan.needBudget')}</span>
        )}
      </div>
      {monthly && <p className="text-xs text-muted-foreground">{t('plan.monthlyNote')}</p>}
      {monthly && amount !== null && room !== null && (
        <div className="max-w-md space-y-1">
          <p className="text-sm">
            <span
              className={cn('text-base font-semibold tabular-nums', room < 0 && 'text-destructive')}
            >
              {t(room < 0 ? 'plan.monthOver' : 'plan.monthLeft', { left: money(Math.abs(room)) })}
            </span>{' '}
            <span className="text-muted-foreground">
              {t('plan.monthSpent', {
                spent: money(spent.total),
                budget: money(amount),
                count: spent.lots,
                end: monthEnd(today).slice(5).replace('-', '/'),
              })}
              {spent.noCost > 0 && ` ${t('plan.noCost', { count: spent.noCost })}`}
            </span>
          </p>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={cn('h-full', room < 0 ? 'bg-destructive' : 'bg-primary')}
              style={{
                width: `${amount > 0 ? Math.min(100, (spent.total / amount) * 100) : 100}%`,
              }}
            />
          </div>
        </div>
      )}
      {q && (
        <p className="text-xs text-muted-foreground">
          {t('plan.searched', { shown: shown.length, all: offered(rows).length, q })}{' '}
          <Link href="/opportunities/plan" className="underline">
            {t('search.clear')}
          </Link>
        </p>
      )}
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {q ? t('search.none', { q }) : t('plan.empty')}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">{t('plan.listFrom')}</p>
      )}
      {groups.map(([group, list]) => (
        <div key={group} className="space-y-2">
          <h3 className="text-sm font-medium">
            {t(`plan.group.${group}`, { count: list.length })}
          </h3>
          {group === 'none' && (
            <p className="text-xs text-muted-foreground">{t('plan.groupNoneNote')}</p>
          )}
          <ul className="grid gap-2 text-sm lg:grid-cols-2 2xl:grid-cols-3">
            {list.map((r) => {
              const key = `${r.productId}|${r.bucket}`;
              const late = !!by && r.step.when === 'from' && (r.step.day ?? '') > by;
              const boughtNow = bought.has(key) && ticked.has(key);
              return (
                <li key={key} className="flex items-start gap-3 rounded-lg border px-3 py-2">
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
                    {boughtNow && (
                      <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                        {t('plan.boughtMonth')}
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
                    <p className="text-muted-foreground">
                      {r.step.when === 'none'
                        ? t('plan.notCounted')
                        : t(`plan.reason.${r.step.reason}`)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 flex flex-wrap items-center gap-3 rounded-lg border bg-card/95 p-3 backdrop-blur md:bottom-4">
        {check && (
          <p
            className={cn(
              'text-sm',
              check.left < 0 ? 'text-destructive' : 'text-emerald-700 dark:text-emerald-400',
            )}
          >
            {t('plan.total', {
              count: toBuy.length,
              total: money(check.total),
              left: money(Math.abs(check.left)),
              over: check.left < 0 ? 'over' : 'left',
            })}
            {boughtTicked > 0 && ` ${t('plan.boughtCount', { count: boughtTicked })}`}
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
                monthly,
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
