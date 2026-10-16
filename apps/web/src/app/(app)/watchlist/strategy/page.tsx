import { localDate, productClass, strategyOf, suggestedStrategy } from '@tora/core';
import { heldItemTypes, listWatches, sampleSeries, strategySamples } from '@tora/db';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { authed } from '@/lib/auth/guard';
import { type StrategyTypeView, StrategyPicker } from './strategy-picker';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('strategy'))('title') };
}

/**
 * Choosing a buy strategy (requirements S9 part 4): per item type the person watches or owns,
 * each strategy tried on a fixed sample of that type, then "Use this".
 */
export default async function StrategyPage() {
  const { db, user } = await authed();
  const [t, watches, owned, samples] = await Promise.all([
    getTranslations(),
    listWatches(db, user.id),
    heldItemTypes(db, user.id),
    strategySamples(db),
  ]);
  // The person's own types first; with none yet, every type that has an example.
  const mine = [...new Set([...watches.map((w) => productClass(w.product)), ...owned])];
  const types = mine.length ? mine : Object.keys(samples);
  const asOf = localDate();
  const views: StrategyTypeView[] = await Promise.all(
    types.map(async (type) => {
      const sample = samples[type];
      const loaded = sample ? await sampleSeries(db, sample) : null;
      return {
        type,
        label: t.has(`sourceRoles.class.${type}`) ? t(`sourceRoles.class.${type}`) : type,
        suggested: suggestedStrategy(type),
        current: strategyOf(user.preferences, type),
        chosen: !!user.preferences?.buyStrategy?.byType[type],
        sample:
          loaded && loaded.series.length
            ? {
                name: loaded.product.name,
                productId: loaded.product.id,
                condition: sample!.bucket,
                series: loaded.series,
              }
            : null,
      };
    }),
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="space-y-1">
        <p className="text-sm text-muted-foreground">
          <Link href="/watchlist" className="hover:underline">
            {t('nav.watchlist')}
          </Link>
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">{t('strategy.title')}</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">{t('strategy.intro')}</p>
      </header>
      <StrategyPicker types={views} asOf={asOf} />
    </div>
  );
}
