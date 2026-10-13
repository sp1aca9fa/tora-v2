// The source registry (requirements S8, sources with roles): what the plug-ins describe, saved
// by the collectors, read by the app.
import {
  ITEM_CLASSES,
  type ProductClass,
  QUALITY_MAX_GAP,
  QUALITY_MIN_PAIRS,
  type SourceInfo,
  type SourceQuality,
  type SourceRegistry,
  type SourceRole,
  effectiveRoles,
  median,
  productClass,
  toTokyoIso,
} from '@tora/core';
import { and, eq, gte, sql } from 'drizzle-orm';
import type { Db } from './client';
import { priceObservations, products, sources } from './schema';

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
  const declared = Object.fromEntries(rows.map((r) => [r.key, r.roles ?? r.info.roles ?? {}]));
  const quality = Object.fromEntries(
    rows.map((r) => [r.key, (r.quality ?? {}) as Partial<Record<ProductClass, SourceQuality>>]),
  );
  const registry: SourceRegistry = {
    sources: rows
      .map((r) => r.info)
      .toSorted((a, b) => (a.priority ?? 100) - (b.priority ?? 100) || a.key.localeCompare(b.key)),
    roles: Object.fromEntries(
      rows.map((r) => [r.key, effectiveRoles(declared[r.key]!, quality[r.key])]),
    ),
    declared,
    quality,
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

/**
 * The quality gate (requirements S8): each supporting source's sales against its class's
 * reference source's, like for like (same item and condition, the last 90 days, 3+ sales each).
 * A median gap over 15% on 10+ items: it disagrees and is valued as comparison only until it
 * agrees again; fewer items: unverified (keeps its role). Run at the end of each collect.
 * Returns the sources and classes now valued differently (into or out of "disagrees").
 */
export async function checkSourceQuality(db: Db, now = new Date()): Promise<string[]> {
  const rows = await db.select().from(sources);
  const declared = Object.fromEntries(rows.map((r) => [r.key, r.roles ?? r.info.roles ?? {}]));
  const since = toTokyoIso(new Date(now.getTime() - 90 * 86_400_000));
  const sales = await db
    .select({
      productId: priceObservations.productId,
      category: products.category,
      kind: products.kind,
      source: priceObservations.source,
      bucket: priceObservations.bucket,
      priceJpy: priceObservations.priceJpy,
    })
    .from(priceObservations)
    .innerJoin(products, eq(products.id, priceObservations.productId))
    .where(
      and(
        eq(priceObservations.observationType, 'sold'),
        eq(priceObservations.excluded, false),
        gte(priceObservations.observedAt, since),
      ),
    );
  // Prices per class, item + condition, source.
  const byKey = new Map<string, { cls: ProductClass; by: Map<string, number[]> }>();
  for (const s of sales) {
    if (!s.bucket) continue;
    const key = `${s.productId}|${s.bucket}`;
    const e = byKey.get(key) ?? { cls: productClass(s), by: new Map<string, number[]>() };
    e.by.set(s.source, [...(e.by.get(s.source) ?? []), s.priceJpy]);
    byKey.set(key, e);
  }
  const at = toTokyoIso(now);
  const changed: string[] = [];
  for (const row of rows) {
    const next: Partial<Record<ProductClass, SourceQuality>> = {};
    for (const cls of ITEM_CLASSES) {
      if (declared[row.key]?.[cls] !== 'supporting') continue;
      const reference = rows.find((r) => declared[r.key]?.[cls] === 'reference')?.key ?? null;
      const gaps: number[] = [];
      for (const e of byKey.values()) {
        if (e.cls !== cls || !reference) continue;
        const mine = e.by.get(row.key);
        const theirs = e.by.get(reference);
        if (mine && theirs && mine.length >= 3 && theirs.length >= 3) {
          gaps.push(median(mine)! / median(theirs)! - 1);
        }
      }
      const enough = gaps.length >= QUALITY_MIN_PAIRS;
      const gap = enough ? median(gaps.map(Math.abs)) : null;
      next[cls] = {
        status: !enough ? 'unverified' : gap! <= QUALITY_MAX_GAP ? 'agrees' : 'disagrees',
        pairs: gaps.length,
        gap: gap === null ? null : Math.round(gap * 1000) / 1000,
        bias: enough ? Math.round(median(gaps)! * 1000) / 1000 : null,
        against: reference,
        checkedAt: at,
      };
      const before = (row.quality as Partial<Record<ProductClass, SourceQuality>> | null)?.[cls];
      // Only a change in or out of "disagrees" changes what values use.
      if ((before?.status === 'disagrees') !== (next[cls]!.status === 'disagrees')) {
        changed.push(`${row.key}:${cls}`);
      }
    }
    await db.update(sources).set({ quality: next }).where(eq(sources.key, row.key));
  }
  cache = new WeakMap();
  return changed;
}
