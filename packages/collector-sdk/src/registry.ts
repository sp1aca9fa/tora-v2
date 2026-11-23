import {
  CATEGORY_URL_SLOT,
  type ReprintHint,
  type SignalRule,
  type SourceInfo,
  isBuiltInSignal,
} from '@tora/core';
import {
  type ConsoleInput,
  type Db,
  saveConsolePlugins,
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
  SalesRechecker,
  SetCardSource,
  StoreDirectory,
  RankingSource,
  SetCatalog,
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
  catalogs: SetCatalog[];
  signals: SignalRule[];
  reprintHints: ReprintHint[];
  recheckers: SalesRechecker[];
  consoles: ConsoleInput[];
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
  const catalogs: SetCatalog[] = [];
  const signals: SignalRule[] = [];
  const reprintHints: ReprintHint[] = [];
  const recheckers: SalesRechecker[] = [];
  const consoles: ConsoleInput[] = [];
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
    catalogs.push(...(mod.catalogs ?? []));
    signals.push(...(mod.signals ?? []).filter((r) => !isBuiltInSignal(r.key)));
    reprintHints.push(...(mod.reprintHints ?? []));
    recheckers.push(...(mod.recheckers ?? []));
    consoles.push(...(mod.consoles ?? []));
  }
  return {
    collectors,
    importers,
    rates,
    sources,
    setCards,
    pullRates,
    stores,
    rankings,
    catalogs,
    signals,
    reprintHints,
    recheckers,
    consoles,
    missing,
  };
}

/**
 * The search address per source for a category id, as a template with `CATEGORY_URL_SLOT` where the
 * id goes (the app fills it in; a plug-in's function cannot be saved). A source whose address does
 * not carry the id is left out.
 */
export function categoryUrls(collectors: readonly Collector[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of collectors) {
    if (!c.defaultQuery || !c.categoryUrl) continue;
    try {
      const url = c.categoryUrl(CATEGORY_URL_SLOT);
      if (url?.startsWith('https://') && url.includes(CATEGORY_URL_SLOT)) out[c.source] = url;
    } catch {
      // A plug-in that fails here gets no link.
    }
  }
  return out;
}

/**
 * Loads the collector packages and saves their source and rate descriptions, suggested pull rates,
 * suggested consoles and store lists for the app (every command
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
  // Suggested consoles (saved as suggestions: an admin adds them) and the marketplaces with a search
  // plug-in, which can have a software category per console (S36 Terms "Console table").
  await saveConsolePlugins(db, {
    suggested: loaded.consoles,
    searchSources: loaded.collectors.filter((c) => c.defaultQuery).map((c) => c.source),
    categoryUrls: categoryUrls(loaded.collectors),
  });
  for (const directory of loaded.stores) {
    await saveStores(
      db,
      directory.key,
      (await directory.stores()).map((s) => ({ language: directory.language ?? null, ...s })),
    );
    await saveGlossary(db, directory.key, directory.glossary ?? []);
  }
  return loaded;
}
