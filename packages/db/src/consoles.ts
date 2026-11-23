// The console table (requirements S36 Terms "Console table"): one row per console, edited by admins
// (the page and its actions check the role). Plug-ins may suggest rows; they are saved only when an
// admin adds them, and a row that exists is never overwritten by a suggestion.
import {
  CATEGORY_URL_SLOT,
  type ConsoleRow,
  type Names,
  consoleKey,
  consoleOf,
  toLocalIso,
} from '@tora/core';
import { and, asc, count, eq, isNotNull, or } from 'drizzle-orm';
import type { Db } from './client';
import { readSetting, saveSetting } from './registry';
import { consoles, itemRules, products } from './schema';

/** A console as the app shows and edits it. */
export interface ConsoleInput {
  key: string;
  names: Names;
  aliases: string[];
  categories: Record<string, string>;
  boxedAllowed: boolean;
  sort?: number;
}

/** A console key: letters, digits, dashes and underscores, lower case. */
const KEY = /^[a-z0-9][a-z0-9_-]{0,31}$/;
/** A site's category id: letters, digits, dashes and underscores. */
const CATEGORY = /^[A-Za-z0-9_-]{1,40}$/;
const TEXT_MAX = 80;
const ALIASES_MAX = 30;

/** Every console, in the admin's order (then by key). */
export async function listConsoles(
  db: Pick<Db, 'select'>,
): Promise<(ConsoleRow & { sort: number })[]> {
  const rows = await db.select().from(consoles).orderBy(asc(consoles.sort), asc(consoles.key));
  return rows.map((r) => ({
    key: r.key,
    names: r.names ?? {},
    aliases: r.aliases ?? [],
    categories: r.categories ?? {},
    boxedAllowed: r.boxedAllowed,
    sort: r.sort,
  }));
}

/** A console's input cleaned up, or null when it is not valid (empty key, bad category id...). */
export function cleanConsole(input: ConsoleInput): ConsoleInput | null {
  if (!input || typeof input.key !== 'string') return null;
  const key = consoleKey(input.key);
  if (!KEY.test(key)) return null;
  const names: Names = {};
  for (const [lang, name] of Object.entries(input.names ?? {})) {
    const v = typeof name === 'string' ? name.trim() : '';
    if (!/^[a-z]{2}(-[A-Za-z]{2})?$/.test(lang) || v.length > TEXT_MAX) return null;
    if (v) names[lang] = v;
  }
  const aliases = [
    ...new Set(
      (Array.isArray(input.aliases) ? input.aliases : [])
        .map((a) => (typeof a === 'string' ? a.trim() : ''))
        .filter(Boolean),
    ),
  ];
  if (aliases.length > ALIASES_MAX || aliases.some((a) => a.length > TEXT_MAX)) return null;
  const categories: Record<string, string> = {};
  for (const [source, id] of Object.entries(input.categories ?? {})) {
    const v = typeof id === 'string' ? id.trim() : '';
    if (!v) continue;
    if (!/^[\w-]{1,40}$/.test(source) || !CATEGORY.test(v)) return null;
    categories[source] = v;
  }
  const sort = Number.isInteger(input.sort) ? input.sort! : 0;
  return { key, names, aliases, categories, boxedAllowed: input.boxedAllowed === true, sort };
}

/**
 * Saves a console (admins), adding it or replacing the row with that key. Returns false, saving
 * nothing, when the input is not valid.
 */
export async function saveConsole(db: Db, input: ConsoleInput): Promise<boolean> {
  const row = cleanConsole(input);
  if (!row) return false;
  const at = toLocalIso();
  const values = {
    names: row.names,
    aliases: row.aliases,
    categories: row.categories,
    boxedAllowed: row.boxedAllowed,
    sort: row.sort ?? 0,
  };
  await db
    .insert(consoles)
    .values({ key: row.key, ...values, createdAt: at, updatedAt: at })
    .onConflictDoUpdate({ target: consoles.key, set: { ...values, updatedAt: at } });
  return true;
}

/** What uses a console: items whose own rules name it, and items whose platform names it. */
export interface ConsoleUse {
  rules: number;
  products: number;
}

/** What uses the console `key` (read when an admin deletes one). */
export async function consoleUse(db: Pick<Db, 'select'>, key: string): Promise<ConsoleUse> {
  const k = consoleKey(key);
  // Counted as `consoleUseCounts` counts (games only), so the page and a refused delete agree.
  const [rules] = await db
    .select({ n: count() })
    .from(itemRules)
    .innerJoin(products, eq(products.id, itemRules.productId))
    .where(and(eq(itemRules.console, k), eq(products.category, 'game')));
  // Platforms are free text: each distinct one is matched as the rules match it.
  const all = await listConsoles(db);
  let used = 0;
  for (const p of await db
    .select({ platform: products.platform, n: count() })
    .from(products)
    // Only a game can have a console that matters (`isGameItem`); cards and sealed are not read.
    .where(and(eq(products.category, 'game'), isNotNull(products.platform)))
    .groupBy(products.platform)) {
    if (consoleOf(p.platform, all) === k) used += Number(p.n);
  }
  return { rules: Number(rules?.n ?? 0), products: used };
}

/**
 * How many items use each console, by key (the admin page, one grouped read): an item counts once
 * for a console when its own rules name it or its platform does (what `deleteConsole` refuses on).
 */
export async function consoleUseCounts(db: Pick<Db, 'select'>): Promise<Map<string, number>> {
  const all = await listConsoles(db);
  const out = new Map<string, number>();
  for (const g of await db
    .select({ platform: products.platform, console: itemRules.console, n: count() })
    .from(products)
    .leftJoin(itemRules, eq(itemRules.productId, products.id))
    .where(
      and(
        eq(products.category, 'game'),
        or(isNotNull(products.platform), isNotNull(itemRules.console)),
      ),
    )
    .groupBy(products.platform, itemRules.console)) {
    const keys = new Set([g.console, consoleOf(g.platform, all)].filter((k) => k !== null));
    for (const k of keys) out.set(k, (out.get(k) ?? 0) + Number(g.n));
  }
  return out;
}

/**
 * Deletes a console nothing uses (admins). Returns what uses it, deleting nothing, while an item's
 * rules or a product's platform names it.
 */
export async function deleteConsole(
  db: Db,
  key: string,
): Promise<{ deleted: true } | { deleted: false; use: ConsoleUse | null }> {
  const k = consoleKey(key);
  const [row] = await db.select({ key: consoles.key }).from(consoles).where(eq(consoles.key, k));
  if (!row) return { deleted: false, use: null };
  const use = await consoleUse(db, k);
  if (use.rules > 0 || use.products > 0) return { deleted: false, use };
  await db.delete(consoles).where(eq(consoles.key, k));
  return { deleted: true };
}

// ---------------------------------------------------------------------------------------------
// The plug-ins' suggestions (saved by the home PC with the other plug-in data)

const PLUGIN_KEY = 'consolePlugins';

/** What the plug-ins bring for the console table. */
export interface ConsolePlugins {
  /** Suggested rows (`CollectorModule.consoles`). */
  suggested: ConsoleInput[];
  /** Marketplaces with a search plug-in: each can have a software category per console. */
  searchSources: string[];
  /**
   * The search address for a category id per marketplace that declares one (`Collector.categoryUrl`),
   * with `CATEGORY_URL_SLOT` where the id goes. The app only links to it.
   */
  categoryUrls?: Record<string, string>;
}

/** Saves the plug-ins' console suggestions and search sources (written only when they changed). */
export async function saveConsolePlugins(db: Db, value: ConsolePlugins): Promise<void> {
  const next: ConsolePlugins = {
    suggested: value.suggested.flatMap((c) => {
      const row = cleanConsole(c);
      return row ? [row] : [];
    }),
    searchSources: [...new Set(value.searchSources)].toSorted(),
    categoryUrls: Object.fromEntries(
      Object.entries(value.categoryUrls ?? {})
        .filter(([, url]) => url.startsWith('https://') && url.includes(CATEGORY_URL_SLOT))
        .toSorted(([a], [b]) => (a < b ? -1 : 1)),
    ),
  };
  if (JSON.stringify(await readSetting(db, PLUGIN_KEY)) !== JSON.stringify(next))
    await saveSetting(db, PLUGIN_KEY, next);
}

export async function consolePlugins(db: Pick<Db, 'select'>): Promise<ConsolePlugins> {
  const saved = await readSetting<ConsolePlugins>(db, PLUGIN_KEY);
  return {
    suggested: saved?.suggested ?? [],
    searchSources: saved?.searchSources ?? [],
    categoryUrls: saved?.categoryUrls ?? {},
  };
}

/**
 * Adds the plug-ins' suggested consoles that have no row yet (an admin pressed "Add the suggested
 * consoles"); rows that exist are left as they are. Returns the keys added.
 */
export async function addSuggestedConsoles(db: Db): Promise<string[]> {
  const { suggested } = await consolePlugins(db);
  const at = toLocalIso();
  const added: string[] = [];
  for (const [i, input] of suggested.entries()) {
    const row = cleanConsole(input);
    if (!row) continue;
    const inserted = await db
      .insert(consoles)
      .values({
        key: row.key,
        names: row.names,
        aliases: row.aliases,
        categories: row.categories,
        boxedAllowed: row.boxedAllowed,
        // The plug-in's order when it gives none.
        sort: row.sort || i,
        createdAt: at,
        updatedAt: at,
      })
      .onConflictDoNothing()
      .returning({ key: consoles.key });
    if (inserted.length) added.push(row.key);
  }
  return added;
}
