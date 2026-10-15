import 'server-only';
import { type SourceRegistry, marketsOf, sourceName } from '@tora/core';
import { getDb, loadSourceRegistry } from '@tora/db';
import { getTranslations } from 'next-intl/server';
import { cache } from 'react';

/** The source registry (what the plug-ins describe), read once per request. */
export const getRegistry = cache((): Promise<SourceRegistry> => loadSourceRegistry(getDb()));

/** A source's name for people (its key when it is not described). */
export async function sourceLabels(): Promise<(key: string) => string> {
  const registry = await getRegistry();
  return (key: string) => sourceName(registry, key);
}

/** A market's name for people ("Japan"; its code when the app has no name for it). */
export async function marketLabels(): Promise<(market: string | null | undefined) => string> {
  const t = await getTranslations('sources.market');
  return (market) => (!market ? '-' : t.has(market) ? t(market) : market.toUpperCase());
}

/** Every market, the primary and secondary first, then the others (S16), with its place. */
export function marketsInOrder(
  registry: SourceRegistry,
): { market: string; which: 'primary' | 'secondary' | 'other' }[] {
  const { primary = null, secondary = null } = registry.markets ?? {};
  const rank = (m: string) => (m === primary ? 0 : m === secondary ? 1 : 2);
  return marketsOf(registry.sources)
    .toSorted((a, b) => rank(a) - rank(b))
    .map((market) => ({
      market,
      which: market === primary ? 'primary' : market === secondary ? 'secondary' : 'other',
    }));
}
