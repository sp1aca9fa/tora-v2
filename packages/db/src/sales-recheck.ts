// The re-check of stored sales (requirements S30 step 5): its reads, writes and undo. What to change
// is decided by the plug-ins' own rules (`recheck.ts` in @tora/collector-sdk); this file knows no
// rule and no source. It only ever excludes: a changed row gets excluded = 1, a reason, and two keys
// in raw (`filter`, `recheck`: the run's id). Prices, bucket, title and dates are never written.
//
// The ledger is what makes it undoable, in app_settings (no migration): `salesRecheckRuns` lists the
// runs, `salesRecheck:<run>:<n>` holds per batch the stamp it wrote and its rows, each `[id, source,
// old raw text, old updated_at, reason]`. Raw is read and restored as text through $client, never
// parsed: drizzle's json mode would write it back re-serialized. Every read of app_settings goes by
// key, so pages never load the ledger.
import { localDate, toLocalIso } from '@tora/core';
import { and, eq, gte, inArray, lt } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import type { Db } from './client';
import { refreshItemSales } from './item-sales';
import { readSetting, saveSetting } from './registry';
import {
  appSettings,
  collectorRuns,
  holdings,
  type Product,
  type ProductSource,
  productSources,
  products,
  suggestions,
  watches,
} from './schema';
import { clearBucketValues, holdingBucket, savedBucketValues } from './valuation';

export const RECHECK_RUNS_KEY = 'salesRecheckRuns';
const ledgerPrefix = (run: string) => `salesRecheck:${run}:`;
/** Rows in one write (one transaction): the app waits at most this long for the database. */
export const RECHECK_BATCH = 200;

/**
 * Item -> the last day a run or an undo changed which of its sales count. Past daily numbers are
 * never rewritten, so the numbers up to that day and those after it are two different series, and
 * the step between them is no fall in price: `sharpDrops` does not compare across it. It holds for
 * everyone and any pair, held or watched, now or later. People's own `alertDrops` are never written.
 */
export const VALUE_SERIES_BREAK_KEY = 'valueSeriesBreak';
export type ValueSeriesBreak = Record<string, string>;

/**
 * Before the first batch or restore, so a crash at any point leaves it written. The latest day wins
 * and nothing is ever removed, so stacked runs, reruns and undos in any order cannot go wrong.
 */
export async function writeValueSeriesBreak(
  db: Db,
  productIds: string[],
  now: Date,
): Promise<void> {
  if (productIds.length === 0) return;
  const day = localDate(now);
  const breaks = { ...(await readSetting<ValueSeriesBreak>(db, VALUE_SERIES_BREAK_KEY)) };
  for (const id of productIds) {
    if ((breaks[id] ?? '') < day) breaks[id] = day;
  }
  await saveSetting(db, VALUE_SERIES_BREAK_KEY, breaks);
}

/** A stored sold row with its raw exactly as stored. */
export interface StoredSaleRow {
  id: string;
  productId: string;
  source: string;
  bucket: string | null;
  price: number;
  priceOriginal: number | null;
  observedAt: string;
  createdAt: string;
  updatedAt: string;
  title: string | null;
  rawText: string | null;
  excluded: boolean;
  excludedReason: string | null;
  /** Its lot size is a guess, so its price is too. */
  estimated: boolean;
}

/** One source's stored sold rows, through the source + reference index. */
export async function readStoredSales(db: Db, source: string): Promise<StoredSaleRow[]> {
  const { rows } = await db.$client.execute({
    sql: `select id, product_id, source, bucket, price_base, price_original, observed_at, created_at,
            updated_at, title, raw, excluded, excluded_reason, quantity_inferred
          from price_observations where source = ? and observation_type = 'sold'`,
    args: [source],
  });
  return rows.map((r) => ({
    id: r.id as string,
    productId: r.product_id as string,
    source: r.source as string,
    bucket: r.bucket as string | null,
    price: r.price_base as number,
    priceOriginal: r.price_original as number | null,
    observedAt: r.observed_at as string,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    title: r.title as string | null,
    rawText: r.raw as string | null,
    excluded: !!r.excluded,
    excludedReason: r.excluded_reason as string | null,
    estimated: !!r.quantity_inferred,
  }));
}

/** The listings of these sources, by `source|product`. */
export async function recheckLinks(db: Db, sources: string[]): Promise<Map<string, ProductSource>> {
  const out = new Map<string, ProductSource>();
  for (const l of await db
    .select()
    .from(productSources)
    .where(inArray(productSources.source, sources))) {
    out.set(`${l.source}|${l.productId}`, l);
  }
  return out;
}

export async function recheckItems(db: Db): Promise<Map<string, Product>> {
  return new Map((await db.select().from(products)).map((p) => [p.id, p]));
}

/** Sources with a collector run marked running. */
export async function runningCollectorSources(db: Db): Promise<string[]> {
  const rows = await db
    .selectDistinct({ source: collectorRuns.source })
    .from(collectorRuns)
    .where(eq(collectorRuns.status, 'running'));
  return rows.map((r) => r.source);
}

/** Sales a person refused to exclude when asked: their word stands over any rule. */
export async function dismissedExclusions(db: Db): Promise<Set<string>> {
  const rows = await db
    .select({ targetKey: suggestions.targetKey })
    .from(suggestions)
    .where(and(eq(suggestions.kind, 'exclude_sale'), eq(suggestions.status, 'dismissed')));
  return new Set(rows.map((r) => r.targetKey));
}

export type RecheckReason = 'mismatch' | 'outlier';

export interface RecheckChange {
  id: string;
  source: string;
  reason: RecheckReason;
  /** The wording the live path keeps in `raw.filter`. */
  filter: string;
  /** The row as it was read: if it has changed since, it is left alone. */
  rawText: string;
  updatedAt: string;
}

export interface RecheckRun {
  id: string;
  rulesId: string;
  startedAt: string;
  finishedAt?: string;
  /** `running` with its lock free: it was interrupted. `partial`: another run took over from it. */
  status: 'running' | 'partial' | 'done' | 'undone';
  /** Rows changed, and rows skipped because they changed meanwhile, once it ended. */
  changed?: number;
  meanwhile?: number;
  undo?: UndoCounts;
}

export interface UndoCounts {
  restored: number;
  alreadyBack: number;
  changedByPerson: number;
  gone: number;
}

export const readRecheckRuns = async (db: Db): Promise<RecheckRun[]> =>
  (await readSetting<RecheckRun[]>(db, RECHECK_RUNS_KEY)) ?? [];

const saveRun = async (db: Db, run: RecheckRun) => {
  const runs = await readRecheckRuns(db);
  await saveSetting(db, RECHECK_RUNS_KEY, [...runs.filter((r) => r.id !== run.id), run]);
};

type LedgerRow = [
  id: string,
  source: string,
  raw: string,
  updatedAt: string,
  reason: RecheckReason,
];

type LedgerEntry = { at: string; rows: LedgerRow[] };

/** The run's ledger, in writing order. */
async function readLedger(db: Db, run: string): Promise<({ n: number } & LedgerEntry)[]> {
  const prefix = ledgerPrefix(run);
  const entries = await db
    .select({ key: appSettings.key, value: appSettings.value })
    .from(appSettings)
    .where(and(gte(appSettings.key, prefix), lt(appSettings.key, `${prefix.slice(0, -1)};`)));
  return entries
    .map((e) => ({ n: Number(e.key.slice(prefix.length)), ...(e.value as LedgerEntry) }))
    .sort((a, b) => a.n - b.n);
}

/** Rows an interrupted run of these rules has written, to continue it; 0 when there is none. */
export async function recheckWrittenSoFar(db: Db, rulesId: string): Promise<number> {
  const open = (await readRecheckRuns(db)).find((r) => r.status === 'running');
  if (open?.rulesId !== rulesId) return 0;
  return (await readLedger(db, open.id)).reduce((sum, e) => sum + e.rows.length, 0);
}

/** The sources a run wrote to, from its ledger. */
export async function recheckRunSources(db: Db, run: string): Promise<string[]> {
  const rows = (await readLedger(db, run)).flatMap((e) => e.rows);
  return [...new Set(rows.map((r) => r[1]))];
}

/**
 * The run to write under: called holding the locks, so a `running` entry is one that was
 * interrupted. The same rules continue under its id; other rules leave it `partial` (values of what
 * it changed cleared) and start a new run. The id is known before the first batch is written.
 */
export async function openRecheckRun(
  db: Db,
  rulesId: string,
  now: Date,
): Promise<{ run: RecheckRun; continued: boolean; left?: string }> {
  const open = (await readRecheckRuns(db)).find((r) => r.status === 'running');
  if (open?.rulesId === rulesId) return { run: open, continued: true };
  if (open) {
    await settle(db, open.id, now);
    await saveRun(db, { ...open, status: 'partial', finishedAt: toLocalIso(now) });
  }
  const run: RecheckRun = {
    id: `${localDate(now).replaceAll('-', '')}-${randomBytes(3).toString('hex')}`,
    rulesId,
    startedAt: toLocalIso(now),
    status: 'running',
  };
  await saveRun(db, run);
  return { run, continued: false, left: open?.id };
}

/** The next free batch number of a run. */
export const nextRecheckBatch = async (db: Db, run: string): Promise<number> =>
  ((await readLedger(db, run)).at(-1)?.n ?? 0) + 1;

/**
 * Excludes one batch and records it, in one transaction (never `$client` inside `db.transaction`: it
 * waits 60 s and fails with SQLITE_BUSY). A row is changed only if it is still as it was read; a
 * ledger entry for one left alone is harmless, since undo's own check counts it. Returns the rows
 * changed.
 */
export async function writeRecheckBatch(
  db: Db,
  run: string,
  n: number,
  changes: RecheckChange[],
  now: Date,
): Promise<number> {
  const at = toLocalIso(now);
  const ledger: LedgerRow[] = changes.map((c) => [
    c.id,
    c.source,
    c.rawText,
    c.updatedAt,
    c.reason,
  ]);
  const entry: LedgerEntry = { at, rows: ledger };
  const results = await db.$client.batch(
    [
      ...changes.map((c) => ({
        sql: `update price_observations
              set excluded = 1, excluded_reason = ?,
                raw = json_set(raw, '$.filter', ?, '$.recheck', ?), updated_at = ?
              where id = ? and source = ? and excluded = 0 and excluded_reason is null
                and updated_at = ? and raw = ?`,
        args: [c.reason, c.filter, run, at, c.id, c.source, c.updatedAt, c.rawText],
      })),
      {
        sql: `insert into app_settings (key, value, created_at, updated_at) values (?, ?, ?, ?)`,
        args: [`${ledgerPrefix(run)}${n}`, JSON.stringify(entry), at, at],
      },
    ],
    'write',
  );
  return results.slice(0, -1).reduce((sum, r) => sum + r.rowsAffected, 0);
}

const chunks = <T>(list: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

/** The items the ledger's rows belong to now (a merge moves a row to another item). */
async function currentItems(db: Db, ids: string[]): Promise<string[]> {
  const items = new Set<string>();
  for (const part of chunks(ids, 500)) {
    const { rows } = await db.$client.execute({
      sql: `select distinct product_id from price_observations
            where id in (${part.map(() => '?').join(',')})`,
      args: part,
    });
    for (const r of rows) items.add(r.product_id as string);
  }
  return [...items];
}

/** Every person's owned and watched item + condition among these items, as `sharpDrops` keys them. */
async function heldOrWatched(db: Db, productIds: string[]) {
  const pairs: { userId: string; product: Product; bucket: string }[] = [];
  for (const part of chunks(productIds, 200)) {
    for (const { holding, product } of await db
      .select({ holding: holdings, product: products })
      .from(holdings)
      .innerJoin(products, eq(products.id, holdings.productId))
      .where(and(eq(holdings.status, 'owned'), inArray(holdings.productId, part)))) {
      const bucket = holdingBucket(holding, product) ?? '';
      pairs.push({ userId: holding.userId, product, bucket });
    }
    for (const { watch, product } of await db
      .select({ watch: watches, product: products })
      .from(watches)
      .innerJoin(products, eq(products.id, watches.productId))
      .where(inArray(watches.productId, part))) {
      pairs.push({ userId: watch.userId, product, bucket: watch.bucket });
    }
  }
  return pairs;
}

const pairValues = (pairs: Awaited<ReturnType<typeof heldOrWatched>>, now: Date, db: Db) =>
  savedBucketValues(
    db,
    pairs.map((p) => ({ product: p.product, bucket: p.bucket || null })),
    now,
  );

/**
 * The last step of a run and of an undo, in this order. Packed rows first: `savedBucketValues` saves
 * a missing value from them when a page loads, so values are cleared only once they are right. Then
 * the held and watched pairs' values are saved again, from the cleaned sales.
 */
async function settle(db: Db, run: string, now: Date): Promise<{ items: number }> {
  const ids = (await readLedger(db, run)).flatMap((e) => e.rows.map((r) => r[0]));
  const items = await currentItems(db, ids);
  const pairs = await heldOrWatched(db, items);
  await refreshItemSales(db, { marksOnly: true, now });
  await clearBucketValues(db, items);
  await pairValues(pairs, now, db);
  return { items: items.length };
}

export interface RecheckEnd {
  changed: number;
  meanwhile: number;
  items: number;
}

/** Ends a run: the counts are read back from the rows, so an interrupted attempt counts too. */
export async function finishRecheckRun(db: Db, run: RecheckRun, now: Date): Promise<RecheckEnd> {
  const ledger = (await readLedger(db, run.id)).flatMap((e) => e.rows);
  let changed = 0;
  for (const part of chunks(ledger, 500)) {
    const { rows } = await db.$client.execute({
      sql: `select count(*) as n from price_observations
            where id in (${part.map(() => '?').join(',')}) and json_extract(raw, '$.recheck') = ?`,
      args: [...part.map((r) => r[0]), run.id],
    });
    changed += Number(rows[0]!.n);
  }
  const { items } = await settle(db, run.id, now);
  const meanwhile = ledger.length - changed;
  await saveRun(db, { ...run, status: 'done', finishedAt: toLocalIso(now), changed, meanwhile });
  return { changed, meanwhile, items };
}

type Current = {
  id: string;
  excluded: number;
  excluded_reason: string | null;
  raw: string | null;
  updated_at: string;
  recheck: string | null;
};

/**
 * Puts a run's rows back. Only a row still as the run left it (excluded, the same reason, its id in
 * raw) is restored; a row a person changed since stays as they left it, and what was deleted stays
 * deleted. Safe to run twice. Without `apply` it only counts.
 */
export async function undoRecheckRun(
  db: Db,
  runId: string,
  options: { apply: boolean; now: Date },
): Promise<UndoCounts & { items: number }> {
  const run = (await readRecheckRuns(db)).find((r) => r.id === runId);
  if (!run) throw new Error(`No re-check run ${runId}.`);
  const counts: UndoCounts = { restored: 0, alreadyBack: 0, changedByPerson: 0, gone: 0 };
  const entries = await readLedger(db, runId);
  let broken = false;
  for (const { at, rows: ledger } of entries) {
    const ids = ledger.map((r) => r[0]);
    const { rows } = await db.$client.execute({
      sql: `select id, excluded, excluded_reason, raw, updated_at,
              json_extract(raw, '$.recheck') as recheck
            from price_observations where id in (${ids.map(() => '?').join(',')})`,
      args: ids,
    });
    const current = new Map(rows.map((r) => [r.id as string, r as unknown as Current]));
    const restore: LedgerRow[] = [];
    for (const row of ledger) {
      const [id, , raw, updatedAt, reason] = row;
      const now = current.get(id);
      if (!now) counts.gone++;
      else if (now.excluded && now.excluded_reason === reason && now.recheck === runId) {
        restore.push(row);
      } else if (
        !now.excluded &&
        now.excluded_reason === null &&
        now.raw === raw &&
        now.updated_at === updatedAt
      ) {
        counts.alreadyBack++;
      } else counts.changedByPerson++;
    }
    if (!options.apply) {
      counts.restored += restore.length;
      continue;
    }
    if (restore.length === 0) continue;
    // Bringing rows back moves values as much as taking them out did.
    if (!broken) {
      const all = entries.flatMap((e) => e.rows.map((r) => r[0]));
      await writeValueSeriesBreak(db, await currentItems(db, all), options.now);
      broken = true;
    }
    // The old date only over this run's stamp: a later one (a merge, a repricing) is the trace that
    // protects the row from the next run.
    const results = await db.$client.batch(
      restore.map(([id, source, raw, updatedAt, reason]) => ({
        sql: `update price_observations
              set excluded = 0, excluded_reason = null, raw = ?,
                updated_at = case when updated_at = ? then ? else updated_at end
              where id = ? and source = ? and excluded = 1 and excluded_reason = ?
                and json_extract(raw, '$.recheck') = ?`,
        args: [raw, at, updatedAt, id, source, reason, runId],
      })),
      'write',
    );
    for (const r of results) {
      if (r.rowsAffected) counts.restored++;
      else counts.changedByPerson++;
    }
  }
  if (!options.apply) return { ...counts, items: 0 };
  // A second undo finds nothing to do: the first one's counts are the ones that tell.
  if (run.status === 'undone' && counts.restored === 0) return { ...counts, items: 0 };
  const { items } = await settle(db, runId, options.now);
  await saveRun(db, { ...run, status: 'undone', undo: run.undo ?? counts });
  return { ...counts, items };
}
