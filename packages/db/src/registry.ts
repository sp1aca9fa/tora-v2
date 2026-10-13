// The source registry (requirements S8, sources with roles): what the plug-ins describe, saved
// by the collectors, read by the app.
import {
  type ProductClass,
  type SourceInfo,
  type SourceRegistry,
  type SourceRole,
  toTokyoIso,
} from '@tora/core';
import { eq, sql } from 'drizzle-orm';
import type { Db } from './client';
import { sources } from './schema';

/** Saves the plug-ins' descriptions (collectors, at the start of a run); roles chosen stay. */
export async function saveSourceInfos(db: Db, infos: SourceInfo[]): Promise<void> {
  const at = toTokyoIso();
  for (const info of infos) {
    await db
      .insert(sources)
      .values({ key: info.key, info })
      .onConflictDoUpdate({
        target: sources.key,
        set: { info: sql`excluded.info`, updatedAt: at },
      });
  }
  cache = new WeakMap();
}

// Read on most pages and every valuation: kept for a minute per connection.
let cache = new WeakMap<object, { at: number; registry: SourceRegistry }>();
const TTL_MS = 60_000;

/** The registry: every described source with its role per class (chosen, else suggested). */
export async function loadSourceRegistry(db: Pick<Db, 'select'>): Promise<SourceRegistry> {
  const hit = cache.get(db);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.registry;
  const rows = await db.select().from(sources);
  const registry: SourceRegistry = {
    sources: rows
      .map((r) => r.info)
      .toSorted((a, b) => (a.priority ?? 100) - (b.priority ?? 100) || a.key.localeCompare(b.key)),
    roles: Object.fromEntries(rows.map((r) => [r.key, r.roles ?? r.info.roles ?? {}])),
  };
  cache.set(db, { at: Date.now(), registry });
  return registry;
}

/** The admin's roles for a source (null: back to the plug-in's suggestion). */
export async function setSourceRoles(
  db: Db,
  key: string,
  roles: Partial<Record<ProductClass, SourceRole>> | null,
): Promise<void> {
  await db.update(sources).set({ roles, updatedAt: toTokyoIso() }).where(eq(sources.key, key));
  cache = new WeakMap();
}
