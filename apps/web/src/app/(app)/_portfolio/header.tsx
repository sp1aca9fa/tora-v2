import { type ActionItem, actionTotal, type portfolioValuation } from '@tora/db';
import { ChevronRight, Plus } from 'lucide-react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { AmountsToggle } from '@/components/amounts-toggle';
import { LEVEL_STYLE } from '@/components/notice-level';
import { Button } from '@/components/ui/button';
import { cn, formatJpy } from '@/lib/utils';

type Totals = Awaited<ReturnType<typeof portfolioValuation>>['totals'];

/** "▲ +¥1,200" / "▼ ¥300" */
export const signedJpy = (n: number) => `${n > 0 ? '▲ +' : n < 0 ? '▼ ' : ''}${formatJpy(n)}`;

/**
 * The top of both Portfolio tabs (requirements S8): the totals, the Actions line, and the
 * Summary / Items tabs.
 */
export async function PortfolioHeader({
  totals,
  actions,
  tab,
}: {
  totals: Totals;
  actions: ActionItem[];
  tab: 'summary' | 'items';
}) {
  const t = await getTranslations();
  const pl = totals.unrealizedJpy;
  const waiting = actionTotal(actions);
  const tile = 'rounded-xl border bg-card px-4 py-3';
  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t('portfolio.title')}</h1>
          <AmountsToggle />
        </div>
        <Button asChild size="sm" className="hidden md:inline-flex">
          <Link href="/add">
            <Plus /> {t('nav.add')}
          </Link>
        </Button>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className={tile}>
          <p className="text-xs text-muted-foreground">{t('portfolio.marketValue')}</p>
          <p className="text-xl font-semibold tabular-nums">{formatJpy(totals.valueJpy)}</p>
          <p className="text-xs text-muted-foreground">
            {t('portfolio.valuedOf', { valued: totals.valued, total: totals.total })}
          </p>
        </div>
        <div className={tile}>
          <p className="text-xs text-muted-foreground">{t('portfolio.unrealized')}</p>
          <p className="text-xl font-semibold tabular-nums">{signedJpy(pl)}</p>
          <p className="amount text-xs text-muted-foreground">
            {totals.valuedCostJpy > 0
              ? t('portfolio.vsCost', {
                  pct: Math.round((pl / totals.valuedCostJpy) * 1000) / 10,
                  cost: formatJpy(totals.valuedCostJpy),
                })
              : '-'}
          </p>
        </div>
        <div className={cn(tile, 'col-span-2 sm:col-span-1')}>
          <p className="text-xs text-muted-foreground">{t('portfolio.spent')}</p>
          <p className="text-xl font-semibold tabular-nums">{formatJpy(totals.spentJpy)}</p>
          <p className="text-xs text-muted-foreground">
            {t('portfolio.itemsValue', { units: totals.units, lots: totals.lots })}
          </p>
          {totals.openedCostJpy > 0 && (
            <p className="amount text-xs text-muted-foreground">
              {t('portfolio.inclOpened', { amount: formatJpy(totals.openedCostJpy) })}
            </p>
          )}
        </div>
      </section>

      {waiting > 0 && (
        <Link
          href="/actions"
          className={cn(
            'flex items-center justify-between rounded-xl border px-4 py-3 text-sm',
            LEVEL_STYLE[actions[0]!.level].banner,
          )}
        >
          <span>{t('actions.banner', { count: waiting })}</span>
          <ChevronRight className="size-4" />
        </Link>
      )}

      <nav className="flex gap-1 border-b" aria-label={t('portfolio.title')}>
        {(['summary', 'items'] as const).map((key) => (
          <Link
            key={key}
            href={key === 'summary' ? '/' : '/items'}
            aria-current={tab === key ? 'page' : undefined}
            className={cn(
              '-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors',
              tab === key
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t(`portfolio.tab.${key}`)}
          </Link>
        ))}
      </nav>
    </div>
  );
}
