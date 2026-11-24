// The Wishlist (requirements S36: Scope rule, Terms "Wish", "The item's rules", "Confirmed", step B1;
// plan W9 and section 9 C, G). A wish is a watch (S9): one list, every watch a wish. This file holds
// what is a wish's own on top of a watch: whether a game wish still needs its check (`wishState`,
// the one place that decides it: the list, the check page and later the alerts read it), a game added
// with its rules (one, boxed or not, or several from a pasted list), and the one accessor of a wish's
// sales and listings (`wishSales`, `wishOffers`: a boxed item's are its plain item's rows whose title
// passes the boxed words, a sale stored once, under the plain item).
import {
  type ConsoleRow,
  type EffectiveRules,
  type ItemRulesRow,
  type Condition,
  consoleKey,
  consoleOf,
  effectiveRules,
  failsRules,
  isGameItem,
  normalizeTitle,
  pickName,
  rulesHash,
} from '@tora/core';
import { and, asc, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';
import type { Db } from './client';
import { listConsoles } from './consoles';
import { type Confirmations, confirmationsMany, getItemRules, saveItemRules } from './item-rules';
import { queueWishReadsSafely } from './deep-reads';
import { DomainError, createProduct } from './mutations';
import { type RuleHold, isHeld } from './rule-marks';
import {
  type Product,
  type User,
  type Watch,
  itemRuleState,
  itemRules,
  notItemMarks,
  priceObservations,
  products,
  saleCoverage,
  supply,
  watches,
} from './schema';
import { type SupplyOffer, searchOffers } from './supply';
import { type WatchInput, addWatchOf, savedAlertState, writeWatch } from './watches';

// ---------------------------------------------------------------------------------------------
// Check needed

/**
 * What a wish reads (S36 B1, Scope rule): `not_game` for a wish on anything the game rules do not
 * cover (cards, sealed, a game kind nobody turned them on for): it keeps what the Watchlist does
 * (S9), unchanged. A game wish is `check_needed` until its item's sales are confirmed under today's
 * rules hash (S36 Terms "Confirmed"), and while the item is held by the per-item stop (S36 A1: held
 * until a person confirms it at the registration check); then `confirmed`. Nothing is backfilled:
 * a game watch made before S36 has no confirmation, so it reads `check_needed`.
 */
export type WishState = 'not_game' | 'check_needed' | 'confirmed';

export function wishState(input: {
  game: boolean;
  salesConfirmed: boolean;
  held: boolean;
}): WishState {
  if (!input.game) return 'not_game';
  if (input.held || !input.salesConfirmed) return 'check_needed';
  return 'confirmed';
}

/** A wished item's rules, checks and hold, with the state they give (`wishState`). */
export interface WishInfo {
  state: WishState;
  game: boolean;
  /** The item's own rules row (null: by its platform, no words). */
  rules: ItemRulesRow | null;
  confirmations: Confirmations;
  /** The per-item stop's record, when the item is held now (released holds read null). */
  held: RuleHold | null;
}

/** The fields of an item the state reads. */
export type WishItem = Pick<Product, 'id' | 'category' | 'kind' | 'platform' | 'region'>;

const IDS_PER_READ = 500;

/**
 * The state of many wished items at once (S19: their rules rows, checks, console table and rule
 * states in a few batched reads, never one per wish). Items given twice are read once.
 */
export async function wishStates(
  db: Pick<Db, 'select'>,
  items: readonly WishItem[],
): Promise<Map<string, WishInfo>> {
  const out = new Map<string, WishInfo>();
  const byId = new Map(items.map((p) => [p.id, p]));
  if (!byId.size) return out;
  const many = await confirmationsMany(db, [...byId.values()]);
  // The per-item stop holds the item whose rows are judged: a boxed item's plain item (S36 B1).
  const heldOf = (id: string) => {
    const rules = many.get(id)!.rules;
    return rules?.boxed && rules.boxedOf ? rules.boxedOf : id;
  };
  const ids = [...new Set([...byId.keys()].map(heldOf))];
  const holds = new Map<string, RuleHold>();
  for (let i = 0; i < ids.length; i += IDS_PER_READ) {
    const rows = await db
      .select({ productId: itemRuleState.productId, held: itemRuleState.held })
      .from(itemRuleState)
      .where(
        and(
          inArray(itemRuleState.productId, ids.slice(i, i + IDS_PER_READ)),
          isNotNull(itemRuleState.held),
        ),
      );
    for (const r of rows) {
      const held = r.held as unknown as RuleHold | null;
      if (isHeld(held)) holds.set(r.productId, held!);
    }
  }
  for (const [id, item] of byId) {
    const own = many.get(id)!;
    const game = isGameItem(item, own.rules);
    const held = holds.get(heldOf(id)) ?? null;
    out.set(id, {
      state: wishState({
        game,
        salesConfirmed: own.confirmations.isConfirmed('sales', ''),
        held: !!held,
      }),
      game,
      rules: own.rules,
      confirmations: own.confirmations,
      held,
    });
  }
  return out;
}

/**
 * The person's next game wish that reads "check needed", other than `exceptWishId` (the check page's
 * link after a confirmation), or null. The person's own wishes only; states in batched reads (S19).
 */
export async function nextWishToCheck(
  db: Pick<Db, 'select'>,
  userId: string,
  exceptWishId: string,
): Promise<{ wishId: string; name: string } | null> {
  const rows = await db
    .select({ watch: watches, product: products })
    .from(watches)
    .innerJoin(products, eq(products.id, watches.productId))
    .where(and(eq(watches.userId, userId), eq(products.category, 'game')))
    .orderBy(asc(watches.createdAt));
  const others = rows.filter((r) => r.watch.id !== exceptWishId);
  if (!others.length) return null;
  const states = await wishStates(
    db,
    others.map((r) => r.product),
  );
  const next = others.find((r) => states.get(r.product.id)?.state === 'check_needed');
  return next ? { wishId: next.watch.id, name: next.product.name } : null;
}

/**
 * Whether a person's confirmation must wait for the next read (S36 Data rules: "A confirmation never
 * outlives the rules it was made under"; fix C6): the item's rules changed after Tora last read the
 * item whose rows it shows, so the sales and listings on the page were not read under them. Changed
 * at: the latest `item_rules.updated_at` of the item and, for a boxed item, of its plain item; a row
 * never changed since it was written that gives the same rules as no row (a game prefilled with its
 * platform's console and no words) is no change. Read at: the latest of the rows item's
 * `sale_coverage.updated_at` (a read night) and `item_rule_state.applied_at` (the rules applied).
 * Changed and never read since: true. Admins are bound by it too.
 */
export async function awaitsRead(db: Pick<Db, 'select'>, productId: string): Promise<boolean> {
  const [own] = await db.select().from(itemRules).where(eq(itemRules.productId, productId));
  const from = own?.boxed && own.boxedOf ? own.boxedOf : productId;
  const rows = [own];
  if (from !== productId)
    rows.push((await db.select().from(itemRules).where(eq(itemRules.productId, from)))[0]);
  const consoles = await listConsoles(db);
  let changed = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    if (!row) continue;
    if (row.createdAt === row.updatedAt && row.gameRules === null) {
      const [p] = await db
        .select({ platform: products.platform, region: products.region })
        .from(products)
        .where(eq(products.id, row.productId));
      const hashOf = (r: ItemRulesRow | null) => rulesHash(effectiveRules(p!, r, consoles));
      if (p && hashOf(null) === hashOf(rowRules(row))) continue;
    }
    changed = Math.max(changed, Date.parse(row.updatedAt));
  }
  if (changed === Number.NEGATIVE_INFINITY) return false;
  const [[covered], [state]] = await Promise.all([
    db
      .select({ at: sql<string | null>`max(${saleCoverage.updatedAt})` })
      .from(saleCoverage)
      .where(eq(saleCoverage.productId, from)),
    db
      .select({ at: itemRuleState.appliedAt })
      .from(itemRuleState)
      .where(eq(itemRuleState.productId, from)),
  ]);
  const read = Math.max(
    ...[covered?.at, state?.at].map((at) => (at ? Date.parse(at) : Number.NEGATIVE_INFINITY)),
  );
  return !(read > changed);
}

/** A stored rules row as the rules read it. */
const rowRules = (r: typeof itemRules.$inferSelect): ItemRulesRow => ({
  console: r.console,
  edition: r.edition,
  required: r.required ?? [],
  excluded: r.excluded ?? [],
  boxed: r.boxed,
  boxedOf: r.boxedOf,
  gameRules: r.gameRules === 0 || r.gameRules === 1 ? r.gameRules : null,
});

// ---------------------------------------------------------------------------------------------
// Who may act on a wish

/**
 * The wish and its item for a server action: the person's own wish, or any wish for an admin
 * (S36 B1: "each checked on the server (the wish's owner, or an admin)"). `not_found` otherwise,
 * so another person's wish id says nothing.
 */
export async function wishForAction(
  db: Pick<Db, 'select'>,
  user: Pick<User, 'id' | 'role'>,
  wishId: string,
): Promise<{ watch: Watch; product: Product }> {
  const id = typeof wishId === 'string' ? wishId.slice(0, 40) : '';
  const [row] = await db
    .select({ watch: watches, product: products })
    .from(watches)
    .innerJoin(products, eq(products.id, watches.productId))
    .where(
      user.role === 'admin'
        ? eq(watches.id, id)
        : and(eq(watches.id, id), eq(watches.userId, user.id)),
    );
  if (!row) throw new DomainError('not_found');
  return row;
}

/** The person's own wish and its item (the check page: owner only), or null. */
export async function ownWish(
  db: Pick<Db, 'select'>,
  userId: string,
  wishId: string,
): Promise<{ watch: Watch; product: Product } | null> {
  const [row] = await db
    .select({ watch: watches, product: products })
    .from(watches)
    .innerJoin(products, eq(products.id, watches.productId))
    .where(and(eq(watches.id, wishId.slice(0, 40)), eq(watches.userId, userId)));
  return row ?? null;
}

// ---------------------------------------------------------------------------------------------
// A wish's sales and listings (one accessor; S36 B1, plan 9 C)

/** The item whose stored rows a wished item reads: its plain item when boxed, else itself. */
export async function rowsItemOf(
  db: Pick<Db, 'select'>,
  productId: string,
): Promise<{ from: string; rules: EffectiveRules | null }> {
  const own = await getItemRules(db, productId);
  if (!own?.boxed || !own.boxedOf) return { from: productId, rules: null };
  const [product] = await db
    .select({ platform: products.platform, region: products.region })
    .from(products)
    .where(eq(products.id, productId));
  if (!product) return { from: productId, rules: null };
  return { from: own.boxedOf, rules: effectiveRules(product, own, await listConsoles(db)) };
}

/** One stored sale as a wish reads it. */
export interface WishSale {
  id: string;
  /** The item it is stored under (the plain item, for a boxed wish). */
  productId: string;
  source: string;
  externalRef: string;
  title: string | null;
  url: string | null;
  bucket: string | null;
  priceBase: number;
  observedAt: string;
  excluded: boolean;
  excludedReason: string | null;
  ruleMark: string | null;
  /** The units were not reported (`price_observations.quantity_inferred`). */
  quantityInferred: boolean;
  currency: string | null;
  updatedAt: string;
  /** The row's raw answer, with `withRaw` only. */
  raw?: unknown;
  /**
   * A boxed wish's sale dropped by a "not the item" mark on the boxed item: who made it (null: no
   * user kept). Unset for every other row.
   */
  markedBy?: string | null;
}

export interface WishSalesOptions {
  /** Only sales observed at or after this time (ISO). */
  since?: string;
  /** Excluded sales too (the registration check shows what was dropped); kept only by default. */
  withExcluded?: boolean;
  /** The raw answers too (the level reads who paid the shipping from them, W14). */
  withRaw?: boolean;
}

/**
 * A wished item's sold rows (S36 B1): a plain item's own rows; a boxed item's are its plain item's
 * rows whose title passes the boxed item's rules (`titlePasses` through `failsRules` with no
 * category: the boxed words, and its own words), so a sale is stored once and never copied; a sale
 * marked "not the item" on the boxed item is dropped for it (read as excluded, reason `manual`).
 */
export async function wishSales(
  db: Pick<Db, 'select'>,
  productId: string,
  options: WishSalesOptions = {},
): Promise<WishSale[]> {
  const { from, rules } = await rowsItemOf(db, productId);
  const o = priceObservations;
  const rows = await db
    .select(saleColumns(options))
    .from(o)
    .where(and(eq(o.productId, from), salesWhere(options)));
  if (!rules) return rows;
  // A boxed wisher's "not the item" on a sale is a mark on the boxed item (`not_item_marks` with
  // the boxed id, fix C7): the sale is dropped for the boxed item only, its stored row untouched.
  const marks = await db
    .select({
      source: notItemMarks.source,
      ref: notItemMarks.externalRef,
      userId: notItemMarks.userId,
    })
    .from(notItemMarks)
    .where(eq(notItemMarks.productId, productId));
  return boxedSales(
    rows,
    rules,
    new Map(marks.map((m) => [`${m.source}|${m.ref}`, m.userId])),
    options,
  );
}

const saleColumns = (options: WishSalesOptions) => {
  const o = priceObservations;
  return {
    id: o.id,
    productId: o.productId,
    source: o.source,
    externalRef: o.externalRef,
    title: o.title,
    url: o.url,
    bucket: o.bucket,
    priceBase: o.priceBase,
    observedAt: o.observedAt,
    excluded: o.excluded,
    excludedReason: o.excludedReason,
    ruleMark: o.ruleMark,
    quantityInferred: o.quantityInferred,
    currency: o.currency,
    updatedAt: o.updatedAt,
    ...(options.withRaw ? { raw: o.raw } : {}),
  };
};

const salesWhere = (options: WishSalesOptions) =>
  and(
    eq(priceObservations.observationType, 'sold'),
    options.withExcluded ? undefined : eq(priceObservations.excluded, false),
    options.since ? gte(priceObservations.observedAt, options.since) : undefined,
  );

/** A boxed item's sales from its plain item's rows: its rules' titles, its "not the item" marks. */
function boxedSales(
  rows: readonly WishSale[],
  rules: EffectiveRules,
  marked: ReadonlyMap<string, string | null>,
  options: WishSalesOptions,
): WishSale[] {
  return rows.flatMap((r) => {
    if (failsRules({ title: r.title, category: null }, rules, r.source)) return [];
    const key = `${r.source}|${r.externalRef}`;
    if (!marked.has(key) || r.excluded) return [r];
    return options.withExcluded
      ? [{ ...r, excluded: true, excludedReason: 'manual' as const, markedBy: marked.get(key)! }]
      : [];
  });
}

/** A wished item as `wishSalesMany` reads it: whose rows, and a boxed item's own rules. */
export interface WishRowsOf {
  productId: string;
  /** The item whose rows are read (a boxed item's plain item; else itself). */
  from: string;
  /** A boxed item's effective rules (its titles filter the plain item's rows); null: not boxed. */
  boxedRules: EffectiveRules | null;
}

/**
 * `wishSales` for many items at once (S19: batched by item list, never one read per wish): the sold
 * rows of every `from` in chunks, and the boxed items' "not the item" marks in chunks, filtered as
 * `wishSales` does. By `productId`; an item with no rows reads empty.
 */
export async function wishSalesMany(
  db: Pick<Db, 'select'>,
  items: readonly WishRowsOf[],
  options: WishSalesOptions = {},
): Promise<Map<string, WishSale[]>> {
  const o = priceObservations;
  const byFrom = new Map<string, WishSale[]>();
  const froms = [...new Set(items.map((i) => i.from))];
  for (let i = 0; i < froms.length; i += IDS_PER_READ)
    for (const r of await db
      .select(saleColumns(options))
      .from(o)
      .where(and(inArray(o.productId, froms.slice(i, i + IDS_PER_READ)), salesWhere(options))))
      byFrom.set(r.productId, [...(byFrom.get(r.productId) ?? []), r]);
  const boxed = [...new Set(items.filter((i) => i.boxedRules).map((i) => i.productId))];
  const marks = new Map<string, Map<string, string | null>>();
  for (let i = 0; i < boxed.length; i += IDS_PER_READ)
    for (const m of await db
      .select({
        productId: notItemMarks.productId,
        source: notItemMarks.source,
        ref: notItemMarks.externalRef,
        userId: notItemMarks.userId,
      })
      .from(notItemMarks)
      .where(inArray(notItemMarks.productId, boxed.slice(i, i + IDS_PER_READ))))
      marks.set(
        m.productId,
        (marks.get(m.productId) ?? new Map<string, string | null>()).set(
          `${m.source}|${m.ref}`,
          m.userId,
        ),
      );
  const out = new Map<string, WishSale[]>();
  for (const item of items) {
    const rows = byFrom.get(item.from) ?? [];
    out.set(
      item.productId,
      item.boxedRules
        ? boxedSales(rows, item.boxedRules, marks.get(item.productId) ?? new Map(), options)
        : rows,
    );
  }
  return out;
}

/** One stored supply row's search listings as a wish reads them. */
export interface WishOfferRow {
  source: string;
  bucket: string;
  day: string;
  /** Listings that count for the wish (cheapest first). */
  offers: SupplyOffer[];
  /** Listings marked "not the item" for the wished item (or, boxed, for its plain item). */
  marked: SupplyOffer[];
}

/**
 * A wished item's stored search listings (S36 B1, A2), rows of `since` (a day) and later: a plain
 * item's own rows; a boxed item's are its plain item's whose title passes the boxed item's rules.
 * The identity shop's entries are not listings (`searchOffers`). A listing marked "not the item" is
 * moved to `marked`: for a boxed item a mark on either item counts.
 */
export async function wishOffers(
  db: Pick<Db, 'select'>,
  productId: string,
  options: { since?: string } = {},
): Promise<WishOfferRow[]> {
  const { from, rules } = await rowsItemOf(db, productId);
  const [rows, marks] = await Promise.all([
    db
      .select({
        source: supply.source,
        bucket: supply.bucket,
        day: supply.day,
        offers: supply.offers,
      })
      .from(supply)
      .where(
        and(
          eq(supply.productId, from),
          isNotNull(supply.offers),
          options.since ? gte(supply.day, options.since) : undefined,
        ),
      ),
    db
      .select({ source: notItemMarks.source, ref: notItemMarks.externalRef })
      .from(notItemMarks)
      .where(inArray(notItemMarks.productId, [...new Set([productId, from])])),
  ]);
  const marked = new Set(marks.map((m) => `${m.source}|${m.ref}`));
  return rows.flatMap((r) => {
    const all = searchOffers(r);
    if (!all) return [];
    const mine = rules
      ? all.filter((o) => !failsRules({ title: o.title, category: null }, rules, r.source))
      : all;
    return [
      {
        source: r.source,
        bucket: r.bucket,
        day: r.day,
        offers: mine.filter((o) => !marked.has(`${r.source}|${o.ref}`)),
        marked: mine.filter((o) => marked.has(`${r.source}|${o.ref}`)),
      },
    ];
  });
}

// ---------------------------------------------------------------------------------------------
// Adding a game wish (S36 B1)

/** The region a new game gets unless the person picks another (S36 B1: "region default Japan"). */
export const DEFAULT_GAME_REGION = 'jp';

export interface GameWishInput {
  name: string;
  /** A console of the console table: its key, a name or another spelling. */
  console: string;
  region?: string | null;
  edition?: string | null;
  /** A boxed copy (S36 B1), only for a console whose row allows it. */
  boxed?: boolean;
  /** An item already in Tora to wish in place of a new one (a game; never a boxed item). */
  reuse?: string | null;
  watch: WatchInput;
}

/**
 * The condition a game wish gets when none is given (S36 Terms "Condition"): no noticeable damage,
 * bucket `cond:good`. A wish with no condition would have the empty bucket, which no sale has, so it
 * would never get a level (fix round 1, item 0).
 */
export const DEFAULT_GAME_CONDITION: Condition = 'no_noticeable_damage';
const DEFAULT_GAME_BUCKET = 'cond:good';

/** The console row a typed console names (key, name or alias), or null. */
export function findConsole(text: string, consoles: readonly ConsoleRow[]): ConsoleRow | null {
  const key = consoleOf(text, consoles) ?? consoleKey(text);
  return consoles.find((c) => c.key === key) ?? null;
}

/** A console's name as a new item's platform: English, else its first, else its key. */
const consoleName = (c: ConsoleRow) => pickName(c.names, 'en', c.key);

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** An item's console: its rules row's, else the one its platform names. */
const consoleOfItem = (
  p: Pick<Product, 'platform'>,
  rules: ItemRulesRow | null,
  consoles: readonly ConsoleRow[],
) => (rules?.console ? consoleKey(rules.console) : consoleOf(p.platform, consoles));

/**
 * Adds a game wish in one transaction (S36 B1): the item (reused, or new with the console's name
 * as its platform and the region, default Japan), its rules row when new (console from the choice,
 * the edition, no required and no excluded words: the person adds words at the check), and when
 * boxed the boxed item (created or reused: `boxed`, `boxed_of` the plain item) on which the wish is
 * made. Nothing is fetched: the identity shop's link comes from the nightly candidates.
 */
export async function addGameWish(
  db: Db,
  userId: string,
  input: GameWishInput,
): Promise<{ watch: Watch; product: Product; plain: Product }> {
  const name = input.name?.trim();
  if (!name || name.length > 200) throw new DomainError('invalid_input');
  const edition = input.edition?.trim() || null;
  if (edition && edition.length > 80) throw new DomainError('invalid_input');
  const made = await db.transaction(async (tx) => {
    const consoles = await listConsoles(tx);
    const row = findConsole(input.console ?? '', consoles);
    if (!row) throw new DomainError('invalid_input');
    if (input.boxed && !row.boxedAllowed) throw new DomainError('invalid_input');
    const plain = input.reuse
      ? await reusable(tx, input.reuse, row.key, consoles, !!input.boxed)
      : await newGame(tx, userId, {
          name,
          platform: consoleName(row),
          region: input.region || DEFAULT_GAME_REGION,
          console: row.key,
          edition,
        });
    const target = input.boxed ? await boxedOf(tx, userId, plain, row.key) : plain;
    const given = input.watch.condition != null;
    if (!given) await goodFromEmpty(tx, userId, target.id);
    // A game wished again keeps its stored target and note unless new ones were typed (fix 2).
    const watch = await addWatchOf(
      tx,
      userId,
      target,
      { ...input.watch, condition: input.watch.condition ?? DEFAULT_GAME_CONDITION },
      { keepUntyped: true },
    );
    return { watch, product: target, plain };
  });
  // Its deep reads (S36 B3), once the wish is stored.
  await queueWishReadsSafely(db, made.product.id);
  return made;
}

/**
 * A person's earlier wish on the item with the empty bucket (made before a game wish had a default
 * condition) becomes the `cond:good` wish, so adding the game again leaves one wish, not two (fix
 * round 1, item 0); its target and note then follow `keepUntyped`. Left alone when the person already
 * has a `cond:good` watch on the item. A new bucket starts its alerts afresh, as `updateWatch` does.
 */
async function goodFromEmpty(tx: Tx, userId: string, productId: string): Promise<void> {
  const mine = (bucket: string) =>
    and(eq(watches.userId, userId), eq(watches.productId, productId), eq(watches.bucket, bucket));
  const [good] = await tx.select({ id: watches.id }).from(watches).where(mine(DEFAULT_GAME_BUCKET));
  if (good) return;
  await writeWatch(tx, mine('')!, (w) => ({
    condition: DEFAULT_GAME_CONDITION,
    bucket: DEFAULT_GAME_BUCKET,
    alertState: savedAlertState(w.alertState, true, false),
  }));
}

/**
 * An item to reuse: a plain game of this console (`invalid_input` otherwise). For a boxed wish it
 * must be a game by its rules too: a boxed item reads its plain item's rows, which are read and
 * confirmed only while the game rules cover the plain item (fix 1).
 */
async function reusable(
  tx: Tx,
  id: string,
  console: string,
  consoles: readonly ConsoleRow[],
  boxed: boolean,
): Promise<Product> {
  const [product] = await tx.select().from(products).where(eq(products.id, id));
  if (!product) throw new DomainError('not_found');
  const rules = await getItemRules(tx, id);
  if (
    product.category !== 'game' ||
    rules?.boxed ||
    (boxed && !isGameItem(product, rules)) ||
    consoleOfItem(product, rules, consoles) !== console
  )
    throw new DomainError('invalid_input');
  return product;
}

async function newGame(
  tx: Tx,
  userId: string,
  g: { name: string; platform: string; region: string; console: string; edition: string | null },
): Promise<Product> {
  const product = await createProduct(tx, userId, {
    category: 'game',
    kind: 'software',
    name: g.name,
    platform: g.platform,
    region: g.region,
  });
  await saveItemRules(
    tx,
    product.id,
    {
      console: g.console,
      edition: g.edition,
      required: [],
      excluded: [],
      boxed: false,
      boxedOf: null,
      gameRules: null,
    },
    userId,
  );
  return product;
}

/**
 * A pasted line's plain game item, in the caller's transaction (S36 step D reuses W9's add): the
 * look-alike chosen (a plain game of this console, `reusable`), else a new game item with its rules
 * row (the console's name as its platform, the region Japan). No watch, no holding.
 */
export async function plainGameFor(
  tx: Tx,
  userId: string,
  line: { name: string; console: string; reuse: string | null },
): Promise<{ product: Product; reused: boolean }> {
  const consoles = await listConsoles(tx);
  const row = findConsole(line.console, consoles);
  if (!row) throw new DomainError('invalid_input');
  if (line.reuse)
    return { product: await reusable(tx, line.reuse, row.key, consoles, false), reused: true };
  const name = line.name.trim();
  if (!name || name.length > 200) throw new DomainError('invalid_input');
  const product = await newGame(tx, userId, {
    name,
    platform: consoleName(row),
    region: DEFAULT_GAME_REGION,
    console: row.key,
    edition: null,
  });
  return { product, reused: false };
}

/** The plain item's boxed item, reused when one exists, else created with its rules row. */
async function boxedOf(tx: Tx, userId: string, plain: Product, console: string): Promise<Product> {
  const [have] = await tx
    .select({ product: products })
    .from(itemRules)
    .innerJoin(products, eq(products.id, itemRules.productId))
    .where(and(eq(itemRules.boxedOf, plain.id), eq(itemRules.boxed, true)))
    .limit(1);
  if (have) return have.product;
  const plainRules = await getItemRules(tx, plain.id);
  const product = await createProduct(tx, userId, {
    category: 'game',
    kind: plain.kind,
    name: plain.name,
    nameAlias: plain.nameAlias,
    platform: plain.platform,
    region: plain.region,
    releaseDate: plain.releaseDate,
  });
  await saveItemRules(
    tx,
    product.id,
    {
      console,
      edition: plainRules?.edition ?? null,
      required: [],
      excluded: [],
      boxed: true,
      boxedOf: plain.id,
      gameRules: null,
    },
    userId,
  );
  return product;
}

/**
 * When a person wishes an item picked in the usual add flow and it is a new game, its rules row is
 * written as for a game added here (console from its platform, no words). An item that has a row
 * keeps it; a card or sealed item gets none. The effective rules, and so their hash, are the same
 * with or without the row: the row only records who set it up.
 */
export async function prefillGameRules(
  db: Pick<Db, 'select' | 'insert'>,
  product: Product,
  userId: string,
): Promise<void> {
  if (!isGameItem(product) || (await getItemRules(db, product.id))) return;
  const console = consoleOf(product.platform, await listConsoles(db));
  if (!console) return;
  await saveItemRules(
    db,
    product.id,
    {
      console,
      edition: null,
      required: [],
      excluded: [],
      boxed: false,
      boxedOf: null,
      gameRules: null,
    },
    userId,
  );
}

// ---------------------------------------------------------------------------------------------
// Several games from a pasted list (S36 B1; plan 9 G)

/** At most this many lines in one paste (S36 B1 spec: "At most 50 lines"). */
export const BULK_MAX = 50;

export type BulkLineError = 'format' | 'console' | 'duplicate' | 'name';

export interface BulkLine {
  /** 1-based, among the non-empty lines. */
  line: number;
  name: string;
  consoleText: string;
  /** The console row's key and name, when found. */
  console: string | null;
  consoleName: string | null;
  boxedAllowed: boolean;
  error: BulkLineError | null;
  /** Plain game items of the same console whose name reads the same (normalized). */
  lookAlikes: { id: string; name: string; platform: string | null; wished: boolean }[];
}

/**
 * The lines of a paste (pure): `name | console` per line, blank lines skipped. A line without a `|`,
 * or with an empty side, is a format error; an unknown console an error of its own; a line naming
 * the same game and console as an earlier line a duplicate.
 */
export function parseBulk(
  text: string,
  consoles: readonly ConsoleRow[],
  max = BULK_MAX,
): { lines: Omit<BulkLine, 'lookAlikes'>[]; tooMany: boolean } {
  const raw = String(text ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const lines = raw.slice(0, max).map((l, i) => {
    const at = l.lastIndexOf('|');
    const name = at >= 0 ? l.slice(0, at).trim() : l;
    const consoleText = at >= 0 ? l.slice(at + 1).trim() : '';
    const row = consoleText ? findConsole(consoleText, consoles) : null;
    const key = row ? `${normalizeTitle(name)}|${row.key}` : null;
    const error: BulkLineError | null =
      at < 0 || !name || !consoleText
        ? 'format'
        : name.length > 200
          ? 'name'
          : !row
            ? 'console'
            : seen.has(key!)
              ? 'duplicate'
              : null;
    if (key) seen.add(key);
    return {
      line: i + 1,
      name,
      consoleText,
      console: row?.key ?? null,
      consoleName: row ? consoleName(row) : null,
      boxedAllowed: !!row?.boxedAllowed,
      error,
    };
  });
  return { lines, tooMany: raw.length > max };
}

/**
 * The preview of a paste (S36 B1): per line what would happen, with the look-alike items already in
 * Tora (S36 spec Assumed: same console and a name equal after normalizing, the item's name or its
 * alias; boxed items are never offered). Reads only; writes nothing. `max`: the lines one paste
 * may hold (the tracked games' paste allows 100).
 */
export async function previewBulk(
  db: Pick<Db, 'select'>,
  userId: string,
  text: string,
  max = BULK_MAX,
): Promise<{ lines: BulkLine[]; tooMany: boolean }> {
  const consoles = await listConsoles(db);
  const { lines, tooMany } = parseBulk(text, consoles, max);
  const found = await lookAlikesOf(
    db,
    userId,
    lines.filter((l) => !l.error).map((l) => ({ name: l.name, console: l.console! })),
    consoles,
  );
  return {
    tooMany,
    lines: lines.map((l) => ({ ...l, lookAlikes: l.error ? [] : found(l.name, l.console!) })),
  };
}

/**
 * The look-alikes of one game a person is adding (fix C2: the one-game form runs the bulk preview's
 * lookup for its line, so a game already in Tora is reused, not made twice), for a console of the
 * table (key, name or other spelling). Empty for an unknown console or a blank name. For a boxed
 * add, only items that are games by their rules (`reusable` refuses the others, fix 1).
 */
export async function gameLookAlikes(
  db: Pick<Db, 'select'>,
  userId: string,
  name: string,
  console: string,
  options: { boxed?: boolean } = {},
): Promise<BulkLine['lookAlikes']> {
  const consoles = await listConsoles(db);
  const row = findConsole(console ?? '', consoles);
  const n = String(name ?? '').trim();
  if (!row || !n) return [];
  const found = await lookAlikesOf(db, userId, [{ name: n, console: row.key }], consoles, options);
  return found(n, row.key);
}

type LookAlike = BulkLine['lookAlikes'][number];

/**
 * Plain game items already in Tora that read the same as the wanted lines (S36 spec Assumed: same
 * console and a name equal after normalizing, the item's name or its alias; boxed items are never
 * offered), with whether the person wishes each; one set of reads for every line. Gives a lookup
 * by (name, console key).
 */
async function lookAlikesOf(
  db: Pick<Db, 'select'>,
  userId: string,
  lines: readonly { name: string; console: string }[],
  consoles: readonly ConsoleRow[],
  options: { boxed?: boolean } = {},
): Promise<(name: string, console: string) => LookAlike[]> {
  const wanted = new Set(lines.map((l) => normalizeTitle(l.name)));
  if (!wanted.size) return () => [];
  const games = await db
    .select({
      id: products.id,
      name: products.name,
      nameAlias: products.nameAlias,
      platform: products.platform,
      category: products.category,
      kind: products.kind,
    })
    .from(products)
    .where(eq(products.category, 'game'));
  const named = games.filter(
    (g) =>
      wanted.has(normalizeTitle(g.name)) ||
      (!!g.nameAlias && wanted.has(normalizeTitle(g.nameAlias))),
  );
  const ids = named.map((g) => g.id);
  const rules = new Map<string, ItemRulesRow>();
  const wished = new Set<string>();
  for (let i = 0; i < ids.length; i += IDS_PER_READ) {
    const part = ids.slice(i, i + IDS_PER_READ);
    const [own, mine] = await Promise.all([
      db.select().from(itemRules).where(inArray(itemRules.productId, part)),
      db
        .select({ id: watches.productId })
        .from(watches)
        .where(and(eq(watches.userId, userId), inArray(watches.productId, part))),
    ]);
    for (const r of own) rules.set(r.productId, rowRules(r));
    for (const r of mine) wished.add(r.id);
  }
  return (name, console) =>
    named
      .filter((g) => {
        const own = rules.get(g.id) ?? null;
        const same = [g.name, g.nameAlias].some(
          (n) => n && normalizeTitle(n) === normalizeTitle(name),
        );
        return (
          same &&
          !own?.boxed &&
          (!options.boxed || isGameItem(g, own)) &&
          consoleOfItem(g, own, consoles) === console
        );
      })
      .map((g) => ({ id: g.id, name: g.name, platform: g.platform, wished: wished.has(g.id) }));
}

export type BulkResult =
  | { line: number; name: string; ok: true; productId: string; wishId: string; reused: boolean }
  | { line: number; name: string; ok: false; error: string };

/**
 * Adds the lines of a paste (S36 B1): the text is parsed again here (the lines are the preview's,
 * never ones the browser rebuilt), and each line's choice is `new` or the id of one of its
 * look-alikes. Each line is one transaction (`addGameWish`): a failed line is reported and the
 * others stand. Lines with an error, or without a valid choice, are reported and skipped.
 */
export async function addBulk(
  db: Db,
  userId: string,
  text: string,
  choices: Readonly<Record<number, string>>,
  watch: WatchInput = {},
): Promise<BulkResult[]> {
  const { lines, tooMany } = await previewBulk(db, userId, text);
  if (tooMany) throw new DomainError('invalid_input');
  const out: BulkResult[] = [];
  for (const l of lines) {
    if (l.error) {
      out.push({ line: l.line, name: l.name, ok: false, error: l.error });
      continue;
    }
    const choice = choices[l.line];
    const reuse = choice && choice !== 'new' ? choice : null;
    if (!choice || (reuse && !l.lookAlikes.some((a) => a.id === reuse))) {
      out.push({ line: l.line, name: l.name, ok: false, error: 'choice' });
      continue;
    }
    try {
      const done = await addGameWish(db, userId, {
        name: l.name,
        console: l.console!,
        reuse,
        watch,
      });
      out.push({
        line: l.line,
        name: l.name,
        ok: true,
        productId: done.product.id,
        wishId: done.watch.id,
        reused: !!reuse,
      });
    } catch (error) {
      out.push({
        line: l.line,
        name: l.name,
        ok: false,
        error: error instanceof DomainError ? error.code : 'failed',
      });
    }
  }
  return out;
}
