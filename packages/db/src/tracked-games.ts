// Tracked games (requirements S36 step D; spec wishlist-tracked W17): games admins track before anyone
// wishes for them. Install data (no account download); in no portfolio, Wishlist or deals list. Rules
// in @tora/core tracked-games; the nightly collect's scope is `trackedSkips` (sources.ts).
import {
  type ConsoleRow,
  KIND_CASE_MONTHS,
  MARKET_PER_DAY,
  TRACKED_MONTHLY_EVERY_DAYS,
  TRACKED_PASTE_MAX,
  TRACKED_SLOTS,
  TRACKED_TIERS,
  TRACKED_WEEKLY_EVERY_DAYS,
  type TrackedTier,
  addDays,
  addMonths,
  baseCurrency,
  consoleKey,
  consoleOf,
  identitySources,
  isGameItem,
  localDate,
  newId,
  nightlyMinutes,
  pickSlot,
  slotOfDay,
  toLocalIso,
  wantedFromOf,
} from '@tora/core';
import { and, desc, eq, gte, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { Db } from './client';
import { listConsoles } from './consoles';
import { activeLink, jobKindsBySource, searchLink, sourcesWith } from './deep-reads';
import { marketUsed, readMarketState } from './market-jobs';
import { DomainError } from './mutations';
import { loadSourceRegistry, readSetting, saveSetting } from './registry';
import {
  collectorRuns,
  itemRules,
  marketJobs,
  productSources,
  products,
  sourceCandidates,
  trackedGames,
  users,
  watches,
} from './schema';
import { sourceFacts } from './source-facts';
import {
  QUERY_SOURCE_ID,
  linkSource,
  trackedOnlyGames,
  userHoldsProduct,
  userWatchesProduct,
} from './sources';
import { wishLevelsOf } from './wish-levels';
import { type BulkLine, plainGameFor, previewBulk } from './wishes';

/** The setting that starts the rest's monthly pages (S36 step D): off until an admin turns it on. */
export const TRACKED_REST_KEY = 'trackedRestOn';
/** The kinds of a tracked game's own jobs (core `MARKET_JOB_KINDS`). */
const TRACKED_KINDS = ['tracked_weekly', 'monthly'] as const;
const ACTIVE = ['waiting', 'running'] as const;
/** A live tracked row: not `removed`, which is only a mark (fix round 1, F1) and counts nowhere. */
const LIVE = ne(trackedGames.tier, 'removed');

/** The game identity shops of the install's markets (the primary's first, then the secondary's). */
function gameShops(registry: Awaited<ReturnType<typeof loadSourceRegistry>>): string[] {
  const second = registry.markets?.secondary;
  return [registry.markets?.primary, ...(second ? [second] : [])].flatMap((m) =>
    identitySources(registry, 'game', m),
  );
}

/** Admins only (spec wishlist-tracked: the guard in the page and in every action). */
async function requireAdmin(db: Pick<Db, 'select'>, userId: string): Promise<void> {
  const [user] = await db
    .select({ role: users.role })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.disabledAt)));
  if (user?.role !== 'admin') throw new DomainError('forbidden');
}

/**
 * Whether `userId` may manage the item's links as an admin (fix round 1, F2): an active admin, and
 * the item has a live tracked row. A tracked game belongs to no one, so no holder could confirm its
 * identity shop page; the page's actions allow a holder, or this.
 */
export async function adminManagesTracked(
  db: Pick<Db, 'select'>,
  userId: string,
  productId: string,
): Promise<boolean> {
  const [user] = await db
    .select({ role: users.role })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.disabledAt)));
  if (user?.role !== 'admin') return false;
  const [row] = await db
    .select({ id: trackedGames.productId })
    .from(trackedGames)
    .where(and(eq(trackedGames.productId, productId), LIVE));
  return !!row;
}

/** A link, or the place a link would take: its source, its listing id and the query on it. */
type LinkRef = { source: string; externalId: string | null; query?: unknown };

/**
 * Who may change which pages an item is linked to (confirm or reject a candidate, link an address,
 * unlink a page or link it again): a holder, any link. Anyone else only the item's page at a game
 * identity shop, never a search (its listing id the search's, or a query on the row): a person who
 * watches the item (a wish is on an item its person does not hold) or an admin of a live tracked game
 * (it belongs to no one). Searches and every other source feed the holders' values and stay theirs:
 * at a search-based source any link is read as a search.
 */
export async function managesLinks(
  db: Db,
  userId: string,
  productId: string,
  link: LinkRef,
): Promise<boolean> {
  if (await userHoldsProduct(db, userId, productId)) return true;
  if (link.externalId === QUERY_SOURCE_ID || link.query != null) return false;
  if (!gameShops(await loadSourceRegistry(db)).includes(link.source)) return false;
  return (
    (await userWatchesProduct(db, userId, productId)) ||
    (await adminManagesTracked(db, userId, productId))
  );
}

/**
 * `managesLinks` for the place a write would land (a candidate confirmed, an address linked): the
 * row already there decides (one the collect wrote a query onto is a search), else the place itself.
 * Never the search's own listing id, for anyone: an address cannot stand for a search.
 */
export async function managesLinkAt(
  db: Db,
  userId: string,
  productId: string,
  at: { source: string; externalId: string },
): Promise<boolean> {
  if (at.externalId === QUERY_SOURCE_ID) return false;
  const [row] = await db
    .select({
      source: productSources.source,
      externalId: productSources.externalId,
      query: productSources.query,
    })
    .from(productSources)
    .where(
      and(
        eq(productSources.productId, productId),
        eq(productSources.source, at.source),
        eq(productSources.externalId, at.externalId),
      ),
    );
  return managesLinks(db, userId, productId, row ?? { ...at, query: null });
}

/** Links an address to an item for a person: the guard and the write together. False: refused. */
export async function linkPageAs(
  db: Db,
  userId: string,
  productId: string,
  parsed: { source: string; externalId: string; url?: string | null; title?: string | null },
): Promise<boolean> {
  if (!(await managesLinkAt(db, userId, productId, parsed))) return false;
  await linkSource(db, productId, parsed);
  return true;
}

/** Whether the rest's monthly pages are on (S36 step D); off when never set. */
export async function trackedRestOn(db: Pick<Db, 'select'>): Promise<boolean> {
  return (await readSetting<boolean>(db, TRACKED_REST_KEY)) === true;
}

/** Turns the rest's monthly pages on or off (admins). */
export async function setTrackedRestOn(db: Db, adminId: string, on: boolean): Promise<void> {
  await requireAdmin(db, adminId);
  await saveSetting(db, TRACKED_REST_KEY, on === true);
}

/** Every item someone wishes (a boxed wish also its plain item, whose rows it reads). */
async function wishedIds(db: Pick<Db, 'select'>): Promise<Set<string>> {
  const ids = new Set((await db.select({ id: watches.productId }).from(watches)).map((w) => w.id));
  for (const b of await db
    .select({ id: itemRules.productId, plain: itemRules.boxedOf })
    .from(itemRules)
    .where(eq(itemRules.boxed, true)))
    if (b.plain && ids.has(b.id)) ids.add(b.plain);
  return ids;
}

/** An item's console: its rules row's, else the one its platform names (unknown: null). */
const consoleOfRow = (
  platform: string | null,
  rulesConsole: string | null | undefined,
  consoles: readonly ConsoleRow[],
) => (rulesConsole ? consoleKey(rulesConsole) : consoleOf(platform, consoles));

/**
 * Every tracked game, by console (the console table's order) then name (admins): its console's key
 * (null: unknown; the page names it from the table), its last weekly read's end (null: none yet),
 * `wished` (anyone wishes it: it reads as a wish, every night, and stays tracked), and `shop`: its
 * identity shop page (fix round 1, F2): `linked` (an active link: its prices are read), `pending`
 * (`toCheck` candidates wait for an admin to confirm one on the item's page) or `none` (not found yet).
 * Removed games are not listed.
 */
export async function listTrackedGames(db: Db, adminId: string) {
  await requireAdmin(db, adminId);
  const rows = await db
    .select({
      t: trackedGames,
      name: products.name,
      platform: products.platform,
      console: itemRules.console,
    })
    .from(trackedGames)
    .innerJoin(products, eq(products.id, trackedGames.productId))
    .leftJoin(itemRules, eq(itemRules.productId, trackedGames.productId))
    .where(LIVE);
  const [consoles, wished, registry] = await Promise.all([
    listConsoles(db),
    wishedIds(db),
    loadSourceRegistry(db),
  ]);
  const shops = gameShops(registry);
  const linked = new Set<string>();
  const toCheck = new Map<string, number>();
  if (shops.length && rows.length) {
    for (const r of await db
      .selectDistinct({ id: productSources.productId })
      .from(productSources)
      .innerJoin(trackedGames, eq(trackedGames.productId, productSources.productId))
      .where(and(inArray(productSources.source, shops), eq(productSources.active, true))))
      linked.add(r.id);
    for (const r of await db
      .select({ id: sourceCandidates.productId, n: sql<number>`count(*)` })
      .from(sourceCandidates)
      .innerJoin(trackedGames, eq(trackedGames.productId, sourceCandidates.productId))
      .where(and(inArray(sourceCandidates.source, shops), eq(sourceCandidates.status, 'pending')))
      .groupBy(sourceCandidates.productId))
      toCheck.set(r.id, Number(r.n));
  }
  const last = new Map<string, string>();
  for (const j of await db
    .select({ id: marketJobs.productId, at: sql<string>`max(${marketJobs.finishedAt})` })
    .from(marketJobs)
    .innerJoin(trackedGames, eq(trackedGames.productId, marketJobs.productId))
    .where(and(eq(marketJobs.kind, 'tracked_weekly'), eq(marketJobs.status, 'done')))
    .groupBy(marketJobs.productId))
    if (j.id && j.at) last.set(j.id, j.at);
  const order = (key: string | null) => consoles.findIndex((c) => c.key === key) >>> 0;
  return rows
    .map(({ t, name, platform, console }) => ({
      productId: t.productId,
      name,
      console: consoleOfRow(platform, console, consoles),
      tier: t.tier as TrackedTier,
      slot: t.shopSlot,
      onPc: t.onPc,
      onPcAt: t.onPcAt,
      addedAt: t.addedAt,
      lastWeeklyRead: last.get(t.productId) ?? null,
      wished: wished.has(t.productId),
      // A rest game is never looked for at the shop (only the chosen set is, on its slot night).
      shop: (linked.has(t.productId)
        ? 'linked'
        : toCheck.has(t.productId)
          ? 'pending'
          : t.tier === 'rest'
            ? 'rest'
            : 'none') as 'linked' | 'pending' | 'rest' | 'none',
      toCheck: linked.has(t.productId) ? 0 : (toCheck.get(t.productId) ?? 0),
    }))
    .sort((a, b) => order(a.console) - order(b.console) || a.name.localeCompare(b.name));
}

export type TrackedGameView = Awaited<ReturnType<typeof listTrackedGames>>[number];

/** A pasted line's preview (W9's), each look-alike saying whether it is tracked already. */
export type TrackedPreviewLine = Omit<BulkLine, 'lookAlikes'> & {
  lookAlikes: (BulkLine['lookAlikes'][number] & { tracked: boolean })[];
};

/**
 * The preview of a paste of `name | console` lines (W9's parser and preview, at most 100 lines; more
 * gives `tooMany`): per line new or a look-alike to reuse, or its error (an unknown console among
 * them). Reads only; nothing is written until the admin confirms (`addTrackedGames`). Admins only.
 */
export async function previewTrackedGames(db: Db, adminId: string, text: string) {
  await requireAdmin(db, adminId);
  const { lines, tooMany } = await previewBulk(db, adminId, text, TRACKED_PASTE_MAX);
  const tracked = new Set(
    (await db.select({ id: trackedGames.productId }).from(trackedGames).where(LIVE)).map(
      (r) => r.id,
    ),
  );
  return {
    tooMany,
    lines: lines.map((l) => ({
      ...l,
      lookAlikes: l.lookAlikes.map((a) => ({ ...a, tracked: tracked.has(a.id) })),
    })),
  };
}

/**
 * Tracks an item in the caller's transaction. Refused unless it is a plain game item (cards and
 * sealed can never be tracked); a live row already there stays as it is (false). A chosen game takes
 * the slot with the fewest chosen games (core `pickSlot`), a game of the rest slot 0 (not read by
 * slot). A removed game's row is tracked again (fix round 1, F1): its tier set back and a slot picked
 * as for a new game; its on-PC mark and first day stay.
 */
async function trackIn(
  tx: Parameters<Parameters<Db['transaction']>[0]>[0],
  productId: string,
  tier: TrackedTier,
  adminId: string,
) {
  if (!TRACKED_TIERS.includes(tier)) throw new DomainError('invalid_input');
  const [product] = await tx.select().from(products).where(eq(products.id, productId));
  if (!product) throw new DomainError('not_found');
  const [rules] = await tx.select().from(itemRules).where(eq(itemRules.productId, productId));
  if (!isGameItem(product, rules ?? null) || rules?.boxed) throw new DomainError('invalid_input');
  const counts = Array<number>(TRACKED_SLOTS).fill(0);
  for (const r of await tx
    .select({ slot: trackedGames.shopSlot, n: sql<number>`count(*)` })
    .from(trackedGames)
    .where(eq(trackedGames.tier, 'chosen'))
    .groupBy(trackedGames.shopSlot))
    counts[r.slot] = Number(r.n);
  const shopSlot = tier === 'chosen' ? pickSlot(counts) : 0;
  const added = await tx
    .insert(trackedGames)
    .values({ productId, tier, addedBy: adminId, shopSlot })
    .onConflictDoUpdate({
      target: trackedGames.productId,
      set: { tier, shopSlot },
      setWhere: eq(trackedGames.tier, 'removed'),
    })
    .returning({ id: trackedGames.productId });
  return added.length > 0;
}

/** Tracks one item already in Tora (admins); false when it was tracked already. */
export async function trackGame(
  db: Db,
  adminId: string,
  productId: string,
  tier: TrackedTier = 'chosen',
): Promise<boolean> {
  await requireAdmin(db, adminId);
  return db.transaction((tx) => trackIn(tx, productId, tier, adminId));
}

export type TrackedAddResult =
  | { line: number; name: string; ok: true; productId: string; reused: boolean; already: boolean }
  | { line: number; name: string; ok: false; error: string };

/**
 * Adds a paste's lines as tracked games (admins); `choices` gives each preview line `new` or one of
 * its look-alikes' ids. One transaction a line: the item (reused, or new with its rules row; no watch,
 * no holding) and its tracked row. A line with an error, no valid choice or a failed write is reported
 * with its reason; the others stand. Over 100 lines: refused, nothing written.
 */
export async function addTrackedGames(
  db: Db,
  adminId: string,
  text: string,
  choices: Readonly<Record<number, string>>,
  tier: TrackedTier = 'chosen',
): Promise<TrackedAddResult[]> {
  const { lines, tooMany } = await previewTrackedGames(db, adminId, text);
  if (tooMany || !TRACKED_TIERS.includes(tier)) throw new DomainError('invalid_input');
  const out: TrackedAddResult[] = [];
  for (const { line, name, console, error, lookAlikes } of lines) {
    const choice = choices[line];
    const reuse = choice && choice !== 'new' ? choice : null;
    const bad =
      error ?? (!choice || (reuse && !lookAlikes.some((a) => a.id === reuse)) ? 'choice' : null);
    if (bad) {
      out.push({ line, name, ok: false, error: bad });
      continue;
    }
    try {
      const done = await db.transaction(async (tx) => {
        const game = { name, console: console!, reuse };
        const { product: p, reused } = await plainGameFor(tx, adminId, game);
        return { productId: p.id, reused, already: !(await trackIn(tx, p.id, tier, adminId)) };
      });
      out.push({ line, name, ok: true, ...done });
    } catch (e) {
      out.push({ line, name, ok: false, error: e instanceof DomainError ? e.code : 'failed' });
    }
  }
  return out;
}

/**
 * Stops tracking a game (admins): its row is kept as a mark, tier `removed` (fix round 1, F1: while no
 * one holds or wishes it, the nightly collect keeps leaving it out, so its auto searches are not read
 * every night), and its waiting tracked jobs stop; the item, its sales and its links stay. False when
 * it was not tracked.
 */
export async function untrackGame(db: Db, adminId: string, productId: string): Promise<boolean> {
  await requireAdmin(db, adminId);
  return db.transaction(async (tx) => {
    const gone = await tx
      .update(trackedGames)
      .set({ tier: 'removed' })
      .where(and(eq(trackedGames.productId, productId), LIVE))
      .returning({ id: trackedGames.productId });
    if (!gone.length) return false;
    await tx
      .update(marketJobs)
      .set({ status: 'stopped', error: 'untracked', finishedAt: toLocalIso() })
      .where(
        and(
          eq(marketJobs.productId, productId),
          inArray(marketJobs.kind, [...TRACKED_KINDS]),
          inArray(marketJobs.status, [...ACTIVE]),
        ),
      );
    return true;
  });
}

/**
 * Marks a tracked game as on PC from `day` (admins; a real `YYYY-MM-DD` not after today in the app's
 * zone), or clears the mark (`null`). It stays tracked (S36 step D). False when it is not tracked.
 */
export async function markTrackedOnPc(
  db: Db,
  adminId: string,
  productId: string,
  day: string | null,
  now = new Date(),
): Promise<boolean> {
  await requireAdmin(db, adminId);
  const real = day !== null && /^\d{4}-\d{2}-\d{2}$/.test(day) && addDays(day, 0) === day;
  if (day !== null && (!real || day > localDate(now))) throw new DomainError('invalid_input');
  const done = await db
    .update(trackedGames)
    .set({ onPc: day !== null, onPcAt: day })
    .where(and(eq(trackedGames.productId, productId), LIVE))
    .returning({ id: trackedGames.productId });
  return done.length > 0;
}

/**
 * The nightly closing step for tracked games (S36 step D, B4; no request). Stops the waiting tracked
 * jobs of an item untracked, held or wished (someone holds, watches or ranks it: the nightly collect
 * reads it every night; `trackedOnlyGames`, fix round 1, F3), of the other tier, with the rest off or
 * its search off. Queues a weekly read (`tracked_weekly`) of each chosen tracked-only plain game on its slot
 * night at each marketplace with that kind and its active search (none there in 7 days; a missed slot
 * night is caught up: none in 14 days, tracked a week); with the rest on, one monthly page of each game
 * of the rest at the first such marketplace (none at any in 30 days). Ordered after wishes' jobs.
 */
export async function queueTrackedReads(
  db: Db,
  now: Date,
): Promise<{ queued: number; stopped: number }> {
  const rows = await db.select().from(trackedGames).where(LIVE);
  const active = await db
    .select()
    .from(marketJobs)
    .where(
      and(inArray(marketJobs.kind, [...TRACKED_KINDS]), inArray(marketJobs.status, [...ACTIVE])),
    );
  const byId = new Map(rows.map((r) => [r.productId, r]));
  const [only, wished, restOn, kinds] = await Promise.all([
    trackedOnlyGames(db),
    wishedIds(db),
    trackedRestOn(db),
    jobKindsBySource(db),
  ]);
  const at = toLocalIso(now);
  let stopped = 0;
  for (const job of active) {
    const t = job.productId ? byId.get(job.productId) : undefined;
    const why = !t
      ? 'untracked'
      : !only.has(t.productId)
        ? wished.has(t.productId)
          ? 'wished'
          : 'held'
        : (job.kind === 'tracked_weekly') !== (t.tier === 'chosen')
          ? 'tier changed'
          : job.kind === 'monthly' && !restOn
            ? 'rest off'
            : !(await searchLink(db, t.productId, job.source))
              ? 'search off'
              : null;
    if (!why) continue;
    const gone = await db
      .update(marketJobs)
      .set({ status: 'stopped', error: why, finishedAt: at })
      .where(and(eq(marketJobs.id, job.id), inArray(marketJobs.status, [...ACTIVE])))
      .returning({ id: marketJobs.id });
    stopped += gone.length;
  }
  const today = localDate(now);
  const tonight = slotOfDay(today);
  const games = new Set<string>();
  for (const r of await db
    .select({ product: products, gameRules: itemRules.gameRules, boxed: itemRules.boxed })
    .from(trackedGames)
    .innerJoin(products, eq(products.id, trackedGames.productId))
    .leftJoin(itemRules, eq(itemRules.productId, trackedGames.productId))
    .where(LIVE))
    if (!r.boxed && only.has(r.product.id) && isGameItem(r.product, r)) games.add(r.product.id);
  let queued = 0;
  for (const t of rows) {
    if (t.tier !== 'chosen' || !games.has(t.productId)) continue;
    // Tonight's slot: none within a week; else a catch-up: none within two weeks, tracked a week.
    const days =
      t.shopSlot === tonight
        ? TRACKED_WEEKLY_EVERY_DAYS
        : t.addedAt.slice(0, 10) <= addDays(today, -TRACKED_WEEKLY_EVERY_DAYS)
          ? 2 * TRACKED_WEEKLY_EVERY_DAYS
          : null;
    if (days === null) continue;
    for (const source of sourcesWith(kinds, 'tracked_weekly'))
      queued += await queueJob(db, source, t.productId, 'tracked_weekly', today, at, days);
  }
  if (restOn)
    for (const t of rows) {
      if (t.tier !== 'rest' || !games.has(t.productId)) continue;
      for (const source of sourcesWith(kinds, 'monthly').sort()) {
        if (!(await searchLink(db, t.productId, source))) continue;
        queued += await queueJob(db, source, t.productId, 'monthly', today, at);
        break;
      }
    }
  return { queued, stopped };
}

/**
 * One tracked job in one statement (a rerun leaves one): only with an active search there, none of
 * the kind waiting or running, and none made within `days` (a weekly read: at that marketplace; a
 * monthly page: at any, 30 days).
 */
async function queueJob(
  db: Db,
  source: string,
  productId: string,
  kind: (typeof TRACKED_KINDS)[number],
  today: string,
  at: string,
  days = TRACKED_MONTHLY_EVERY_DAYS,
): Promise<number> {
  const wanted = kind === 'tracked_weekly' ? wantedFromOf(kind, today) : null;
  const where = kind === 'tracked_weekly' ? sql`source = ${source} AND` : sql``;
  const rows = await db.all<{ id: string }>(sql`
    INSERT INTO market_jobs (id, source, product_id, kind, status, wanted_from, created_at)
    SELECT ${newId()}, ${source}, ${productId}, ${kind}, 'waiting', ${wanted}, ${at}
    WHERE ${activeLink(source, productId)} AND NOT EXISTS (
      SELECT 1 FROM market_jobs WHERE ${where} product_id = ${productId} AND kind = ${kind}
        AND (status IN ('waiting', 'running') OR substr(created_at, 1, 10) > ${addDays(today, -days)}))
    ON CONFLICT DO NOTHING RETURNING id`);
  return rows.length;
}

/**
 * What the tracked list costs (admins; the page counts games per console from the list). `weekly`,
 * per marketplace with weekly reads: the requests a day the chosen tracked-only games need (no one
 * holds, watches or ranks them: those are read every night; games times the requests its done weekly
 * reads took in 30 days, over 7; `atLeast`: none measured, one a read), against its number a day and
 * today's use. `nightly`: the identity shop's added minutes for the chosen tracked-only games read
 * there only on their slot night, at its pace over its last 10 runs (null: unknown). It counts only
 * the games with an active link there (the collect reads links; fix round 1, F2); `toConfirm` counts
 * the others with candidates waiting for an admin to confirm one.
 */
export async function trackedTotals(db: Db, adminId: string, now = new Date()) {
  await requireAdmin(db, adminId);
  const [kinds, registry, only] = await Promise.all([
    jobKindsBySource(db),
    loadSourceRegistry(db),
    trackedOnlyGames(db),
  ]);
  const chosen = [...only].filter(([, t]) => t.tier === 'chosen').map(([id]) => id);
  const games = chosen.length;
  const today = localDate(now);
  const weekly = [];
  for (const source of sourcesWith(kinds, 'tracked_weekly').sort()) {
    const [avg] = await db
      .select({ requests: sql<number | null>`avg(${marketJobs.requests})` })
      .from(marketJobs)
      .where(
        and(
          eq(marketJobs.source, source),
          eq(marketJobs.kind, 'tracked_weekly'),
          eq(marketJobs.status, 'done'),
          gte(marketJobs.finishedAt, addDays(today, -30)),
        ),
      );
    const perRead = Number(avg?.requests ?? 0);
    weekly.push({
      source,
      games,
      perDayNeeded: Math.ceil((games * Math.max(perRead, 1)) / TRACKED_WEEKLY_EVERY_DAYS),
      atLeast: !(perRead > 0),
      perDay: (await readMarketState(db, source))?.perDay ?? MARKET_PER_DAY,
      usedToday: await marketUsed(db, source, today),
    });
  }
  // The pace is the primary market's shop's; the games are counted at every game identity shop, as
  // the list and the collect do.
  const shops = gameShops(registry);
  const shop = identitySources(registry, 'game', registry.markets?.primary)[0] ?? null;
  let onSlot = 0;
  let toConfirm = 0;
  let msPerRequest: number | null = null;
  if (shop && chosen.length) {
    const linked = new Set<string>();
    const pending = new Set<string>();
    for (let i = 0; i < chosen.length; i += 500) {
      const ids = chosen.slice(i, i + 500);
      for (const r of await db
        .selectDistinct({ id: productSources.productId })
        .from(productSources)
        .where(
          and(
            inArray(productSources.source, shops),
            eq(productSources.active, true),
            inArray(productSources.productId, ids),
          ),
        ))
        linked.add(r.id);
      for (const r of await db
        .selectDistinct({ id: sourceCandidates.productId })
        .from(sourceCandidates)
        .where(
          and(
            inArray(sourceCandidates.source, shops),
            eq(sourceCandidates.status, 'pending'),
            inArray(sourceCandidates.productId, ids),
          ),
        ))
        pending.add(r.id);
    }
    onSlot = linked.size;
    toConfirm = [...pending].filter((id) => !linked.has(id)).length;
  }
  if (shop) {
    const runs = await db
      .select({ ms: collectorRuns.activeMs, requests: collectorRuns.requests })
      .from(collectorRuns)
      .where(and(eq(collectorRuns.source, shop), sql`${collectorRuns.activeMs} IS NOT NULL`))
      .orderBy(desc(collectorRuns.startedAt))
      .limit(10);
    const ms = runs.reduce((a, r) => a + (r.ms ?? 0), 0);
    const requests = runs.reduce((a, r) => a + r.requests, 0);
    msPerRequest = requests > 0 && ms > 0 ? ms / requests : null;
  }
  return {
    weekly,
    nightly: {
      source: shop,
      games: onSlot,
      toConfirm,
      minutes: nightlyMinutes(onSlot, msPerRequest),
    },
  };
}

export type TrackedTotals = Awaited<ReturnType<typeof trackedTotals>>;

type Months = (typeof KIND_CASE_MONTHS)[number];
type Money = { amount: number; currency: string };
type Facts = { maker: string | null; releaseDate: string | null; listPrice: Money | null };

/**
 * The cases an estimate can look at (spec wishlist-tracked "Cases"; W15's "games of its kind"): the
 * tracked games of the wished game's console and of the same maker (the identity shop's) or series
 * (`products.franchise`); when the wished game has neither, or no tracked game of its console shares
 * them, every tracked game of its console, with `basis` 'console' saying so. Each with its release date (the item's, else the shop's), the shop's
 * list price in its own currency, and per 3, 6 and 12 months after release the stored level that day
 * (`wish_levels` in `bucket`, base currency) and that level over the list price (null when either is
 * unknown or the currencies differ); `counts` holds how many cases have a level at each. No model, no
 * prediction. `basis` null: its console is unknown (no cases).
 */
export async function kindCases(db: Pick<Db, 'select'>, productId: string, bucket = 'cond:good') {
  const counts: Record<Months, number> = { 3: 0, 6: 0, 12: 0 };
  const consoles = await listConsoles(db);
  const withConsole = <T extends { product: { platform: string | null }; console: string | null }>(
    r: T,
  ) => ({ ...r, key: consoleOfRow(r.product.platform, r.console, consoles) });
  const [item] = (
    await db
      .select({ product: products, console: itemRules.console })
      .from(products)
      .leftJoin(itemRules, eq(itemRules.productId, products.id))
      .where(eq(products.id, productId))
  ).map(withConsole);
  if (!item?.key)
    return { basis: null as 'kind' | 'console' | null, console: null, cases: [], counts };
  const rows = (
    await db
      .select({ product: products, console: itemRules.console })
      .from(trackedGames)
      .innerJoin(products, eq(products.id, trackedGames.productId))
      .leftJoin(itemRules, eq(itemRules.productId, trackedGames.productId))
      .where(LIVE)
  )
    .map(withConsole)
    .filter((r) => r.product.id !== productId && r.key === item.key);
  const registry = await loadSourceRegistry(db);
  const facts = await shopFacts(db, [productId, ...rows.map((r) => r.product.id)], registry);
  const norm = (s: string | null | undefined) => s?.normalize('NFKC').trim().toLowerCase() || null;
  const maker = norm(facts.get(productId)?.maker);
  const series = norm(item.product.franchise);
  const same = rows.filter(
    (r) =>
      (maker && norm(facts.get(r.product.id)?.maker) === maker) ||
      (series && norm(r.product.franchise) === series),
  );
  // No maker or series, or none of the console's tracked games shares them: the console's tracked
  // games, said so (`basis` 'console'; fix round 1, F5).
  const basis = same.length ? 'kind' : 'console';
  const kind = same.length ? same : rows;
  const levels = await wishLevelsOf(
    db,
    kind.map((r) => ({ productId: r.product.id, bucket })),
  );
  const base = baseCurrency(registry);
  const cases = kind.map(({ product: p }) => {
    const f = facts.get(p.id);
    const releaseDate = p.releaseDate ?? f?.releaseDate ?? null;
    const listPrice = f?.listPrice ?? null;
    const days = levels.get(`${p.id}|${bucket}`)?.series ?? [];
    return {
      productId: p.id,
      name: p.name,
      releaseDate,
      listPrice,
      at: KIND_CASE_MONTHS.map((months) => {
        const day = releaseDate ? addMonths(releaseDate, months) : null;
        const level = days.find((d) => day !== null && d.day === day)?.level ?? null;
        if (level !== null) counts[months]++;
        const ofList =
          level !== null && listPrice?.currency === base && listPrice.amount > 0
            ? level / listPrice.amount
            : null;
        return { months, day, level: level as number | null, ofList };
      }),
    };
  });
  cases.sort((a, b) => a.name.localeCompare(b.name));
  return { basis: basis as 'kind' | 'console' | null, console: item.key, cases, counts };
}

export type KindCase = Awaited<ReturnType<typeof kindCases>>['cases'][number];

/**
 * The game identity shops' facts per item (A5: maker, release date, list price), from their active
 * links; each fact from the first link that shows it.
 */
async function shopFacts(
  db: Pick<Db, 'select'>,
  ids: string[],
  registry: Awaited<ReturnType<typeof loadSourceRegistry>>,
) {
  const out = new Map<string, Facts>();
  const shops = gameShops(registry);
  if (!shops.length) return out;
  for (const r of await db
    .select({ id: productSources.productId, facts: productSources.facts })
    .from(productSources)
    .where(
      and(
        inArray(productSources.productId, ids),
        inArray(productSources.source, shops),
        eq(productSources.active, true),
      ),
    )) {
    const f = sourceFacts(r.facts);
    if (!f) continue;
    const was = out.get(r.id);
    const list = f.listPrice && { amount: f.listPrice.amount, currency: f.listPrice.currency };
    const listPrice = was?.listPrice ?? list ?? null;
    out.set(r.id, {
      maker: was?.maker ?? f.maker,
      releaseDate: was?.releaseDate ?? f.releaseDate,
      listPrice,
    });
  }
  return out;
}
