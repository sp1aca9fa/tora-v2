// The source registry (requirements S8, sources with roles): what the plug-ins describe, saved
// by the collectors, read by the app.
import {
  type LanguageSettings,
  type Taxonomy,
  resolveTaxonomy,
  type CurrencySettings,
  ITEM_CLASSES,
  typesOf,
  type RateSourceInfo,
  type MarketSettings,
  type ProductClass,
  QUALITY_MAX_GAP,
  QUALITY_MIN_PAIRS,
  type SourceInfo,
  type SourceQuality,
  type SourceRegistry,
  type SourceRole,
  effectiveRoles,
  type SourceOrder,
  byPriority,
  inClassOrder,
  median,
  productClass,
  resolveCurrency,
  resolveMarkets,
  appTimeZone,
  setAppTimeZone,
  toLocalIso,
} from '@tora/core';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from './client';
import { loadItemSales, unpackSales } from './item-sales';
import { appSettings, priceObservations, products, sources } from './schema';

/** Saves the plug-ins' descriptions (collectors, at the start of a run); roles chosen stay. */
export async function saveSourceInfos(db: Db, infos: SourceInfo[]): Promise<void> {
  const at = toLocalIso();
  const known = new Map(
    (await db.select({ key: sources.key, info: sources.info }).from(sources)).map((r) => [
      r.key,
      JSON.stringify(r.info),
    ]),
  );
  for (const info of infos) {
    // Unchanged descriptions are left alone: a change makes saved values stale (`changedAt`).
    if (known.get(info.key) === JSON.stringify(info)) continue;
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

// Read on most pages and every valuation: kept a few seconds per connection (other servers see
// a role change within that; values saved before the change are not used, see `changedAt`).
let cache = new WeakMap<object, { at: number; registry: SourceRegistry }>();
const TTL_MS = 5_000;

/** The registry: every described source with its role per class (chosen, else suggested). */
export async function loadSourceRegistry(db: Pick<Db, 'select'>): Promise<SourceRegistry> {
  const hit = cache.get(db);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.registry;
  const [rows, settings] = await Promise.all([
    db.select().from(sources),
    db
      .select()
      .from(appSettings)
      .where(
        inArray(appSettings.key, [
          'markets',
          'sourceOrder',
          'currency',
          'rateSources',
          'languages',
          'categories',
          'timeZone',
        ]),
      ),
  ]);
  const markets = settings.find((r) => r.key === 'markets');
  const order = settings.find((r) => r.key === 'sourceOrder');
  const setting = (key: string) => settings.find((r) => r.key === key)?.value;
  // Every time the app stores or shows follows the admin's time zone (S16 part 5).
  setAppTimeZone(setting('timeZone') as string | undefined);
  const declared = Object.fromEntries(rows.map((r) => [r.key, r.roles ?? r.info.roles ?? {}]));
  const infos = rows.map((r) => r.info);
  const quality = Object.fromEntries(
    rows.map((r) => [r.key, (r.quality ?? {}) as Partial<Record<ProductClass, SourceQuality>>]),
  );
  const registry: SourceRegistry = {
    sources: byPriority(infos),
    // One list for every class before orders were per class.
    order: Array.isArray(order?.value)
      ? Object.fromEntries(ITEM_CLASSES.map((c) => [c, order.value as string[]]))
      : ((order?.value as SourceOrder | undefined) ?? {}),
    roles: Object.fromEntries(
      rows.map((r) => [r.key, effectiveRoles(declared[r.key]!, quality[r.key])]),
    ),
    declared,
    quality,
    markets: resolveMarkets(infos, markets?.value as Partial<MarketSettings> | undefined),
    // Rates only change how prices collected next are converted: saved values stay valid.
    changedAt: [
      ...rows,
      // A kind moved to another condition list changes how its items are valued.
      ...settings.filter((r) => ['markets', 'sourceOrder', 'categories'].includes(r.key)),
    ].reduce((max, r) => (r.updatedAt > max ? r.updatedAt : max), ''),
    currency: resolveCurrency(setting('currency') as Partial<CurrencySettings> | undefined),
    rateSources: (setting('rateSources') as RateSourceInfo[] | undefined) ?? [],
    languages: (setting('languages') as Partial<LanguageSettings> | undefined) ?? null,
    taxonomy: resolveTaxonomy(setting('categories') as Partial<Taxonomy> | undefined),
    timeZone: appTimeZone(),
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
  await db.update(sources).set({ roles, updatedAt: toLocalIso() }).where(eq(sources.key, key));
  cache = new WeakMap();
}

/** The admin's markets and identity sources (requirements S11); values follow. */
export async function setMarketSettings(db: Db, value: MarketSettings): Promise<void> {
  const at = toLocalIso();
  await db
    .insert(appSettings)
    .values({ key: 'markets', value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: at } });
  cache = new WeakMap();
}

/** Saves a setting (app_settings) and clears the registry cache. */
export async function saveSetting(db: Db, key: string, value: unknown): Promise<void> {
  const at = toLocalIso();
  await db
    .insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: at } });
  cache = new WeakMap();
}

/** One app setting's value, read fresh (no cache). */
export async function readSetting<T>(db: Pick<Db, 'select'>, key: string): Promise<T | null> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key));
  return (row?.value as T | undefined) ?? null;
}

/** The nightly collect's time window in hours (S16; Settings > Collectors). */
export async function setCollectWindow(db: Db, hours: number): Promise<void> {
  await saveSetting(db, 'collectWindow', hours);
}

/** The base currency and where each currency's rate comes from (S16). */
export async function setCurrencySettings(db: Db, value: CurrencySettings): Promise<void> {
  await saveSetting(db, 'currency', value);
}

/** The admin's categories and condition lists (S16). */
export async function setTaxonomy(db: Db, value: Taxonomy): Promise<void> {
  await saveSetting(db, 'categories', {
    categories: value.categories,
    lists: value.lists.filter((l) => !l.builtIn),
  });
}

/** The app's primary and secondary language (S16, admins). */
export async function setLanguageSettings(db: Db, value: LanguageSettings): Promise<void> {
  await saveSetting(db, 'languages', value);
}

/** The app's time zone (S16 part 5); `changeTimeZone` converts the stored times first. */
export async function setTimeZoneSetting(db: Db, name: string): Promise<void> {
  await saveSetting(db, 'timeZone', name);
  setAppTimeZone(name);
}

/** The last backup the home PC made (S6), shown to admins in Settings > Collectors. */
export interface BackupRecord {
  at: string;
  file: string;
  bytes: number;
  rows: number;
}

export async function setLastBackup(db: Db, value: BackupRecord): Promise<void> {
  await saveSetting(db, 'lastBackup', value);
}

export async function lastBackup(db: Pick<Db, 'select'>): Promise<BackupRecord | null> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, 'lastBackup'));
  return (row?.value as BackupRecord | undefined) ?? null;
}

/** Loads the app's time zone (scripts and requests that read no other setting first). */
export async function loadTimeZone(db: Pick<Db, 'select'>): Promise<string> {
  return (await loadSourceRegistry(db)).timeZone ?? appTimeZone();
}

/** The rate plug-ins installed (collectors, at the start of a run). */
export async function saveRateSources(db: Db, infos: RateSourceInfo[]): Promise<void> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, 'rateSources'));
  if (JSON.stringify(row?.value) !== JSON.stringify(infos))
    await saveSetting(db, 'rateSources', infos);
}

/** The admin's order of the sources for a class (Settings > Price sources); values follow. */
export async function setSourceOrder(db: Db, cls: ProductClass, keys: string[]): Promise<void> {
  const at = toLocalIso();
  const value: SourceOrder = { ...(await loadSourceRegistry(db)).order, [cls]: keys };
  await db
    .insert(appSettings)
    .values({ key: 'sourceOrder', value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: at } });
  cache = new WeakMap();
}

/**
 * The quality gate (requirements S8): each supporting source's sales against its class's
 * reference source's in the same market, like for like (same item and condition, the last 90 days, 3+ sales each).
 * A median gap over 15% on 10+ items: it disagrees and is valued as comparison only until it
 * agrees again; fewer items: unverified (keeps its role). Run at the end of each collect.
 * Returns the sources and classes now valued differently (into or out of "disagrees").
 */
export async function checkSourceQuality(db: Db, now = new Date()): Promise<string[]> {
  const registry = await loadSourceRegistry(db);
  const rows = await db.select().from(sources);
  const declared = Object.fromEntries(rows.map((r) => [r.key, r.roles ?? r.info.roles ?? {}]));
  // The last 90 days of kept sales, from the packed item sales (one row per item).
  const since = toLocalIso(new Date(now.getTime() - 90 * 86_400_000));
  const keys = new Set(rows.map((r) => r.key));
  const packed = await loadItemSales(db);
  const items = packed.size
    ? await db
        .select({
          id: products.id,
          category: products.category,
          itemType: products.itemType,
          kind: products.kind,
        })
        .from(products)
    : [];
  // Prices per class, item + condition, source.
  const byKey = new Map<string, { cls: ProductClass; by: Map<string, number[]> }>();
  for (const item of items) {
    for (const o of unpackSales(packed.get(item.id), { since, types: ['sold'] })) {
      if (!o.bucket || !keys.has(o.source)) continue;
      const key = `${item.id}|${o.bucket}`;
      const e = byKey.get(key) ?? { cls: productClass(item), by: new Map<string, number[]>() };
      e.by.set(o.source, [...(e.by.get(o.source) ?? []), o.priceBase]);
      byKey.set(key, e);
    }
  }
  const at = toLocalIso(now);
  const changed: string[] = [];
  for (const row of rows) {
    const next: Partial<Record<ProductClass, SourceQuality>> = {};
    for (const cls of typesOf(registry)) {
      if (declared[row.key]?.[cls] !== 'supporting') continue;
      // In the class's order: with two references, the first one is compared against.
      const reference =
        inClassOrder(registry, cls, rows).find(
          (r) => declared[r.key]?.[cls] === 'reference' && r.info.market === row.info.market,
        )?.key ?? null;
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
      // A dismissed notice stays dismissed while the source keeps disagreeing.
      if (before?.status === 'disagrees' && next[cls]!.status === 'disagrees') {
        next[cls]!.dismissedAt = before.dismissedAt ?? null;
      }
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

/** An admin dismisses a source's quality notice for a class (it stays comparison only). */
export async function dismissSourceQuality(db: Db, key: string, cls: ProductClass): Promise<void> {
  const [row] = await db.select().from(sources).where(eq(sources.key, key));
  const quality = (row?.quality ?? {}) as Partial<Record<ProductClass, SourceQuality>>;
  if (!quality[cls]) return;
  quality[cls] = { ...quality[cls]!, dismissedAt: toLocalIso() };
  await db.update(sources).set({ quality }).where(eq(sources.key, key));
  cache = new WeakMap();
}

/**
 * Drops the listing details of sources that keep them only for a while (`detailsDays`): the
 * per-listing IDs and listings saved with a day's aggregate. Run at the end of each collect.
 */
export async function pruneSourceDetails(db: Db, now = new Date()): Promise<number> {
  let pruned = 0;
  for (const s of (await loadSourceRegistry(db)).sources) {
    if (!s.detailsDays) continue;
    const before = toLocalIso(new Date(now.getTime() - s.detailsDays * 86_400_000));
    const rows = await db
      .update(priceObservations)
      .set({ raw: sql`json_remove(${priceObservations.raw}, '$.ids', '$.listings')` })
      .where(
        and(
          eq(priceObservations.source, s.key),
          sql`${priceObservations.observedAt} < ${before}`,
          sql`(json_extract(${priceObservations.raw}, '$.ids') is not null or json_extract(${priceObservations.raw}, '$.listings') is not null)`,
        ),
      )
      .returning({ id: priceObservations.id });
    pruned += rows.length;
  }
  return pruned;
}
