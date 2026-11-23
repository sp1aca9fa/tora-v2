// An item's rules and its checks (requirements S36 Terms "The item's rules" and "Confirmed"; plan
// section 9 B). Rules are shared by everyone; checks are append-only, and a confirmation holds only
// while the rules hash it was made under is today's: changing a word or the console's category takes
// it away without deleting a row.
import {
  type EffectiveRules,
  type ItemCheckBy,
  type ItemCheckKind,
  type ItemCheckOutcome,
  type ItemRulesRow,
  ITEM_CHECK_BY,
  ITEM_CHECK_KINDS,
  ITEM_CHECK_OUTCOMES,
  ITEM_CHECK_OUTCOMES_BY,
  checkHash,
  consoleKey,
  effectiveRules,
  toLocalIso,
} from '@tora/core';
import { and, asc, eq, isNotNull, lte, sql } from 'drizzle-orm';
import type { Db } from './client';
import { listConsoles } from './consoles';
import { DomainError } from './mutations';
import { type ItemCheck, itemChecks, itemRules, products, users } from './schema';

/** An item's own rules as stored, or null when it has no row (its platform's console, no words). */
export async function getItemRules(
  db: Pick<Db, 'select'>,
  productId: string,
): Promise<ItemRulesRow | null> {
  const [row] = await db.select().from(itemRules).where(eq(itemRules.productId, productId));
  if (!row) return null;
  return {
    console: row.console,
    edition: row.edition,
    required: row.required ?? [],
    excluded: row.excluded ?? [],
    boxed: row.boxed,
    boxedOf: row.boxedOf,
    gameRules: row.gameRules === 0 || row.gameRules === 1 ? row.gameRules : null,
  };
}

/**
 * The items whose rules row turns the game rules on (1) or off (0) (S36 Scope rule), by item id; an
 * item not in it goes by its kind. One read for a whole run (S19).
 */
export async function gameRulesSwitches(db: Pick<Db, 'select'>): Promise<Map<string, 0 | 1>> {
  const rows = await db
    .select({ productId: itemRules.productId, gameRules: itemRules.gameRules })
    .from(itemRules)
    .where(isNotNull(itemRules.gameRules));
  const out = new Map<string, 0 | 1>();
  for (const r of rows)
    if (r.gameRules === 0 || r.gameRules === 1) out.set(r.productId, r.gameRules);
  return out;
}

const WORD_MAX = 60;
const WORDS_MAX = 30;

/** Words as stored: trimmed, no empty ones or repeats (their order is the person's). */
function cleanWords(words: readonly string[] | undefined): string[] {
  const list = [
    ...new Set(
      (Array.isArray(words) ? words : []).map((w) => (typeof w === 'string' ? w.trim() : '')),
    ),
  ].filter(Boolean);
  if (list.length > WORDS_MAX || list.some((w) => w.length > WORD_MAX)) {
    throw new DomainError('invalid_input');
  }
  return list;
}

/**
 * Saves an item's rules (written by later steps: the registration check, an admin). The console is
 * stored as its key; a boxed item names its plain item, which must exist and not be itself.
 */
export async function saveItemRules(
  db: Db,
  productId: string,
  rules: ItemRulesRow,
  userId: string | null,
): Promise<void> {
  const [product] = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.id, productId));
  if (!product) throw new DomainError('not_found');
  if (rules.boxedOf !== null) {
    if (rules.boxedOf === productId) throw new DomainError('invalid_input');
    const [plain] = await db
      .select({ id: products.id })
      .from(products)
      .where(eq(products.id, rules.boxedOf));
    if (!plain) throw new DomainError('not_found');
  }
  if (rules.gameRules !== null && rules.gameRules !== 0 && rules.gameRules !== 1) {
    throw new DomainError('invalid_input');
  }
  const at = toLocalIso();
  const values = {
    console: rules.console ? consoleKey(rules.console) : null,
    edition: rules.edition?.trim() || null,
    required: cleanWords(rules.required),
    excluded: cleanWords(rules.excluded),
    boxed: !!rules.boxed,
    boxedOf: rules.boxedOf,
    gameRules: rules.gameRules,
    updatedBy: userId,
  };
  await db
    .insert(itemRules)
    .values({ productId, ...values, createdAt: at, updatedAt: at })
    .onConflictDoUpdate({ target: itemRules.productId, set: { ...values, updatedAt: at } });
}

/**
 * An item's effective rules today (its row, else its platform's console; its region), with the hash a
 * check of `kind` at `source` is made under (`checkHash`: listings per source, sales overall).
 */
export async function currentRules(
  db: Pick<Db, 'select'>,
  productId: string,
): Promise<{ rules: EffectiveRules; hashFor(kind: ItemCheckKind, source: string): string } | null> {
  const [product] = await db
    .select({ platform: products.platform, region: products.region })
    .from(products)
    .where(eq(products.id, productId));
  if (!product) return null;
  const rules = effectiveRules(product, await getItemRules(db, productId), await listConsoles(db));
  return { rules, hashFor: (kind, source) => checkHash(rules, kind, source) };
}

/** One (kind, source) of an item's checks: '' is the source of sales. Rows of one time keep their
 * insert order (`rowid`). */
const keyOf = (kind: string, source: string) => `${kind}|${source}`;

/** Whether a check's maker may write its outcome (`ITEM_CHECK_OUTCOMES_BY`). */
export function allowedCheck(by: string, outcome: string): boolean {
  return (
    ITEM_CHECK_BY.includes(by as ItemCheckBy) &&
    ITEM_CHECK_OUTCOMES_BY[by as ItemCheckBy].includes(outcome as ItemCheckOutcome)
  );
}

/**
 * Whether a failed labeled check stands over the checks of one (item, kind, source), oldest first,
 * under `hash` (S36 Terms "Confirmed": after a labeled check failed, only an admin confirms). Only
 * rows made under `hash` count, since rules that changed are rules nobody failed: walking back from
 * the newest, a check's `failed` stands; a `passed` or an admin's `confirmed` clears it. A person's
 * rows (their own "not my item" included) and a check that did not judge leave it as it was. Read
 * (`confirmedBy`) and write (`recordItemCheck`) both use it, so a person's confirmation is refused
 * exactly when it would not count.
 */
export function failureStands(
  rows: readonly Pick<ItemCheck, 'outcome' | 'by' | 'rulesHash'>[],
  hash: string,
): boolean {
  for (let i = rows.length - 1; i >= 0; i--) {
    const { outcome, by, rulesHash } = rows[i]!;
    if (rulesHash !== hash) continue;
    if (outcome === 'failed' && by === 'check') return true;
    if (outcome === 'passed' || (outcome === 'confirmed' && by === 'admin')) return false;
  }
  return false;
}

/**
 * Whether the checks of one (item, kind, source), oldest first, confirm it under `hash` (S36 Terms
 * "Confirmed"): among the rows made under today's hash for that kind and source, leaving out a check
 * that did not judge (too few sales says nothing, so it never undoes a confirmation), the latest is
 * the check's `passed` or a `confirmed`. A person's `confirmed` counts only when no failed check
 * stands before it; an admin's always does. A row whose maker may not write its outcome is ignored.
 */
export function confirmedBy(rows: readonly ItemCheck[], hash: string): boolean {
  const mine = rows.filter(
    (r) => r.rulesHash === hash && allowedCheck(r.by, r.outcome) && r.outcome !== 'not_judged',
  );
  const latest = mine.at(-1);
  if (!latest) return false;
  if (latest.outcome === 'passed') return true;
  if (latest.outcome !== 'confirmed') return false;
  if (latest.by === 'admin') return true;
  return !failureStands(mine.slice(0, -1), hash);
}

export interface Confirmations {
  /** Today's hash a check of `kind` at `source` is made under (listings per source, sales overall). */
  hashFor(kind: ItemCheckKind, source: string): string;
  /** Every check of the item, oldest first, by `kind|source`. */
  checks: Map<string, ItemCheck[]>;
  /** Sales: `isConfirmed('sales', '')`; listings at a source: `isConfirmed('listings', source)`. */
  isConfirmed(kind: ItemCheckKind, source: string): boolean;
}

/** An item's checks and what they confirm under today's rules (null when the item does not exist). */
export async function confirmations(
  db: Pick<Db, 'select'>,
  productId: string,
): Promise<Confirmations | null> {
  const current = await currentRules(db, productId);
  if (!current) return null;
  const checks = new Map<string, ItemCheck[]>();
  for (const row of await db
    .select()
    .from(itemChecks)
    .where(eq(itemChecks.productId, productId))
    .orderBy(asc(itemChecks.at), asc(sql`rowid`))) {
    const key = keyOf(row.kind, row.source);
    checks.set(key, [...(checks.get(key) ?? []), row]);
  }
  return {
    hashFor: current.hashFor,
    checks,
    // Sales never confirm listings: each (kind, source) stands alone, under its own hash.
    isConfirmed: (kind, source) => {
      const s = kind === 'sales' ? '' : source;
      return confirmedBy(checks.get(keyOf(kind, s)) ?? [], current.hashFor(kind, s));
    },
  };
}

export interface ItemCheckInput {
  productId: string;
  kind: ItemCheckKind;
  /** '' for sales. */
  source: string;
  outcome: ItemCheckOutcome;
  by: ItemCheckBy;
  /** The hash the check judged (`hashFor(kind, source)`); one made under other rules is refused. */
  rulesHash: string;
  counts?: Record<string, unknown> | null;
  userId?: string | null;
  note?: string | null;
  at?: string;
}

/**
 * Appends a check (S36 A1, A2, B1). Refused (DomainError) when: the input is not valid (the kind, the
 * outcome and its maker are checked here, not by the database: `allowedCheck`); the hash is not the
 * item's today for that kind and source (the rules changed since it was read); `by: 'admin'` without
 * an admin; or a person confirms while a failure stands (S36 Terms "Confirmed": then only an admin
 * can; `failureStands` over the rows up to its time, as `confirmedBy` reads them).
 */
export async function recordItemCheck(db: Db, input: ItemCheckInput): Promise<ItemCheck> {
  if (
    !ITEM_CHECK_KINDS.includes(input.kind) ||
    !ITEM_CHECK_OUTCOMES.includes(input.outcome) ||
    !allowedCheck(input.by, input.outcome) ||
    (input.kind === 'sales' ? input.source !== '' : !input.source)
  ) {
    throw new DomainError('invalid_input');
  }
  const at = input.at ?? toLocalIso();
  if (input.by !== 'check' && !input.userId) throw new DomainError('invalid_input');
  if (input.by === 'admin') {
    const [user] = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, input.userId!));
    if (user?.role !== 'admin') throw new DomainError('forbidden');
  }
  const current = await currentRules(db, input.productId);
  if (!current) throw new DomainError('not_found');
  if (current.hashFor(input.kind, input.source) !== input.rulesHash) {
    throw new DomainError('invalid_input');
  }
  if (input.by === 'person' && input.outcome === 'confirmed') {
    // The rows it would follow, in the order `confirmations` reads them.
    const before = await db
      .select({ outcome: itemChecks.outcome, by: itemChecks.by, rulesHash: itemChecks.rulesHash })
      .from(itemChecks)
      .where(
        and(
          eq(itemChecks.productId, input.productId),
          eq(itemChecks.kind, input.kind),
          eq(itemChecks.source, input.source),
          lte(itemChecks.at, at),
        ),
      )
      .orderBy(asc(itemChecks.at), asc(sql`rowid`));
    if (failureStands(before, input.rulesHash)) throw new DomainError('forbidden');
  }
  const [row] = await db
    .insert(itemChecks)
    .values({
      productId: input.productId,
      kind: input.kind,
      source: input.source,
      outcome: input.outcome,
      by: input.by,
      rulesHash: input.rulesHash,
      counts: input.counts ?? null,
      userId: input.userId ?? null,
      note: input.note?.trim() || null,
      at,
    })
    .returning();
  return row!;
}
