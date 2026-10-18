import { type Judgement, type SignalStats, type StrategyChoice, judge } from '@tora/core';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getMoney } from '@/lib/money-server';
import { lineLabel } from '@/lib/product-display';
import { cn } from '@/lib/utils';

export const VERDICT_STYLE: Record<string, string> = {
  good: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  wait: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  fair: 'bg-muted text-muted-foreground',
  high: 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
  none: 'bg-muted text-muted-foreground',
};

/** The verdict's label: a wait only for a new release says so. */
export const verdictKey = (j: Judgement) =>
  j.verdict === 'wait' && j.newRelease && !j.falling && !j.marketFalling ? 'newRelease' : j.verdict;

/**
 * Buy timing (S9 part 4): the verdict of the person's strategy on today's numbers, the buy zone
 * and every number behind it. Never a sure thing.
 */
export async function BuyTiming({
  stats,
  choice,
  typeLabel,
  condition,
}: {
  stats: SignalStats | null;
  choice: StrategyChoice;
  typeLabel: string;
  condition: string | null;
}) {
  const [t, money] = await Promise.all([getTranslations(), getMoney()]);
  const strategyLine = (
    <p className="text-xs text-muted-foreground">
      {t('buy.strategy', { type: typeLabel, name: t(`strategy.name.${choice.strategy}`) })}{' '}
      <Link href="/watchlist/strategy" className="underline">
        {t('buy.change')}
      </Link>
    </p>
  );
  if (!stats) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('buy.title')}</CardTitle>
          <CardDescription>{t('buy.notYet')}</CardDescription>
        </CardHeader>
        <CardContent>{strategyLine}</CardContent>
      </Card>
    );
  }
  const j = judge(stats, choice);
  const pct = (x: number) => `${x > 0 ? '+' : ''}${Math.round(x * 100)}%`;
  // Which items a group study used: the item's line only, or all of them (S9).
  const group = (study: { line?: string | null } | null | undefined) =>
    study?.line
      ? t('buy.group.line', { line: lineLabel(study.line, t) })
      : stats.line
        ? t('buy.group.all')
        : '';
  const reasons: React.ReactNode[] = [];
  if (stats.fair !== null) {
    reasons.push(
      t.rich('buy.reason.fair', {
        amount: money(stats.fair),
        count: stats.sales30,
        n: (c) => <span className="amount tabular-nums">{c}</span>,
      }),
    );
  }
  if (stats.cheaperThan180 !== null) {
    reasons.push(t('buy.reason.position', { pct: Math.round(stats.cheaperThan180 * 100) }));
  }
  const trends = [
    ['2', stats.trend14],
    ['4', stats.trend28],
    ['12', stats.trend84],
  ].filter((x): x is [string, number] => x[1] !== null);
  if (trends.length) {
    reasons.push(
      t('buy.reason.trend', {
        list: trends
          .map(([w, v]) => t('buy.reason.weeks', { weeks: w, pct: pct(v) }))
          .join(t('buy.reason.sep')),
      }),
    );
  }
  if (stats.market) {
    reasons.push(
      t('buy.reason.market', {
        items: stats.market.items,
        group: group(stats.market),
        pct: pct(stats.market.change84),
      }),
    );
  }
  if (stats.ask !== null && stats.fair) {
    reasons.push(
      t.rich('buy.reason.ask', {
        amount: money(stats.ask),
        pct: pct(stats.ask / stats.fair - 1),
        n: (c) => <span className="amount tabular-nums">{c}</span>,
      }),
    );
  }
  if (stats.ageDays !== null && stats.ageDays <= 365) {
    reasons.push(
      stats.pattern
        ? t('buy.reason.pattern', {
            items: stats.pattern.items,
            group: group(stats.pattern),
            pct: pct(stats.pattern.change),
            days: stats.ageDays,
          })
        : stats.releaseFrom === 'first_sale'
          ? t('buy.reason.noRelease')
          : t('buy.reason.noPattern'),
    );
  }

  const basis = j.zone.basis
    ? t(`buy.basis.${j.zone.basis}`, {
        pct: choice.margin ?? 10,
        usual: stats.usual180 !== null ? money(stats.usual180) : '-',
      })
    : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {t('buy.title')}
          <span className={cn('rounded px-2 py-0.5 text-sm font-medium', VERDICT_STYLE[j.verdict])}>
            {t(`buy.verdict.${verdictKey(j)}`)}
          </span>
          {condition && (
            <span className="font-mono text-xs font-normal text-muted-foreground">{condition}</span>
          )}
        </CardTitle>
        {j.zone.top !== null && (
          <CardDescription>
            {t.rich('buy.zone', {
              amount: money(j.zone.top),
              n: (c) => (
                <span className="amount font-medium text-foreground tabular-nums">{c}</span>
              ),
            })}
            {basis && ` (${basis})`}
            {j.zone.pattern && stats.pattern && (
              <> {t('buy.loweredByPattern', { pct: pct(stats.pattern.change) })}</>
            )}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {j.falling && (
          <p className="text-amber-700 dark:text-amber-300">
            {t(choice.strategy === 'dip' ? 'buy.fallingDip' : 'buy.falling', {
              pct: pct(stats.trend14 ?? 0),
            })}
          </p>
        )}
        {j.marketFalling && stats.market && (
          <p className="text-amber-700 dark:text-amber-300">
            {t(choice.strategy === 'dip' ? 'buy.marketFallingDip' : 'buy.marketFalling', {
              items: stats.market.items,
              group: group(stats.market),
              pct: pct(stats.market.change84),
            })}
          </p>
        )}
        {j.newRelease && stats.ageDays !== null && (
          <p className="text-amber-700 dark:text-amber-300">
            {choice.strategy === 'dip'
              ? t('buy.newReleaseDip', { days: stats.ageDays, wait: j.waitDays })
              : stats.lowAge
                ? t('buy.newRelease', {
                    days: stats.ageDays,
                    items: stats.lowAge.items,
                    group: group(stats.lowAge),
                    wait: j.waitDays,
                  })
                : t('buy.newReleaseDefault', { days: stats.ageDays, wait: j.waitDays })}
          </p>
        )}
        {j.askInZone && (
          <p className="font-medium text-emerald-700 dark:text-emerald-400">{t('buy.askInZone')}</p>
        )}
        {j.limited.length > 0 && (
          <p className="text-amber-700 dark:text-amber-300">
            {t('buy.limited', {
              reasons: j.limited.map((r) => t(`buy.limitedWhy.${r}`)).join(', '),
            })}
          </p>
        )}
        <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
          {reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
        {strategyLine}
        <p className="text-xs text-muted-foreground">{t('strategy.notAdvice')}</p>
      </CardContent>
    </Card>
  );
}
