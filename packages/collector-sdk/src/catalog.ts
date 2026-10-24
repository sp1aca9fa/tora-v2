import { catalogInUse, resolveTaxonomy } from '@tora/core';
import {
  type Db,
  type SyncResult,
  loadSourceRegistry,
  readSetting,
  saveSetting,
  syncCatalog,
} from '@tora/db';
import { createHash } from 'node:crypto';
import type { SetCatalog } from './types';

/**
 * Loads the plug-ins' set lists into the database (S10): only the sets the admin's categories use
 * (`catalogInUse`), and only when they changed since the last load (`force`: always). Sets no
 * longer listed go unless items use them. Null when nothing was loaded; never empties the table
 * because the plug-ins gave nothing (a missing file).
 */
export async function syncCatalogs(
  db: Db,
  catalogs: SetCatalog[],
  options: { force?: boolean } = {},
): Promise<(SyncResult & { sets: number }) | null> {
  const all = (await Promise.all(catalogs.map((c) => c.sets()))).flat();
  if (all.length === 0) return null;
  const taxonomy = (await loadSourceRegistry(db)).taxonomy ?? resolveTaxonomy(null);
  const sets = catalogInUse(taxonomy, all);
  const hash = createHash('sha256').update(JSON.stringify(sets)).digest('hex').slice(0, 16);
  if (!options.force && (await readSetting<string>(db, 'catalogHash')) === hash) return null;
  const result = await syncCatalog(db, sets);
  await saveSetting(db, 'catalogHash', hash);
  return { ...result, sets: sets.length };
}
