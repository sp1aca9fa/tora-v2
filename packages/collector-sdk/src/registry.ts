import { findRepoRoot } from '@tora/db/env';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Collector, CollectorModule } from './types';

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
  missing: string[];
}

export async function loadCollectors(root: string = findRepoRoot()): Promise<LoadedCollectors> {
  const collectors: Collector[] = [];
  const missing: string[] = [];
  for (const pkg of COLLECTOR_PACKAGES) {
    const entry = join(root, pkg.dir, 'src', 'index.ts');
    if (!existsSync(entry)) {
      missing.push(pkg.dir);
      continue;
    }
    const mod = (await import(pathToFileURL(entry).href)) as CollectorModule;
    collectors.push(...mod.collectors);
  }
  return { collectors, missing };
}
