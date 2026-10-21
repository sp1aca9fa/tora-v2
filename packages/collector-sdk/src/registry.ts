import type { SourceInfo } from '@tora/core';
import {
  type Db,
  saveGlossary,
  saveRateSources,
  saveSourceInfos,
  saveRankingSources,
  saveStores,
  saveSuggestedRates,
} from '@tora/db';
import { findRepoRoot } from '@tora/db/env';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  Collector,
  CollectorModule,
  PullRateSource,
  PurchaseImporter,
  RateSource,
  SetCardSource,
  StoreDirectory,
  RankingSource,
} from './types';

/**
 * Collector packages, loaded by path so the public repo works without the private
 * `collectors/` submodule (it is simply skipped).
 */
export const COLLECTOR_PACKAGES = [
  { dir: 'collectors-public', private: false },
  { dir: 'collectors', private: true },
] as const;

export interface LoadedCollectors {
  collectors: Collector[];
  importers: PurchaseImporter[];
  rates: RateSource[];
  sources: SourceInfo[];
  setCards: SetCardSource[];
  pullRates: PullRateSource[];
  stores: StoreDirectory[];
  rankings: RankingSource[];
  missing: string[];
}

export async function loadCollectors(root: string = findRepoRoot()): Promise<LoadedCollectors> {
  const collectors: Collector[] = [];
  const importers: PurchaseImporter[] = [];
  const rates: RateSource[] = [];
  const sources: SourceInfo[] = [];
  const setCards: SetCardSource[] = [];
  const pullRates: PullRateSource[] = [];
  const stores: StoreDirectory[] = [];
  const rankings: RankingSource[] = [];
  const missing: string[] = [];
  for (const pkg of COLLECTOR_PACKAGES) {
    const entry = join(root, pkg.dir, 'src', 'index.ts');
    if (!existsSync(entry)) {
      missing.push(pkg.dir);
      continue;
    }
    const mod = (await import(pathToFileURL(entry).href)) as CollectorModule;
    collectors.push(...mod.collectors);
    importers.push(...(mod.importers ?? []));
    rates.push(...(mod.rates ?? []));
    sources.push(...(mod.sources ?? []));
    setCards.push(...(mod.setCards ?? []));
    pullRates.push(...(mod.pullRates ?? []));
    stores.push(...(mod.stores ?? []));
    rankings.push(...(mod.rankings ?? []));
  }
  return { collectors, importers, rates, sources, setCards, pullRates, stores, rankings, missing };
}

/**
 * Loads the collector packages and saves their source and rate descriptions, suggested pull rates
 * and store lists for the app (every command
 * that runs collectors or imports starts with this).
 */
export async function loadAndRegister(db: Db, root?: string): Promise<LoadedCollectors> {
  const loaded = await loadCollectors(root);
  await saveSourceInfos(db, loaded.sources);
  await saveRateSources(
    db,
    loaded.rates.map(({ key, label, currencies }) => ({ key, label, currencies })),
  );
  await saveSuggestedRates(db, (await Promise.all(loaded.pullRates.map((p) => p.rates()))).flat());
  await saveRankingSources(
    db,
    loaded.rankings.map(({ key, label, source }) => ({ key, label, source })),
  );
  for (const directory of loaded.stores) {
    await saveStores(db, directory.key, await directory.stores());
    await saveGlossary(db, directory.key, directory.glossary ?? []);
  }
  return loaded;
}
