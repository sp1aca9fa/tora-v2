import type { CatalogSetEntry } from '@tora/core';
import { count, eq, sql } from 'drizzle-orm';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Db } from './client';
import { findRepoRoot } from './env';
import { products, tcgSets } from './schema';

export const CATALOG_DATA_DIR = join(findRepoRoot(), 'packages', 'catalog', 'data');

export async function loadCatalogFiles(dir = CATALOG_DATA_DIR): Promise<CatalogSetEntry[]> {
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  const all: CatalogSetEntry[] = [];
  for (const f of files)
    all.push(...(JSON.parse(await readFile(join(dir, f), 'utf8')) as CatalogSetEntry[]));
  return all;
}

export interface SyncResult {
  upserted: number;
  removed: number;
  remapped: number;
  kept: number;
}

/**
 * Inserts or updates sets by (source, source_key), then cleans up sets that are no longer in the
 * catalog files (e.g. after switching sources): unused ones are deleted; ones that products use are
 * re-pointed to the matching new set (same franchise + release date + name or code) and deleted,
 * or kept when no match exists.
 */
export async function syncCatalog(db: Db, entries: CatalogSetEntry[]): Promise<SyncResult> {
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

  const wanted = new Set(entries.map((e) => `${e.source}\u0000${e.sourceKey}`));
  const all = await db.select().from(tcgSets);
  const current = all.filter((s) => wanted.has(`${s.source}\u0000${s.sourceKey}`));
  const stale = all.filter((s) => !wanted.has(`${s.source}\u0000${s.sourceKey}`));
  const result: SyncResult = { upserted: entries.length, removed: 0, remapped: 0, kept: 0 };

  for (const old of stale) {
    const [used] = await db.select({ n: count() }).from(products).where(eq(products.setId, old.id));
    if ((used?.n ?? 0) > 0) {
      const match = current.find(
        (s) =>
          s.franchise === old.franchise &&
          s.releaseDate === old.releaseDate &&
          (s.name === old.name ||
            (s.code && old.code && s.code.toUpperCase() === old.code.toUpperCase())),
      );
      if (!match) {
        result.kept++;
        continue;
      }
      await db
        .update(products)
        .set({ setId: match.id, setName: match.name, setCode: match.code })
        .where(eq(products.setId, old.id));
      result.remapped++;
    }
    await db.delete(tcgSets).where(eq(tcgSets.id, old.id));
    result.removed++;
  }
  return result;
}
