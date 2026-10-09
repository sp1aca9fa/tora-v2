import type { CatalogSetEntry } from '@tora/core';
import { sql } from 'drizzle-orm';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Db } from './client';
import { findRepoRoot } from './env';
import { tcgSets } from './schema';

export const CATALOG_DATA_DIR = join(findRepoRoot(), 'packages', 'catalog', 'data');

export async function loadCatalogFiles(dir = CATALOG_DATA_DIR): Promise<CatalogSetEntry[]> {
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  const all: CatalogSetEntry[] = [];
  for (const f of files)
    all.push(...(JSON.parse(await readFile(join(dir, f), 'utf8')) as CatalogSetEntry[]));
  return all;
}

/** Inserts or updates sets by (source, source_key). Never deletes (products may reference them). */
export async function syncCatalog(db: Db, entries: CatalogSetEntry[]): Promise<number> {
  const CHUNK = 200;
  for (let i = 0; i < entries.length; i += CHUNK) {
    await db
      .insert(tcgSets)
      .values(entries.slice(i, i + CHUNK))
      .onConflictDoUpdate({
        target: [tcgSets.source, tcgSets.sourceKey],
        set: {
          franchise: sql`excluded.franchise`,
          region: sql`excluded.region`,
          code: sql`excluded.code`,
          name: sql`excluded.name`,
          nameAlias: sql`excluded.name_alias`,
          setType: sql`excluded.set_type`,
          releaseDate: sql`excluded.release_date`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }
  return entries.length;
}
