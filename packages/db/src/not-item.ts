// "Not the item" marks on a game's stored listings (requirements S36 Terms "Checked listing": a
// person can mark a listing shown "not the item"; it is excluded for the item, the raw row stays and
// it no longer counts anywhere; step A2). A mark is scoped to (item, source, listing ref) and shared
// by everyone on the item; who made it is kept for the record (null for the labeled check, and set to
// null when the user is deleted). A mark never edits a stored supply row: what is for sale now is
// read without the marked listings (`withoutNotItem` in `currentSupply`), and the SDK's offer filter
// drops them from the next read on.
import { isGameItem, localDate, toLocalIso } from '@tora/core';
import { and, eq, gte, isNotNull } from 'drizzle-orm';
import type { Db } from './client';
import { getItemRules } from './item-rules';
import { DomainError } from './mutations';
import { type User, notItemMarks, products, supply, watches } from './schema';
import { SUPPLY_FRESH_DAYS, searchOffers } from './supply';

/** One stored listing of an item at a source. */
export interface NotItemTarget {
  productId: string;
  source: string;
  /** The listing's id at the source (`SupplyOffer.ref`). */
  ref: string;
}

/**
 * Whether `user` may mark the item's listings (S36 A2, plan W7 "Web"): the item is a game by its
 * rules (cards and sealed have no stored listings, nothing to mark), and the person has a wish on it
 * (a watches row of theirs for the item) or is an admin. Throws `not_found` for an unknown item and
 * `forbidden` otherwise.
 */
export async function assertMayMarkNotItem(
  db: Pick<Db, 'select'>,
  user: Pick<User, 'id' | 'role'>,
  productId: string,
): Promise<void> {
  await assertGame(db, productId);
  if (user.role === 'admin') return;
  const [wish] = await db
    .select({ id: watches.id })
    .from(watches)
    .where(and(eq(watches.userId, user.id), eq(watches.productId, productId)))
    .limit(1);
  if (!wish) throw new DomainError('forbidden');
}

/** The target as given by a form: anything but three non-empty strings (a ref up to 200) is refused. */
const cleanTarget = (t: NotItemTarget): NotItemTarget => {
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const target = { productId: text(t?.productId), source: text(t?.source), ref: text(t?.ref) };
  if (!target.productId || !target.source || !target.ref || target.ref.length > 200)
    throw new DomainError('invalid_input');
  return target;
};

/** The item exists and is a game by its rules (`not_found`, `forbidden`). */
async function assertGame(db: Pick<Db, 'select'>, productId: string) {
  const [product] = await db
    .select({ category: products.category, kind: products.kind })
    .from(products)
    .where(eq(products.id, productId));
  if (!product) throw new DomainError('not_found');
  if (!isGameItem(product, await getItemRules(db, productId))) throw new DomainError('forbidden');
}

/**
 * Whether the listing is among the item's stored search listings at the source shown now (the reports of
 * the last `SUPPLY_FRESH_DAYS`; a boxed item's are its plain item's): only a listing a person can see
 * is marked, never a guessed ref.
 */
async function isShownListing(db: Pick<Db, 'select'>, t: NotItemTarget, now: Date) {
  const since = localDate(new Date(now.getTime() - SUPPLY_FRESH_DAYS * 86_400_000));
  // A boxed item's listings are its plain item's rows (S36 B1, `wishOffers`).
  const from = (await getItemRules(db, t.productId))?.boxedOf ?? t.productId;
  const rows = await db
    .select({ offers: supply.offers })
    .from(supply)
    .where(
      and(
        eq(supply.productId, from),
        eq(supply.source, t.source),
        gte(supply.day, since),
        isNotNull(supply.offers),
      ),
    );
  // The shop's own copy and outside seller (S36 A6) are not search listings: never marked.
  return rows.some((r) => searchOffers(r)?.some((o) => o.ref === t.ref));
}

/**
 * A person marks a stored listing "not the item". Checked here: who may (`assertMayMarkNotItem`),
 * and that the listing is shown now. A listing already marked stays as it was (the first mark and
 * its maker are kept). Returns whether a mark was added.
 */
export async function markNotItem(
  db: Db,
  user: Pick<User, 'id' | 'role'>,
  input: NotItemTarget,
  now = new Date(),
): Promise<boolean> {
  const t = cleanTarget(input);
  await assertMayMarkNotItem(db, user, t.productId);
  if (!(await isShownListing(db, t, now))) throw new DomainError('not_found');
  const added = await db
    .insert(notItemMarks)
    .values({
      productId: t.productId,
      source: t.source,
      externalRef: t.ref,
      userId: user.id,
      at: toLocalIso(now),
    })
    .onConflictDoNothing()
    .returning({ id: notItemMarks.id });
  return added.length > 0;
}

/**
 * Takes a mark back. A person takes back their own marks, with or without a wish on the item still
 * (the item must still be a game); an admin any, the labeled check's too (a check's label is not
 * undone by someone else's click). Returns whether a mark went.
 */
export async function unmarkNotItem(
  db: Db,
  user: Pick<User, 'id' | 'role'>,
  input: NotItemTarget,
): Promise<boolean> {
  const t = cleanTarget(input);
  await assertGame(db, t.productId);
  const scope = and(
    eq(notItemMarks.productId, t.productId),
    eq(notItemMarks.source, t.source),
    eq(notItemMarks.externalRef, t.ref),
  );
  const gone = await db
    .delete(notItemMarks)
    .where(user.role === 'admin' ? scope : and(scope, eq(notItemMarks.userId, user.id)))
    .returning({ id: notItemMarks.id });
  return gone.length > 0;
}

/**
 * The marks of a labeled check (S36 A2: every listing labeled "not the item" is excluded, passed or
 * not), with no user. Already marked refs stay as they were. Returns how many were added.
 */
export async function addCheckMarks(
  db: Pick<Db, 'insert'>,
  productId: string,
  source: string,
  refs: readonly string[],
  now = new Date(),
): Promise<number> {
  if (!refs.length) return 0;
  const at = toLocalIso(now);
  const added = await db
    .insert(notItemMarks)
    .values(refs.map((externalRef) => ({ productId, source, externalRef, userId: null, at })))
    .onConflictDoNothing()
    .returning({ id: notItemMarks.id });
  return added.length;
}

/** Who marked which of an item's listings (`userId` null: the labeled check), by source and ref. */
export async function notItemMarksOf(
  db: Pick<Db, 'select'>,
  productId: string,
): Promise<Map<string, { userId: string | null; at: string }>> {
  const rows = await db
    .select({
      source: notItemMarks.source,
      ref: notItemMarks.externalRef,
      userId: notItemMarks.userId,
      at: notItemMarks.at,
    })
    .from(notItemMarks)
    .where(eq(notItemMarks.productId, productId));
  return new Map(rows.map((r) => [`${r.source}|${r.ref}`, { userId: r.userId, at: r.at }]));
}
