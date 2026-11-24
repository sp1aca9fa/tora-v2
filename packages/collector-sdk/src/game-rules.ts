// The game rules at collect time (requirements S36 A1; plan section 9 A), behind the admin's "Game
// rules" switch (`gameRules`, off by default):
// - the search a game's plug-in gets carries its console's category and required words
//   (`overlayQuery`), never stored; the excluded words are left to the marks, which are reversible;
// - the sales it saves that fail the rules are stored excluded with a rules mark (`markNewSales`),
//   and left out of the listing's recent sales (`withoutFailing`);
// - the closing step `applyItemRules` judges the stored sales again whenever an item's rules hash
//   changed, marking and restoring, and takes every mark back when the switch is off.
// The plug-in says how to read a sale's title and category (`Collector.saleText`); the rules and the
// flow are here, the writes in `@tora/db` (rule-marks.ts). Cards and sealed items are never read.
import {
  type EffectiveRules,
  effectiveRules,
  failsRules,
  isGameItem,
  noAiSources,
  overlayQuery,
  rulesHash,
  toLocalIso,
} from '@tora/core';
import {
  type Db,
  type RuleChanges,
  type RuleHold,
  type RuleSaleRow,
  RULE_MARK_PREFIX,
  confirmationsMany,
  dismissedExclusions,
  gameRulesOn,
  isHeld,
  listConsoles,
  loadSourceRegistry,
  readRuleSales,
  restoreAllMarks,
  ruleItems,
  ruleStateItems,
  ruleStates,
  writeRuleChanges,
} from '@tora/db';
import { protectedBy } from './recheck';
import type { Collector, PriceInput } from './types';

/** The stored search with a game's rules laid over it (S36 A1, A2): `overlayQuery` in `@tora/core`. */
export { overlayQuery };

/**
 * The hash an item's stored sales were judged under (`item_rule_state.applied_hash`, S36 A1): each
 * judged source (sorted) with `rulesHash(rules, source)`, which covers the words and that source's
 * console category only. So a category edit at a source not judged changes nothing; a source that
 * starts or stops being judged changes it (judged the next night, or its marks taken back).
 */
export function appliedRulesHash(rules: EffectiveRules, sources: Iterable<string>): string {
  return [...sources]
    .toSorted()
    .map((s) => `${s}=${rulesHash(rules, s)}`)
    .join(' ');
}

/** The mark of a sale at `source` failing the item's rules. */
export const ruleMarkOf = (rules: EffectiveRules, source: string) =>
  `${RULE_MARK_PREFIX}${rulesHash(rules, source)}`;

/** Whether a sale fails the item's rules (S36 A1): `failsRules` in `@tora/core`, re-exported. */
export { failsRules };

/**
 * Whether the rules may mark this item's new sales at `source`: its stored sales there were judged
 * under these rules (`hash` = `rulesHash(rules, source)` is in the applied hash) and it is not held.
 */
export function marksNewSales(
  state: { appliedHash: string | null; held: RuleHold | null } | null,
  source: string,
  hash: string,
): boolean {
  if (!state?.appliedHash || isHeld(state.held)) return false;
  return state.appliedHash.split(' ').includes(`${source}=${hash}`);
}

/**
 * Whether a new row fails the item's rules (S36 A1): a sold row the plug-in kept whose title or
 * category fails. A pasted reference (the person vouched for it) and a row the plug-in excluded never
 * do.
 */
export function newSaleFails(
  row: PriceInput,
  rules: EffectiveRules,
  source: string,
  saleText: NonNullable<Collector['saleText']>,
): boolean {
  if (row.observationType !== 'sold' || row.excluded) return false;
  if ((row.raw as { reference?: unknown } | null)?.reference) return false;
  return failsRules(saleText({ title: row.title ?? null, raw: row.raw }), rules, source);
}

/**
 * New sales of a game item (S36 A1): a row failing the rules (`newSaleFails`) is stored excluded,
 * reason `mismatch`, with the mark `rules:<rulesHash(rules, source)>`; its raw is stored as it is.
 */
export function markNewSales(
  rows: PriceInput[],
  rules: EffectiveRules,
  source: string,
  saleText: NonNullable<Collector['saleText']>,
): PriceInput[] {
  const mark = ruleMarkOf(rules, source);
  return rows.map((row) =>
    newSaleFails(row, rules, source, saleText)
      ? { ...row, excluded: true, excludedReason: 'mismatch', ruleMark: mark }
      : row,
  );
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * The state a run with the rules laid over its search stores (S36 A1): the plug-in's new state with
 * the `keys` it names (`Collector.overlayKeeps`) as they were stored, or left out when they were not,
 * so what the narrowed search learned does not outlive the switch. A state that is not an object is
 * stored as the plug-in gave it.
 */
export function keepStoredState(state: unknown, stored: unknown, keys: readonly string[]): unknown {
  if (!keys.length || !isRecord(state)) return state;
  const out = { ...state };
  for (const key of keys) {
    if (isRecord(stored) && key in stored) out[key] = stored[key];
    else delete out[key];
  }
  return out;
}

const saleKey = (s: { bucket?: string | null; price: number; observedAt: string }) =>
  `${s.bucket ?? ''}|${s.price}|${Date.parse(s.observedAt)}`;

/**
 * A listing's recent sales (`CollectResult.recentSales`, shown as its last sale) without the sales
 * that failed the rules (S36 A1): the plug-in builds them from the rows it kept, which carry no
 * reference, so one recent sale is dropped per failing row with the same condition, price and time.
 */
export function withoutFailing<
  T extends { bucket: string | null; price: number; observedAt: string },
>(recent: T[], failing: readonly PriceInput[]): T[] {
  if (!failing.length) return recent;
  const left = new Map<string, number>();
  for (const r of failing) left.set(saleKey(r), (left.get(saleKey(r)) ?? 0) + 1);
  return recent.filter((s) => {
    const n = left.get(saleKey(s)) ?? 0;
    if (n > 0) left.set(saleKey(s), n - 1);
    return n === 0;
  });
}

/** An item's rules stop (S36 A1): more than half of its sales and at least this many. */
export const HOLD_MIN = 10;

const parseRaw = (text: string | null): Record<string, unknown> | null => {
  if (text === null) return null;
  try {
    const raw = JSON.parse(text);
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
  } catch {
    return null;
  }
};

export interface ItemRulesPlan {
  changes: RuleChanges;
  /** Sales the rules would leave excluded (new marks and marks that stay). */
  would: number;
  /** The item's sales at judged sources without the rules: kept ones and ones the rules excluded. */
  kept: number;
  /** Rows a person or a reference protects (never changed). */
  protected: number;
}

/**
 * What the rules do to one game item's stored sales (S36 A1), pure. Judged: kept rows nobody
 * protects (`protectedBy`: a pasted reference, a person's include, a dismissed suggestion, a row
 * changed after its insert) and rows the rules excluded (excluded, `mismatch`, a rules mark), at the
 * judged sources (`saleText`). Never judged: rows excluded for another reason, and a rules-marked row
 * a person included or excluded since. A kept row that fails is marked; a marked row that passes is
 * restored; a marked row that still fails takes its source's new mark. Marks at sources not judged
 * are taken back (`keepMarksAt`). The stop: when the rules would leave more than half of the item's
 * sales excluded and at least `HOLD_MIN`, the item is held and every one of its rules marks is taken
 * back (it is left unfiltered), unless a person released that hold for these rules. `hash`:
 * `appliedRulesHash` over the judged sources.
 */
export function planItemRules(
  productId: string,
  rows: readonly RuleSaleRow[],
  rules: EffectiveRules,
  hash: string,
  saleText: ReadonlyMap<string, NonNullable<Collector['saleText']>>,
  dismissed: Set<string>,
  previous: RuleHold | null,
  now: Date,
): ItemRulesPlan {
  const changes: RuleChanges = {
    productId,
    mark: [],
    restore: [],
    remark: [],
    hash,
    held: null,
    keepMarksAt: [...saleText.keys()].toSorted(),
  };
  let kept = 0;
  let would = 0;
  let guarded = 0;
  for (const row of rows) {
    const text = saleText.get(row.source);
    if (!text) continue;
    const marked = !!row.ruleMark?.startsWith(RULE_MARK_PREFIX);
    const ruled = marked && row.excluded && row.excludedReason === 'mismatch';
    if (row.excluded && !ruled) continue;
    kept++;
    const raw = parseRaw(row.rawText);
    // A marked row kept again by a person, or a kept row someone vouched for: their word stands.
    if (!ruled && (marked || protectedBy(row, raw, dismissed))) {
      guarded++;
      continue;
    }
    const fails = failsRules(text({ title: row.title, raw }), rules, row.source);
    const mark = ruleMarkOf(rules, row.source);
    if (fails) would++;
    if (fails && !ruled) changes.mark.push({ id: row.id, updatedAt: row.updatedAt, mark });
    else if (!fails && ruled) changes.restore.push({ id: row.id, ruleMark: row.ruleMark! });
    else if (fails && ruled && row.ruleMark !== mark)
      changes.remark.push({ id: row.id, ruleMark: row.ruleMark!, mark });
  }
  const released = !!previous?.releasedAt && previous.hash === hash;
  if (would > kept / 2 && would >= HOLD_MIN) {
    if (released) changes.held = previous;
    else {
      // Held: left unfiltered, so every mark of the item goes, earlier rules' ones too.
      changes.mark = [];
      changes.restore = [];
      changes.remark = [];
      changes.keepMarksAt = [];
      changes.held = { would, kept, at: toLocalIso(now), hash };
    }
  }
  return { changes, would, kept, protected: guarded };
}

export interface ApplySummary {
  on: boolean;
  /** Game items whose rules changed and were judged. */
  judged: number;
  marked: number;
  restored: number;
  /** Held items (rules not applied), with their counts. */
  held: { productId: string; would: number; kept: number }[];
  /** Items whose stored sales changed. */
  changed: string[];
}

/** The sources whose sales the rules judge: a plug-in with `saleText`, never a noAi source. */
export async function judgedSources(
  db: Db,
  collectors: readonly Collector[],
): Promise<Map<string, NonNullable<Collector['saleText']>>> {
  const noAi = new Set(noAiSources(await loadSourceRegistry(db)));
  const out = new Map<string, NonNullable<Collector['saleText']>>();
  for (const c of collectors)
    if (c.saleText && !noAi.has(c.source)) out.set(c.source, c.saleText.bind(c));
  return out;
}

/**
 * The collect's closing step for the game rules (S36 A1), before the packed sales are rebuilt. Off:
 * every rules mark is taken back and the rule states removed. On: each game item whose applied hash
 * (`appliedRulesHash` over the judged sources) is not the one stored has its stored sales at the
 * judged sources judged again (`planItemRules`) and its marks elsewhere taken back by SQL, then the
 * hash is stored; an item no longer a game has its marks taken back. An item whose hash is the one
 * applied is not read (a run with no change writes nothing).
 */
export async function applyItemRules(
  db: Db,
  collectors: readonly Collector[],
  options: { now?: Date; log?: (m: string) => void } = {},
): Promise<ApplySummary> {
  const now = options.now ?? new Date();
  const log = options.log ?? (() => {});
  const summary: ApplySummary = {
    on: await gameRulesOn(db),
    judged: 0,
    marked: 0,
    restored: 0,
    held: [],
    changed: [],
  };
  if (!summary.on) {
    const stated = await ruleStateItems(db);
    if (!stated.length) return summary;
    const { restored, items } = await restoreAllMarks(db, stated);
    summary.restored = restored;
    summary.changed = items;
    log(`game rules: off, ${restored} sale(s) of ${stated.length} item(s) kept again`);
    return summary;
  }
  const states = await ruleStates(db);
  const items = await ruleItems(db);
  const own = await confirmationsMany(db, items);
  const consoles = await listConsoles(db);
  const sources = await judgedSources(db, collectors);
  const notGames: string[] = [];
  const todo: { id: string; rules: EffectiveRules; hash: string }[] = [];
  for (const item of items) {
    const row = own.get(item.id)?.rules ?? null;
    if (!isGameItem(item, row)) {
      if (states.has(item.id)) notGames.push(item.id);
      continue;
    }
    const rules = effectiveRules(item, row, consoles);
    const hash = appliedRulesHash(rules, sources.keys());
    if (states.get(item.id)?.appliedHash !== hash) todo.push({ id: item.id, rules, hash });
  }
  if (notGames.length) {
    const { restored, items: changed } = await restoreAllMarks(db, notGames);
    summary.restored += restored;
    summary.changed.push(...changed);
  }
  if (!todo.length) return summary;
  const dismissed = await dismissedExclusions(db);
  const rows = await readRuleSales(
    db,
    todo.map((t) => t.id),
    [...sources.keys()],
  );
  const byItem = new Map<string, RuleSaleRow[]>();
  for (const r of rows) {
    const list = byItem.get(r.productId);
    if (list) list.push(r);
    else byItem.set(r.productId, [r]);
  }
  for (const t of todo) {
    const plan = planItemRules(
      t.id,
      byItem.get(t.id) ?? [],
      t.rules,
      t.hash,
      sources,
      dismissed,
      states.get(t.id)?.held ?? null,
      now,
    );
    const { marked, restored } = await writeRuleChanges(db, plan.changes, now);
    summary.judged++;
    summary.marked += marked;
    summary.restored += restored;
    if (marked + restored > 0) summary.changed.push(t.id);
    if (isHeld(plan.changes.held))
      summary.held.push({ productId: t.id, would: plan.would, kept: plan.kept });
  }
  log(
    `game rules: ${summary.judged} item(s) judged, ${summary.marked} sale(s) marked, ${summary.restored} restored, ${summary.held.length} held`,
  );
  return summary;
}
