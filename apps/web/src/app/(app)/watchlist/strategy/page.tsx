import { STRATEGIES, judge, productClass, strategyOf, suggestedStrategy } from '@tora/core';
import { heldItemTypes, latestSignals, listWatches, loadOpportunities } from '@tora/db';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { authed } from '@/lib/auth/guard';
import { bucketLabel } from '@/lib/product-display';
import { type ConditionTypeView, ConditionPicker } from './condition-picker';
import { type StrategyTypeView, StrategyPicker } from './strategy-picker';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('strategy'))('title') };
}

/**
 * Choosing a buy strategy (requirements S9 part 4): per item type the person watches or owns,
 * each strategy tried on the three fixed examples (the same for everyone), then "Use this".
 */
export default async function StrategyPage() {
  const { db, user } = await authed();
  const [t, watches, owned, saved] = await Promise.all([
    getTranslations(),
    listWatches(db, user.id),
    heldItemTypes(db, user.id),
    loadOpportunities(db),
  ]);
  const types = [...new Set([...watches.map((w) => productClass(w.product)), ...owned])];
  // Each strategy on the person's own watches today (S27): how many it calls a good price.
  const stats = await latestSignals(
    db,
    watches.map((w) => ({ productId: w.product.id, bucket: w.watch.bucket })),
  );
  const today = (type: string) => {
    const priced = watches.flatMap((w) => {
      const s = stats.get(`${w.product.id}|${w.watch.bucket ?? ''}`)?.stats;
      return productClass(w.product) === type && s?.fair ? [s] : [];
    });
    return {
      watches: priced.length,
      good: Object.fromEntries(
        STRATEGIES.map((s) => [
          s,
          priced.filter(
            (x) =>
              judge(x, { ...strategyOf(user.preferences, type), strategy: s }).verdict === 'good',
          ).length,
        ]),
      ) as Record<(typeof STRATEGIES)[number], number>,
    };
  };
  const views: StrategyTypeView[] = types.map((type) => ({
    type,
    label: t.has(`sourceRoles.class.${type}`) ? t(`sourceRoles.class.${type}`) : type,
    suggested: suggestedStrategy(type),
    current: strategyOf(user.preferences, type),
    chosen: !!user.preferences?.buyStrategy?.byType[type],
    today: today(type),
  }));

  // The conditions Opportunities has items in, per type, by name (S27).
  const counts = new Map<string, Map<string, number>>();
  for (const o of saved?.items ?? []) {
    const of = counts.get(o.itemType) ?? new Map<string, number>();
    of.set(o.bucket, (of.get(o.bucket) ?? 0) + 1);
    counts.set(o.itemType, of);
  }
  const conditions: ConditionTypeView[] = [...counts]
    .filter(([, of]) => of.size > 1)
    .map(([type, of]) => ({
      type,
      label: t.has(`sourceRoles.class.${type}`) ? t(`sourceRoles.class.${type}`) : type,
      buckets: [...of]
        .map(([bucket, items]) => ({
          bucket,
          label: bucket ? bucketLabel(bucket, t) : t('strategy.anyCondition'),
          items,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      chosen: user.preferences?.suggestConditions?.[type] ?? null,
    }));

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <p className="text-sm text-muted-foreground">
          <Link href="/watchlist" className="hover:underline">
            {t('nav.watchlist')}
          </Link>
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">{t('strategy.title')}</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">{t('strategy.intro')}</p>
      </header>
      <StrategyPicker types={views} />
      {conditions.length > 0 && <ConditionPicker types={conditions} />}
    </div>
  );
}
