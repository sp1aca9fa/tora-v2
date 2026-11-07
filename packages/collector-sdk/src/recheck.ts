// The re-check of stored sales (requirements S30 step 5): today's rules, run again on what is stored,
// through the plug-in's own functions (no rule is copied here). This file holds the flow: it reads,
// asks the plug-in, works out what to change and writes through @tora/db. Only exclusions: a row a
// rule now lets through stays excluded, a bucket is never rewritten. Dry unless `applyRecheck` runs.
import { type SourceRegistry, baseCurrency, noAiSources, sourceInfo } from '@tora/core';
import {
  type Db,
  type RecheckChange,
  type RecheckEnd,
  type RecheckRun,
  type StoredSaleRow,
  RECHECK_BATCH,
  dismissedExclusions,
  finishRecheckRun,
  keptSalesSince,
  loadItemSales,
  nextRecheckBatch,
  openRecheckRun,
  readRecheckRuns,
  readStoredSales,
  recheckItems,
  recheckLinks,
  runningCollectorSources,
  writeRecheckBatch,
  writeValueSeriesBreak,
} from '@tora/db';
import { analysisCopyPath } from '@tora/db/backup';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { defaultLockDir, holdCollectLocks, lockSource, stateDir } from './lock';
import type { SalesRechecker, StoredPeer, StoredSale, StoredVerdict } from './types';

/** A kept row whose `updated_at` is this far after its `created_at` was changed later. */
const TOUCHED_AFTER_MS = 60_000;

/**
 * Why a kept row is never changed, or null. A person's include has no marker of its own
 * (`setObservationExcluded` writes excluded 0, reason null, raw untouched), so two traces count: the
 * rejection still in raw, and a row written after it was inserted (the insert gap is under 2 s;
 * merges leave this trace too and cannot be told apart). A date that cannot be read counts as
 * touched: unknown stays on the safe side.
 */
export function protectedBy(
  row: Pick<StoredSaleRow, 'id' | 'createdAt' | 'updatedAt'>,
  raw: Record<string, unknown> | null,
  dismissed: Set<string>,
): string | null {
  if (raw?.reference) return 'pasted reference';
  if (raw?.filter) return 'person included';
  if (dismissed.has(row.id)) return 'suggestion dismissed';
  const gap = Date.parse(row.updatedAt) - Date.parse(row.createdAt);
  if (!(gap <= TOUCHED_AFTER_MS)) return 'touched later';
  return null;
}

const parseRaw = (text: string | null): Record<string, unknown> | null => {
  if (text === null) return null;
  try {
    const raw = JSON.parse(text);
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
  } catch {
    return null;
  }
};

/** A verdict's family, without what is specific to one title ("bundle (2枚)", `excluded word "x"`). */
export const verdictFamily = (detail: string) => detail.replace(/\s*[("].*$/, '');

export const familyKey = (source: string, family: string) => `${source}|${family}`;

export interface RecheckOptions {
  /** Applies the verdicts held back as low confidence. */
  includeLow?: boolean;
  /** Families left out of this run: their rows stay kept. */
  skipFamilies?: string[];
  /** Also marks sales far from the item's own history. Off by default: rules alone. */
  far?: boolean;
  /** The time of the run: nothing later counts. */
  now: Date;
}

/** What a run would change, and everything it leaves alone, for the owner's table. */
export interface RecheckPlan {
  rulesId: string;
  /** The options it was worked out with, for the limits to record. */
  options: RecheckLimits['options'];
  /** Stored sold rows read. */
  read: number;
  changes: (RecheckChange & { productId: string; family: string })[];
  /** Rows changing, per `source|family`. */
  families: Record<string, number>;
  /** Kept rows protected, per why; `protectedRejected`: those the rules reject. */
  protected: Record<string, number>;
  protectedRejected: Record<string, number>;
  /** Rejections held back as low confidence, per family, and their rows. */
  low: Record<string, number>;
  /** Kept rows that read another condition today and stay as they are. */
  bucketMoves: number;
  /** Stored as a mismatch, passing today: they stay excluded. */
  nowPassing: number;
  /** Rows left out of a family by `skipFamilies`. */
  skippedFamilies: Record<string, number>;
  /** Rows that could not be judged, per why (never a rejection). */
  unread: Record<string, number>;
  /** With `far`: false when the check could not run for a source, as unknown stays unchecked. */
  farChecked: Record<string, boolean>;
  /** For `--dump`, a private file: every verdict, and the rows behind the counts. Never printed. */
  detail: {
    rejected: Record<string, string>;
    low: string[];
    bucketMoves: { id: string; stored: string | null; today: string | null }[];
    nowPassing: string[];
    protectedRows: { id: string; by: string; rejected: string | null }[];
  };
}

const bump = (counts: Record<string, number>, key: string, by = 1) => {
  counts[key] = (counts[key] ?? 0) + by;
};

/** Sources must carry a market and the base currency for a far check, as `ctx.keptSales`. */
function farGate(registry: SourceRegistry, source: string): string | null {
  const info = sourceInfo(registry, source);
  return info?.market && info.currency === baseCurrency(registry) ? info.market : null;
}

const groupBy = <T>(list: T[], keyOf: (t: T) => string) => {
  const out = new Map<string, T[]>();
  for (const item of list) {
    const key = keyOf(item);
    const group = out.get(key);
    if (group) group.push(item);
    else out.set(key, [item]);
  }
  return out;
};

async function planOne(
  db: Db,
  rechecker: SalesRechecker,
  registry: SourceRegistry,
  options: RecheckOptions,
  plan: RecheckPlan,
) {
  const noAi = noAiSources(registry);
  const refused = rechecker.sources.find((s) => noAi.includes(s));
  if (refused) throw new Error(`A noAi source cannot be re-checked: ${refused}.`);
  const skip = new Set(options.skipFamilies ?? []);
  const now = options.now.getTime();

  const dismissed = await dismissedExclusions(db);
  const links = await recheckLinks(db, rechecker.sources);
  const products = await recheckItems(db);

  const rows: StoredSaleRow[] = [];
  for (const source of rechecker.sources) rows.push(...(await readStoredSales(db, source)));
  plan.read += rows.length;
  const parsed = new Map(rows.map((r) => [r.id, parseRaw(r.rawText)]));

  const verdicts = new Map<string, StoredVerdict>();
  for (const group of groupBy(rows, (r) => `${r.source}|${r.productId}`).values()) {
    const { source, productId } = group[0]!;
    const link = links.get(`${source}|${productId}`);
    const product = products.get(productId);
    if (!link || !product) {
      bump(plan.unread, link ? 'no item' : 'no listing', group.length);
      continue;
    }
    const sales: StoredSale[] = group.map((r) => ({
      id: r.id,
      title: r.title,
      raw: parsed.get(r.id) ?? null,
      bucket: r.bucket,
      price: r.priceOriginal ?? r.price,
      observedAt: r.observedAt,
    }));
    const judged = rechecker.assess(source, product, link, sales);
    if (!Array.isArray(judged)) {
      bump(plan.unread, judged.skipped, group.length);
      continue;
    }
    for (const v of judged) verdicts.set(v.id, v);
  }

  // The history is exactly the rows that stay kept after the run: a rejection held back or protected
  // stays in it, a row the run excludes leaves it, and estimated lots never count.
  const leaving = new Set<string>();
  const changeOf = (r: StoredSaleRow, reason: 'mismatch' | 'outlier', filter: string) => {
    const family = verdictFamily(filter);
    if (skip.has(family)) {
      bump(plan.skippedFamilies, familyKey(r.source, family));
      return;
    }
    leaving.add(r.id);
    bump(plan.families, familyKey(r.source, family));
    plan.changes.push({
      id: r.id,
      productId: r.productId,
      source: r.source,
      reason,
      filter,
      family,
      rawText: r.rawText!,
      updatedAt: r.updatedAt,
    });
  };

  const protections = new Map<string, string | null>();
  for (const r of rows) {
    const v = verdicts.get(r.id);
    if (!v) continue;
    if ('skipped' in v) {
      bump(plan.unread, v.skipped);
      continue;
    }
    if (!v.ok && !parsed.get(r.id)?.reference) plan.detail.rejected[r.id] = v.detail;
    if (r.excluded) {
      if (v.ok && r.excludedReason === 'mismatch') {
        plan.nowPassing++;
        plan.detail.nowPassing.push(r.id);
      }
      continue;
    }
    if (r.excludedReason) continue;
    const by = protectedBy(r, parsed.get(r.id) ?? null, dismissed);
    protections.set(r.id, by);
    if (by) {
      bump(plan.protected, by);
      if (!v.ok) bump(plan.protectedRejected, by);
      plan.detail.protectedRows.push({ id: r.id, by, rejected: v.ok ? null : v.detail });
      continue;
    }
    if (v.ok && v.bucket !== r.bucket) {
      plan.bucketMoves++;
      plan.detail.bucketMoves.push({ id: r.id, stored: r.bucket, today: v.bucket });
    }
    if (v.ok) continue;
    if (v.low && !options.includeLow) {
      bump(plan.low, verdictFamily(v.detail));
      plan.detail.low.push(r.id);
      continue;
    }
    if (parsed.get(r.id) === null) {
      // json_set cannot add to it and its old text cannot be guarded: it stays as stored.
      bump(plan.unread, 'broken raw');
      continue;
    }
    changeOf(r, 'mismatch', v.detail);
  }

  // Rules alone unless asked: a wrong row kept can go in a later run, while a real sale excluded is
  // harder to get back.
  if (!options.far) return;

  // The far check, one market at a time, as `ctx.keptSales` reads it. A source without a market or
  // in another currency is left unchecked; the rules above still apply to it.
  const markets = groupBy(
    rechecker.sources.filter((s) => {
      plan.farChecked[s] = farGate(registry, s) !== null;
      return plan.farChecked[s];
    }),
    (s) => farGate(registry, s)!,
  );
  for (const [market, farSources] of markets) {
    const inMarket = rows.filter((r) => sourceInfo(registry, r.source)?.market === market);
    const ids = [...new Set(inMarket.map((r) => r.productId))];
    const packed = await loadItemSales(db, ids);
    const others = (key: string) =>
      sourceInfo(registry, key)?.market === market && !rechecker.sources.includes(key);
    for (const [productId, group] of groupBy(inMarket, (r) => r.productId)) {
      const peersBySource: StoredPeer[][] = farSources.map(() => []);
      const history: { id?: string; bucket: string | null; price: number; at: number }[] =
        keptSalesSince(packed, productId, 0, others);
      for (const r of group) {
        const at = Date.parse(r.observedAt);
        if (Number.isNaN(at) || r.estimated) continue;
        const kept = !r.excluded && !r.excludedReason;
        if (kept && !leaving.has(r.id)) {
          history.push({ id: r.id, bucket: r.bucket, price: r.price, at });
        }
        const v = verdicts.get(r.id);
        // Judged in the stored condition: that is the one it counts in, and on the live path the
        // one judged is the one stored. Today's other reading is no ground to compare it.
        if (!v || 'skipped' in v || !v.ok || !r.bucket || v.bucket !== r.bucket) continue;
        if (r.excludedReason === 'manual') continue;
        const source = farSources.indexOf(r.source);
        if (source < 0) continue;
        peersBySource[source]!.push({
          id: r.id,
          bucket: r.bucket,
          price: r.price,
          at,
          markable:
            kept && !protections.get(r.id) && !leaving.has(r.id) && parsed.get(r.id) !== null,
        });
      }
      if (peersBySource.every((p) => p.length === 0)) continue;
      const far = rechecker.far(peersBySource, history, now);
      for (const r of group) if (far.has(r.id)) changeOf(r, 'outlier', rechecker.farDetail);
    }
  }
}

/** Works out a run: reads only. */
export async function planRecheck(
  db: Db,
  recheckers: SalesRechecker[],
  registry: SourceRegistry,
  options: RecheckOptions,
): Promise<RecheckPlan> {
  const plan: RecheckPlan = {
    rulesId: recheckers.map((r) => r.rulesId()).join('-'),
    options: {
      includeLow: !!options.includeLow,
      skipFamilies: [...(options.skipFamilies ?? [])].toSorted(),
      far: !!options.far,
    },
    read: 0,
    changes: [],
    families: {},
    protected: {},
    protectedRejected: {},
    low: {},
    bucketMoves: 0,
    nowPassing: 0,
    skippedFamilies: {},
    unread: {},
    farChecked: {},
    detail: { rejected: {}, low: [], bucketMoves: [], nowPassing: [], protectedRows: [] },
  };
  for (const rechecker of recheckers) await planOne(db, rechecker, registry, options, plan);
  return plan;
}

/** What a real run may change, written by the rehearsal on a copy of the same data. */
export interface RecheckLimits {
  rulesId: string;
  maxChanges: number;
  minChanges: number;
  /** Most rows per `source|family`. */
  families: Record<string, number>;
  /** What it was rehearsed with: a run with other `--include-low`, `--skip-reason` or `--far` is refused. */
  options: { includeLow: boolean; skipFamilies: string[]; far: boolean };
  /** The copy it was made on. Only the rehearsal's `--final` writes this. */
  copyOf?: string;
}

/** Ceiling count + 2 % (two nights of new rows go through the live path), floor 90 %, family 125 %. */
export function limitsOf(plan: RecheckPlan): RecheckLimits {
  const count = plan.changes.length;
  return {
    rulesId: plan.rulesId,
    maxChanges: Math.ceil(count * 1.02),
    minChanges: Math.max(1, Math.floor(count * 0.9)),
    families: Object.fromEntries(
      Object.entries(plan.families).map(([k, n]) => [k, Math.ceil(n * 1.25)]),
    ),
    options: plan.options,
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * A limits file as read, or why it cannot be used. Checked before use, since a count that is missing
 * or not a number would compare false and let a run through: it must fail closed.
 */
export function checkedLimits(value: unknown): { limits: RecheckLimits } | { invalid: string } {
  if (!isRecord(value)) return { invalid: 'not an object' };
  const { rulesId, maxChanges, minChanges, families, options, copyOf } = value;
  if (typeof rulesId !== 'string' || !rulesId) return { invalid: 'no rules id' };
  if (!Number.isInteger(maxChanges) || !Number.isInteger(minChanges)) {
    return { invalid: 'the counts are not whole numbers' };
  }
  if (!(1 <= (minChanges as number) && (minChanges as number) <= (maxChanges as number))) {
    return { invalid: 'the counts must hold 1 <= least <= most' };
  }
  if (!isRecord(families) || !Object.values(families).every(Number.isInteger)) {
    return { invalid: 'a family limit is not a whole number' };
  }
  if (
    !isRecord(options) ||
    typeof options.includeLow !== 'boolean' ||
    !Array.isArray(options.skipFamilies) ||
    !options.skipFamilies.every((f) => typeof f === 'string') ||
    typeof options.far !== 'boolean'
  ) {
    return { invalid: 'it does not say what options it was rehearsed with' };
  }
  if (copyOf !== undefined && (typeof copyOf !== 'string' || Number.isNaN(Date.parse(copyOf)))) {
    return { invalid: 'its copy date cannot be read' };
  }
  return { limits: value as unknown as RecheckLimits };
}

/**
 * Why a run must not write, before any write. Empty: it may. `written`: rows an interrupted attempt
 * of the same run has written already; they count, or the floor would refuse its continuation.
 */
export function limitsBroken(plan: RecheckPlan, limits: RecheckLimits, written = 0): string[] {
  const out: string[] = [];
  if (plan.rulesId !== limits.rulesId) {
    out.push(
      `Rules differ: these are ${plan.rulesId}, the limits were made for ${limits.rulesId}.`,
    );
  }
  if (JSON.stringify(plan.options) !== JSON.stringify(limits.options)) {
    out.push(`Options differ from what was rehearsed (--include-low, --skip-reason, --far).`);
  }
  const count = plan.changes.length + written;
  if (count > limits.maxChanges) out.push(`Would change ${count}, limit ${limits.maxChanges}.`);
  if (count < limits.minChanges)
    out.push(`Would change ${count}, at least ${limits.minChanges} expected.`);
  for (const [key, n] of Object.entries(plan.families)) {
    const most = limits.families[key];
    if (most === undefined) out.push(`Would change ${n} in ${key}, which was not rehearsed.`);
    else if (n > most) out.push(`Would change ${n} in ${key}, limit ${most}.`);
  }
  return out;
}

const realPath = (path: string) => {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
};

/** A database the command must not write to, by its real file (a link to it counts). */
export function refusedDatabase(url: string, analysis = analysisCopyPath()): string | null {
  const refused = 'This is the analysis copy; it is never written to.';
  if (url.includes('/analysis/')) return refused;
  if (!url.startsWith('file:')) return null;
  return realPath(url.slice('file:'.length)) === realPath(analysis) ? refused : null;
}

/**
 * Limits the rehearsal's `--final` did not stamp pass only on a throwaway database under $TMPDIR, by
 * its real file: anything else may be the real one, and they were not made for it.
 */
export function unstampedLimits(
  limits: RecheckLimits,
  url: string,
  tmp = process.env.TMPDIR,
): string | null {
  if (limits.copyOf) return null;
  const refused = 'This limits file has no copy date: for a real run only --final makes one.';
  if (!url.startsWith('file:') || !tmp || !isAbsolute(tmp)) return refused;
  const inside = relative(realPath(tmp), realPath(url.slice('file:'.length)));
  return inside && !inside.startsWith('..') && !isAbsolute(inside) ? null : refused;
}

/** Older than this, collects have stopped writing here (the state folder's `collect.log`). */
const COLLECT_LOG_DAYS = 3;

/**
 * What writes must hold, or why they must wait: the collect's lock files (its closing steps hold
 * only those), each source's site lock and this command's own. A collector run marked running with
 * its site lock free was interrupted (the PC went off): told, and no reason to wait.
 *
 * Locks mean something only in the folder collects use: under another one a live collect would read
 * as interrupted. So a folder that is not absolute, where no collect ever logged, or where none
 * logged in 3 days is refused. A `pnpm collect` by hand holds site locks only, and none in its closing
 * steps: the owner's step says none may be running.
 */
export async function holdRecheckLocks(
  db: Db,
  sources: string[],
  dirs: { state?: string; locks?: string } = {},
): Promise<{ release: () => void; interrupted: string[] } | { refused: string }> {
  const state = dirs.state ?? stateDir();
  if (!isAbsolute(state)) return { refused: 'The state folder is not an absolute path.' };
  if (!existsSync(join(state, 'collect.log'))) {
    return { refused: 'The state folder holds no collect.log: it is not the one collects use.' };
  }
  const logDays = Math.floor(
    (Date.now() - statSync(join(state, 'collect.log')).mtimeMs) / 86_400_000,
  );
  if (logDays >= COLLECT_LOG_DAYS) {
    return {
      refused:
        `The state folder's collect.log is ${logDays} days old, the limit is ${COLLECT_LOG_DAYS}. ` +
        'The likely reason is a server that has been off. To go on now: run scripts/collect-cron.sh, ' +
        'wait for it to end, then run this again.',
    };
  }
  const locks = dirs.locks ?? defaultLockDir();
  const collect = await holdCollectLocks(state);
  if ('refused' in collect) return collect;
  const held: (() => void)[] = [collect.release];
  const release = () => held.forEach((r) => r());
  for (const source of ['recheck-sales', ...sources]) {
    const lock = lockSource(source, locks);
    if ('heldBy' in lock) {
      release();
      return { refused: `${source} is being collected (process ${lock.heldBy}).` };
    }
    held.push(lock.release);
  }
  const interrupted: string[] = [];
  for (const source of await runningCollectorSources(db)) {
    if (sources.includes(source)) {
      interrupted.push(source);
      continue;
    }
    const lock = lockSource(source, locks);
    if ('heldBy' in lock) {
      release();
      return { refused: `${source} is being collected (process ${lock.heldBy}).` };
    }
    lock.release();
    interrupted.push(source);
  }
  return { release, interrupted };
}

/**
 * Writes the plan in batches, each with its ledger, under the run's id. The caller holds the locks,
 * so a run still `running` was interrupted and this one continues it. `onRun` gets the id before the
 * first batch; `onBatch` is told after each. Null: nothing to do and nothing to finish.
 */
export async function applyRecheck(
  db: Db,
  plan: RecheckPlan,
  now: Date,
  hooks: {
    onRun?: (run: RecheckRun, continued: boolean, left?: string) => void;
    onBatch?: (done: number, batches: number) => void;
  } = {},
): Promise<{ run: RecheckRun; end: RecheckEnd } | null> {
  if (
    plan.changes.length === 0 &&
    !(await readRecheckRuns(db)).some((r) => r.status === 'running')
  ) {
    return null;
  }
  const open = await openRecheckRun(db, plan.rulesId, now);
  hooks.onRun?.(open.run, open.continued, open.left);
  await writeValueSeriesBreak(db, [...new Set(plan.changes.map((c) => c.productId))], now);
  let n = await nextRecheckBatch(db, open.run.id);
  const batches = Math.ceil(plan.changes.length / RECHECK_BATCH);
  for (let i = 0; i < plan.changes.length; i += RECHECK_BATCH) {
    await writeRecheckBatch(db, open.run.id, n++, plan.changes.slice(i, i + RECHECK_BATCH), now);
    hooks.onBatch?.(i / RECHECK_BATCH + 1, batches);
  }
  return { run: open.run, end: await finishRecheckRun(db, open.run, now) };
}
