// The game rules' marks on stored sales (requirements S36 A1; plan section 9 A): the admin switch, the
// hash each game item's sales were last judged under (`item_rule_state`), and the writes that mark a
// sale failing the item's rules (`rule_mark = 'rules:<hash>'`, excluded, reason `mismatch`) or restore
// it. The judging itself is in the collector SDK (it needs the plug-ins' `saleText`); this file only
// reads and writes.
//
// A mark never touches `updated_at`: the S30 re-check reads a kept row written after its insert as
// changed by a person ("touched later", `protectedBy`), and a mark is not a person's change, so a row
// the rules restore stays judgeable by both. Every write is compare-and-set on what was read, so a
// person's change made meanwhile wins.
import { type EffectiveRules, effectiveRules, isGameItem, rulesHash, toLocalIso } from '@tora/core';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { Db } from './client';
import { listConsoles } from './consoles';
import { confirmationsMany } from './item-rules';
import { readSetting, saveSetting } from './registry';
import { refreshItemSales } from './item-sales';
import {
  type NewPriceObservation,
  itemRuleState,
  notItemMarks,
  priceObservations,
  products,
} from './schema';
import { insertObservations } from './sources';
import { clearBucketValues } from './valuation';

/** The install-wide switch (app setting): `on` or `off`; off when unset (S36 A1, plan 9 A "Gate"). */
export const GAME_RULES_KEY = 'gameRules';

/** Whether the game rules are on for the install (anything but `on` is off). */
export async function gameRulesOn(db: Pick<Db, 'select'>): Promise<boolean> {
  return (await readSetting<string>(db, GAME_RULES_KEY)) === 'on';
}

/** Turns the game rules on or off (admins; the caller checks). Takes effect at the next collect. */
export async function setGameRules(db: Pick<Db, 'insert'>, on: boolean): Promise<void> {
  await saveSetting(db, GAME_RULES_KEY, on ? 'on' : 'off');
}

/** The prefix of a game rules mark; the rest is the rules hash it was made under. */
export const RULE_MARK_PREFIX = 'rules:';

/**
 * Why an item's rules were not applied (S36 A1 per-item stop): they would mark `would` of its `kept`
 * sales (more than half and at least 10). `hash`: the rules held. A release (`releaseHeld`) keeps the
 * record and adds who released it; it holds only for that hash.
 */
export interface RuleHold {
  would: number;
  kept: number;
  at: string;
  hash: string;
  releasedBy?: string | null;
  releasedAt?: string;
}

export interface RuleState {
  appliedHash: string | null;
  held: RuleHold | null;
}

/** Whether a hold stands (not released). */
export const isHeld = (held: RuleHold | null | undefined): boolean => !!held && !held.releasedAt;

const asHold = (value: unknown): RuleHold | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as RuleHold) : null;

/** Every item's rule state (a few rows: games the rules were applied to). */
export async function ruleStates(db: Pick<Db, 'select'>): Promise<Map<string, RuleState>> {
  const rows = await db.select().from(itemRuleState);
  return new Map(
    rows.map((r) => [r.productId, { appliedHash: r.appliedHash, held: asHold(r.held) }]),
  );
}

/** How many items are held (their rules not applied until a person or an admin releases them). */
export async function heldItemCount(db: Pick<Db, 'select'>): Promise<number> {
  const rows = await db
    .select({ held: itemRuleState.held })
    .from(itemRuleState)
    .where(isNotNull(itemRuleState.held));
  return rows.filter((r) => isHeld(asHold(r.held))).length;
}

/**
 * Releases a held item (S36 A1: a person's confirmation at the registration check, or an admin): its
 * rules are applied at the next collect's closing step though they mark more than half of its sales.
 * The caller checks who may. False when the item is not held.
 */
export async function releaseHeld(
  db: Db,
  productId: string,
  userId: string | null,
  now = new Date(),
): Promise<boolean> {
  const [row] = await db.select().from(itemRuleState).where(eq(itemRuleState.productId, productId));
  const held = asHold(row?.held);
  if (!row || !held || !isHeld(held)) return false;
  await db
    .update(itemRuleState)
    // The applied hash is cleared so the closing step judges the item again.
    .set({
      held: { ...held, releasedBy: userId, releasedAt: toLocalIso(now) },
      appliedHash: null,
    })
    .where(eq(itemRuleState.productId, productId));
  return true;
}

/** The fields of an item the rules read. */
export interface RuleItem {
  id: string;
  category: string;
  kind: string;
  platform: string | null;
  region: string | null;
}

/** What a collect gives a plug-in about a game item (`CollectorContext.itemRules`). */
export interface ItemRuleInput {
  rules: EffectiveRules;
  /**
   * `rulesHash(rules, source)`: this source's rules (its console category, the words), the hash its
   * sales here are marked under (`rules:<hash>`).
   */
  hash: string;
  /** Whether this source's listings are confirmed for the item (S36 Terms "Confirmed"). */
  listingsConfirmed: boolean;
  /** Listing refs at this source a person marked "not the item". */
  notItemRefs: ReadonlySet<string>;
  /** The item's rule state: new sales are marked only once the stored ones were judged under `hash`. */
  state: RuleState | null;
}

/** How many item ids go in one `IN (...)` list. */
const IDS_PER_READ = 500;

const chunks = <T>(list: readonly T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

/**
 * The rules of the game items among `items` for one source (S19: a few batched reads per run, never
 * one per link). Items that are not games (`isGameItem`, with their own rules row's switch) are left
 * out.
 */
export async function gameRuleInputs(
  db: Pick<Db, 'select'>,
  items: readonly RuleItem[],
  source: string,
): Promise<Map<string, ItemRuleInput>> {
  const out = new Map<string, ItemRuleInput>();
  if (!items.length) return out;
  const many = await confirmationsMany(db, items);
  const games = items.filter((p) => isGameItem(p, many.get(p.id)?.rules ?? null));
  if (!games.length) return out;
  const consoles = await listConsoles(db);
  const ids = games.map((g) => g.id);
  const states = new Map<string, RuleState>();
  const marks = new Map<string, Set<string>>();
  for (const part of chunks(ids, IDS_PER_READ)) {
    const [stateRows, markRows] = await Promise.all([
      db.select().from(itemRuleState).where(inArray(itemRuleState.productId, part)),
      db
        .select({ productId: notItemMarks.productId, ref: notItemMarks.externalRef })
        .from(notItemMarks)
        .where(and(inArray(notItemMarks.productId, part), eq(notItemMarks.source, source))),
    ]);
    for (const r of stateRows)
      states.set(r.productId, { appliedHash: r.appliedHash, held: asHold(r.held) });
    for (const r of markRows)
      marks.set(r.productId, (marks.get(r.productId) ?? new Set()).add(r.ref));
  }
  for (const g of games) {
    const own = many.get(g.id);
    const rules = effectiveRules(g, own?.rules ?? null, consoles);
    out.set(g.id, {
      rules,
      hash: rulesHash(rules, source),
      listingsConfirmed: own?.confirmations.isConfirmed('listings', source) ?? false,
      notItemRefs: marks.get(g.id) ?? new Set(),
      state: states.get(g.id) ?? null,
    });
  }
  return out;
}

/** Items the closing step looks at: every game-category item and every item with a rule state. */
export async function ruleItems(db: Pick<Db, 'select'>): Promise<RuleItem[]> {
  const cols = {
    id: products.id,
    category: products.category,
    kind: products.kind,
    platform: products.platform,
    region: products.region,
  };
  const games = await db.select(cols).from(products).where(eq(products.category, 'game'));
  const have = new Set(games.map((g) => g.id));
  const stated = (await db.select({ id: itemRuleState.productId }).from(itemRuleState))
    .map((r) => r.id)
    .filter((id) => !have.has(id));
  const others = [];
  for (const part of chunks(stated, IDS_PER_READ))
    others.push(...(await db.select(cols).from(products).where(inArray(products.id, part))));
  return [...games, ...others];
}

/** A stored sold row as the rules judge it. */
export interface RuleSaleRow {
  id: string;
  productId: string;
  source: string;
  title: string | null;
  rawText: string | null;
  excluded: boolean;
  excludedReason: string | null;
  ruleMark: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The stored sold rows of these items at these sources, through the item index. */
export async function readRuleSales(
  db: Db,
  productIds: readonly string[],
  sources: readonly string[],
): Promise<RuleSaleRow[]> {
  const out: RuleSaleRow[] = [];
  if (!sources.length) return out;
  for (const part of chunks(productIds, IDS_PER_READ - sources.length)) {
    const { rows } = await db.$client.execute({
      sql: `select id, product_id, source, title, raw, excluded, excluded_reason, rule_mark,
              created_at, updated_at
            from price_observations
            where product_id in (${part.map(() => '?').join(', ')})
              and source in (${sources.map(() => '?').join(', ')})
              and observation_type = 'sold'`,
      args: [...part, ...sources],
    });
    for (const r of rows)
      out.push({
        id: r.id as string,
        productId: r.product_id as string,
        source: r.source as string,
        title: r.title as string | null,
        rawText: r.raw as string | null,
        excluded: !!r.excluded,
        excludedReason: r.excluded_reason as string | null,
        ruleMark: r.rule_mark as string | null,
        createdAt: r.created_at as string,
        updatedAt: r.updated_at as string,
      });
  }
  return out;
}

/** One item's changes, as judged from the rows read (each write checks the row is still as read). */
export interface RuleChanges {
  productId: string;
  /** Kept rows to mark: `updatedAt` as read, and the mark (`rules:<the source's hash>`). */
  mark: { id: string; updatedAt: string; mark: string }[];
  /** Rows marked by the rules (excluded, `mismatch`) that now pass: `ruleMark` as read. */
  restore: { id: string; ruleMark: string }[];
  /** Rows marked by the rules that still fail: their mark (as read) moves to the new one. */
  remark: { id: string; ruleMark: string; mark: string }[];
  /** The rules applied (`appliedRulesHash` in the collector SDK). */
  hash: string;
  held: RuleHold | null;
  /**
   * The sources whose rows this plan judged: every rules mark of the item at any other source (no
   * longer judged, or every source while the item is held) is taken back by SQL, its rows never read.
   */
  keepMarksAt: readonly string[];
}

/**
 * The statements taking back an item's rules marks at every source but `except` (S36 A1): a row the
 * rules excluded is kept again; a row a person changed since (included, or excluded by hand) keeps
 * the person's choice and only loses the mark. The first statement's count is the rows kept again.
 */
function restoreMarkStatements(productId: string, except: readonly string[]) {
  const others = except.length ? ` and source not in (${except.map(() => '?').join(', ')})` : '';
  const args = [productId, `${RULE_MARK_PREFIX}%`, ...except];
  return [
    {
      sql: `update price_observations set excluded = 0, excluded_reason = null, rule_mark = null
            where product_id = ? and rule_mark like ?${others} and excluded = 1
              and excluded_reason = 'mismatch'`,
      args,
    },
    {
      sql: `update price_observations set rule_mark = null
            where product_id = ? and rule_mark like ?${others}`,
      args,
    },
  ];
}

/**
 * Writes one item's changes and its rule state in one batch (a crash never leaves the hash stored
 * without its marks). Returns how many rows changed; the items whose rows changed have their values
 * cleared (the packed sales follow through the `price_days_dirty` triggers), as a person's exclusion
 * does.
 */
export async function writeRuleChanges(
  db: Db,
  changes: RuleChanges,
  now = new Date(),
): Promise<{ marked: number; restored: number }> {
  const at = toLocalIso(now);
  const others = restoreMarkStatements(changes.productId, changes.keepMarksAt);
  const statements = [
    ...changes.mark.map((m) => ({
      sql: `update price_observations set excluded = 1, excluded_reason = 'mismatch', rule_mark = ?
            where id = ? and excluded = 0 and rule_mark is null and updated_at = ?`,
      args: [m.mark, m.id, m.updatedAt],
    })),
    ...changes.restore.map((m) => ({
      sql: `update price_observations set excluded = 0, excluded_reason = null, rule_mark = null
            where id = ? and excluded = 1 and excluded_reason = 'mismatch' and rule_mark = ?`,
      args: [m.id, m.ruleMark],
    })),
    ...others,
    ...changes.remark.map((m) => ({
      sql: `update price_observations set rule_mark = ?
            where id = ? and excluded = 1 and excluded_reason = 'mismatch' and rule_mark = ?`,
      args: [m.mark, m.id, m.ruleMark],
    })),
    {
      sql: `insert into item_rule_state (product_id, applied_hash, applied_at, held)
            values (?, ?, ?, ?)
            on conflict (product_id) do update set applied_hash = excluded.applied_hash,
              applied_at = excluded.applied_at, held = excluded.held`,
      args: [
        changes.productId,
        changes.hash,
        at,
        changes.held ? JSON.stringify(changes.held) : null,
      ],
    },
  ];
  const results = await db.$client.batch(statements, 'write');
  const count = (from: number, n: number) =>
    results.slice(from, from + n).reduce((sum, r) => sum + r.rowsAffected, 0);
  const marked = count(0, changes.mark.length);
  const restored =
    count(changes.mark.length, changes.restore.length) +
    count(changes.mark.length + changes.restore.length, 1);
  if (marked + restored > 0) await clearBucketValues(db, [changes.productId]);
  return { marked, restored };
}

/**
 * The switch is off (S36 A1): every rules mark of these items is taken back and their rule state
 * removed. A row the rules excluded is kept again; a row a person changed since (included, or
 * excluded by hand) keeps the person's choice and only loses the mark. Returns the rows kept again.
 */
export async function restoreAllMarks(
  db: Db,
  productIds: readonly string[],
): Promise<{ restored: number; items: string[] }> {
  let restored = 0;
  const items: string[] = [];
  for (const id of productIds) {
    const results = await db.$client.batch(
      [
        ...restoreMarkStatements(id, []),
        { sql: 'delete from item_rule_state where product_id = ?', args: [id] },
      ],
      'write',
    );
    const n = results[0]!.rowsAffected;
    if (n > 0) {
      restored += n;
      items.push(id);
    }
  }
  if (items.length) await clearBucketValues(db, items);
  return { restored, items };
}

/**
 * Stores a collect's new rows (`insertObservations`); rows carrying a rules mark go in one write with
 * their item's rule state row (kept as it is when there is one), so the switch's off step, which
 * reads the items with a state, always finds every mark (S36 A1), even when the switch went off
 * while this collect ran. Rows without a mark (every card and sealed row) take the usual path only.
 */
export async function insertObservationsWithRuleState(
  db: Db,
  rows: NewPriceObservation[],
): Promise<number> {
  const marked = rows.filter((r) => r.ruleMark?.startsWith(RULE_MARK_PREFIX));
  if (!marked.length) return insertObservations(db, rows);
  const plain = rows.filter((r) => !marked.includes(r));
  let added = plain.length ? await insertObservations(db, plain) : 0;
  const ids = [...new Set(marked.map((r) => r.productId))];
  const [first, ...inserts] = [
    db
      .insert(itemRuleState)
      .values(ids.map((productId) => ({ productId, appliedHash: null })))
      .onConflictDoNothing(),
    ...chunks(marked, 100).map((part) =>
      db
        .insert(priceObservations)
        .values(part)
        .onConflictDoNothing({ target: [priceObservations.source, priceObservations.externalRef] })
        .returning({ id: priceObservations.id }),
    ),
  ];
  // The marks were decided from the rule state read when the run began. When another run's closing
  // step has since judged the item under other rules, or held it, these rows would keep a mark no
  // rule asks for and nothing would look again (applied hash = today's): the item is sent back to
  // the closing step, which judges it fully (and restores every mark of a held item).
  const stale = [
    ...new Map(
      marked.map((r) => [
        `${r.productId} ${r.source}=${r.ruleMark!.slice(RULE_MARK_PREFIX.length)}`,
        r.productId,
      ]),
    ),
  ].map(([key, productId]) =>
    db
      .update(itemRuleState)
      .set({ appliedHash: null })
      .where(
        and(
          eq(itemRuleState.productId, productId),
          sql`(instr(' ' || coalesce(${itemRuleState.appliedHash}, '') || ' ', ${` ${key.slice(productId.length + 1)} `}) = 0
            or (${itemRuleState.held} is not null and json_extract(${itemRuleState.held}, '$.releasedAt') is null))`,
        ),
      ),
  );
  const results = await db.batch([first!, ...inserts, ...stale]);
  const n = results
    .slice(1, 1 + inserts.length)
    .reduce((sum, r) => sum + (r as unknown[]).length, 0);
  added += n;
  if (n > 0) {
    await clearBucketValues(db, ids);
    await refreshItemSales(db, { marksOnly: true });
  }
  return added;
}

/**
 * Of these sales of a source (by reference), the ones stored excluded: a run reads it after saving,
 * for the rows of a game that fail its rules, so a sale a person kept is never taken for a dropped
 * one (S36 A1). One read; an empty list reads nothing.
 */
export async function excludedSaleRefs(
  db: Pick<Db, 'select'>,
  source: string,
  refs: readonly string[],
): Promise<Set<string>> {
  const out = new Set<string>();
  for (const part of chunks([...new Set(refs)], 200)) {
    const rows = await db
      .select({ ref: priceObservations.externalRef })
      .from(priceObservations)
      .where(
        and(
          eq(priceObservations.source, source),
          inArray(priceObservations.externalRef, part),
          eq(priceObservations.excluded, true),
        ),
      );
    for (const r of rows) if (r.ref) out.add(r.ref);
  }
  return out;
}

/** The items with a rule state (the only ones that can carry marks). */
export async function ruleStateItems(db: Pick<Db, 'select'>): Promise<string[]> {
  return (await db.select({ id: itemRuleState.productId }).from(itemRuleState)).map((r) => r.id);
}

/** Rows with a rules mark, per item, over the whole table (checks and the rehearsal; not nightly). */
export async function ruleMarkCounts(db: Db): Promise<Map<string, number>> {
  const { rows } = await db.$client.execute({
    sql: `select product_id, count(*) as n from price_observations where rule_mark like ?
          group by product_id`,
    args: [`${RULE_MARK_PREFIX}%`],
  });
  return new Map(rows.map((r) => [r.product_id as string, Number(r.n)]));
}
