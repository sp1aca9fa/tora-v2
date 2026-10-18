import {
  type Judgement,
  NEW_RELEASE_DAYS,
  RULE_TEST_MIN_SIGNALS,
  type RuleTestResult,
  type SignalStats,
  type StrategyChoice,
  judge,
} from '@tora/core';
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

/** Which items a group study used: the item's line only, or all of them (S9). */
function groupLabel(
  stats: SignalStats,
  t: Awaited<ReturnType<typeof getTranslations>>,
): (study: { line?: string | null } | null | undefined) => string {
  return (study) =>
    study?.line
      ? t('buy.group.line', { line: lineLabel(study.line, t) })
      : stats.line
        ? t('buy.group.all')
        : '';
}

const pct = (x: number) => `${x > 0 ? '+' : ''}${Math.round(x * 100)}%`;

/**
 * Buy timing's verdict (S9 part 4, S22): the person's strategy on today's numbers, the buy zone,
 * and what makes it wait. Never a sure thing.
 */
export async function BuyVerdict({
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
  const group = groupLabel(stats, t);
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
          <span
            className={cn('rounded px-2.5 py-1 text-base font-semibold', VERDICT_STYLE[j.verdict])}
          >
            {t(`buy.verdict.${verdictKey(j)}`)}
          </span>
          {condition && (
            <span className="font-mono text-xs font-normal text-muted-foreground">{condition}</span>
          )}
        </CardTitle>
        {j.zone.top !== null && (
          <CardDescription className="text-base">
            {t.rich('buy.zone', {
              amount: money(j.zone.top),
              n: (c) => (
                <span className="amount font-semibold text-foreground tabular-nums">{c}</span>
              ),
            })}
            {basis && <span className="text-sm"> ({basis})</span>}
            {j.zone.pattern && stats.pattern && (
              <span className="text-sm">
                {' '}
                {t('buy.loweredByPattern', { pct: pct(stats.pattern.change) })}
              </span>
            )}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
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
        {strategyLine}
      </CardContent>
    </Card>
  );
}

/**
 * The numbers behind the verdict in three groups (S22): where today's price sits, the trend and
 * the market, the new release and the new-set pattern. Group studies say which items they used.
 */
export async function BuyReasons({ stats }: { stats: SignalStats }) {
  const [t, money] = await Promise.all([getTranslations(), getMoney()]);
  const group = groupLabel(stats, t);
  const amount = (c: React.ReactNode) => <span className="amount tabular-nums">{c}</span>;

  const where: React.ReactNode[] = [];
  if (stats.fair !== null) {
    where.push(
      t.rich('buy.reason.fair', { amount: money(stats.fair), count: stats.sales30, n: amount }),
    );
  }
  if (stats.cheaperThan180 !== null) {
    where.push(t('buy.reason.position', { pct: Math.round(stats.cheaperThan180 * 100) }));
  }
  if (stats.ask !== null && stats.fair) {
    where.push(
      t.rich('buy.reason.ask', {
        amount: money(stats.ask),
        pct: pct(stats.ask / stats.fair - 1),
        n: amount,
      }),
    );
  }

  const trend: React.ReactNode[] = [];
  const trends = [
    ['2', stats.trend14],
    ['4', stats.trend28],
    ['12', stats.trend84],
  ].filter((x): x is [string, number] => x[1] !== null);
  if (trends.length) {
    trend.push(
      t('buy.reason.trend', {
        list: trends
          .map(([w, v]) => t('buy.reason.weeks', { weeks: w, pct: pct(v) }))
          .join(t('buy.reason.sep')),
      }),
    );
  }
  trend.push(
    stats.market
      ? t('buy.reason.market', {
          items: stats.market.items,
          group: group(stats.market),
          pct: pct(stats.market.change84),
        })
      : t('buy.reason.noMarket'),
  );

  const release: React.ReactNode[] = [];
  if (stats.ageDays === null) {
    release.push(t('buy.reason.noAge'));
  } else if (stats.releaseFrom === 'first_sale') {
    release.push(t('buy.reason.ageFirstSale', { days: stats.ageDays }));
  } else {
    release.push(t('buy.reason.age', { days: stats.ageDays }));
  }
  if (stats.ageDays !== null && stats.ageDays > 365) {
    release.push(t('buy.reason.pastFirstYear'));
  } else if (stats.ageDays !== null) {
    if (stats.releaseFrom !== 'first_sale') {
      release.push(
        stats.lowAge
          ? t('buy.reason.lowAge', {
              items: stats.lowAge.items,
              group: group(stats.lowAge),
              age: stats.lowAge.age,
            })
          : t('buy.reason.noLowAge', { wait: NEW_RELEASE_DAYS }),
      );
    }
    release.push(
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

  const groups: [string, React.ReactNode[]][] = [
    ['where', where],
    ['trend', trend],
    ['release', release],
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('buy.reasonsTitle')}</CardTitle>
      </CardHeader>
      {/* Three groups side by side once the card is wide enough, whatever the screen. */}
      <CardContent className="@container">
        <div className="grid gap-4 text-sm @2xl:grid-cols-3">
          {groups.map(([key, items]) => (
            <section key={key} className="space-y-1.5">
              <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {t(`buy.groups.${key}`)}
              </h3>
              {items.length ? (
                <ul className="space-y-1">
                  {items.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">-</p>
              )}
            </section>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/** How far a strategy's share must be from any day's to be called better or worse. */
const RULE_TEST_MARGIN = 0.05;

/**
 * The rule test (S9 part 5): the person's strategy on the whole price history of similar items,
 * each past signal checked 90 days later, always next to buying on any day. Never a sure thing.
 */
export async function RuleTestCard({
  test,
  strategyName,
}: {
  test: { result: RuleTestResult; line: string | null; day: string } | null;
  strategyName: string;
}) {
  const t = await getTranslations();
  const r = test?.result;
  const share = (h: number, n: number) => (n ? h / n : 0);
  const mine = r ? share(r.higher, r.checked) : 0;
  const any = r ? share(r.anyHigher, r.anyChecked) : 0;
  const compare =
    mine >= any + RULE_TEST_MARGIN ? 'better' : mine <= any - RULE_TEST_MARGIN ? 'worse' : 'same';
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('buy.ruleTest.title')}</CardTitle>
        {r && (
          <CardDescription>
            {t('buy.ruleTest.about', {
              name: strategyName,
              items: r.items,
              group: test.line ? t('buy.group.line', { line: lineLabel(test.line, t) }) : '',
            })}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {!r ? (
          <p className="text-muted-foreground">{t('buy.ruleTest.notYet')}</p>
        ) : r.checked < RULE_TEST_MIN_SIGNALS ? (
          <p className="text-muted-foreground">
            {t('buy.ruleTest.few', { count: r.checked, min: RULE_TEST_MIN_SIGNALS })}
          </p>
        ) : (
          <>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
              <dt className="text-muted-foreground">
                {t('buy.ruleTest.signals', { count: r.checked })}
              </dt>
              <dd className="tabular-nums">
                {t('buy.ruleTest.result', {
                  higher: r.higher,
                  checked: r.checked,
                  pct: Math.round(mine * 100),
                  change: pct(r.change ?? 0),
                })}
              </dd>
              <dt className="text-muted-foreground">{t('buy.ruleTest.anyDay')}</dt>
              <dd className="tabular-nums">
                {t('buy.ruleTest.anyResult', {
                  pct: Math.round(any * 100),
                  change: pct(r.anyChange ?? 0),
                })}
              </dd>
            </dl>
            <p
              className={cn(
                compare === 'better' && 'text-emerald-700 dark:text-emerald-400',
                compare === 'worse' && 'text-amber-700 dark:text-amber-300',
              )}
            >
              {t(`buy.ruleTest.${compare}`)}
            </p>
          </>
        )}
        {test && (
          <p className="text-xs text-muted-foreground">
            {t('buy.ruleTest.how', { date: test.day })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
