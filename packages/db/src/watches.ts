import { deriveBucket, parseWishState, productClass, restartWish } from '@tora/core';
import { type SQL, and, asc, eq, sql } from 'drizzle-orm';
import type { Db } from './client';
import { DomainError, type ProductRef, resolveProductRef } from './mutations';
import { type Product, type Watch, products, watches } from './schema';

/** A watch's condition, in a lot's fields (requirements S9). */
export type WatchCondition = Partial<
  Pick<
    Watch,
    'condition' | 'packagingState' | 'grading' | 'rawGrade' | 'grader' | 'grade' | 'conditionValue'
  >
>;

export interface WatchInput extends WatchCondition {
  /** Per unit, in the base currency; null for none. */
  targetPriceBase?: number | null;
  note?: string | null;
  /** Buy zone alerts with little data too (unset: on for a new watch, kept on a change). */
  alertLimited?: boolean;
}

function fields(product: Product, input: WatchInput) {
  const condition = {
    condition: input.condition ?? null,
    packagingState: input.packagingState ?? null,
    grading: input.grading ?? null,
    rawGrade: input.rawGrade ?? null,
    grader: input.grader ?? null,
    grade: input.grade?.trim() || null,
    conditionValue: input.conditionValue ?? null,
  };
  const target = input.targetPriceBase ?? null;
  if (target !== null && (!Number.isSafeInteger(target) || target <= 0)) {
    throw new DomainError('invalid_input');
  }
  return {
    ...condition,
    bucket: deriveBucket({ productClass: productClass(product), ...condition }) ?? '',
    targetPriceBase: target,
    note: input.note?.trim() || null,
    ...(input.alertLimited !== undefined && { alertLimited: input.alertLimited }),
  };
}

/**
 * Watches an item in a condition (creating the item first when new). Watching the same item and
 * condition again updates its target and note.
 */
export async function addWatch(
  db: Db,
  userId: string,
  ref: ProductRef,
  input: WatchInput,
): Promise<{ watch: Watch; product: Product }> {
  const product = await resolveProductRef(db, userId, ref);
  return { watch: await addWatchOf(db, userId, product, input), product };
}

/**
 * Watches an item already read (in the caller's transaction, e.g. one line of a bulk add); the same
 * item and condition again updates its target and note. `keepUntyped` (adding a game wish, S36 B1):
 * a target or note left empty keeps the stored one instead of clearing it.
 */
export async function addWatchOf(
  db: Pick<Db, 'insert' | 'select' | 'update'>,
  userId: string,
  product: Product,
  input: WatchInput,
  options: { keepUntyped?: boolean } = {},
): Promise<Watch> {
  const values = fields(product, input);
  const keep = options.keepUntyped;
  const [stored] = await db
    .select({ price: watches.targetPriceBase })
    .from(watches)
    .where(
      and(
        eq(watches.userId, userId),
        eq(watches.productId, product.id),
        eq(watches.bucket, values.bucket),
      ),
    );
  const [watch] = await db
    .insert(watches)
    .values({ userId, productId: product.id, ...values })
    .onConflictDoUpdate({
      target: [watches.userId, watches.productId, watches.bucket],
      set: {
        targetPriceBase:
          keep && values.targetPriceBase === null
            ? sql`${watches.targetPriceBase}`
            : values.targetPriceBase,
        note: keep && values.note === null ? sql`${watches.note}` : values.note,
        ...(values.alertLimited !== undefined && { alertLimited: values.alertLimited }),
      },
    })
    .returning();
  // Wished again at another price: a game wish's alerts start afresh (S36 C3); a card's memory
  // stays as an upsert has always left it.
  if (!stored || stored.price === watch!.targetPriceBase) return watch!;
  return (
    (await writeWatch(db, eq(watches.id, watch!.id), (w) => {
      const wish = parseWishState(w.alertState?.wish);
      return wish && wish !== 'invalid'
        ? { alertState: { ...w.alertState, wish: restartWish(wish) } }
        : null;
    })) ?? watch!
  );
}

/** Changes a watch's condition, target or note. */
export async function updateWatch(
  db: Db,
  userId: string,
  watchId: string,
  input: WatchInput,
): Promise<Watch> {
  const [row] = await db
    .select({ watch: watches, product: products })
    .from(watches)
    .innerJoin(products, eq(products.id, watches.productId))
    .where(and(eq(watches.id, watchId), eq(watches.userId, userId)));
  if (!row) throw new DomainError('not_found');
  const values = fields(row.product, input);
  if (values.bucket !== row.watch.bucket) {
    const [taken] = await db
      .select({ id: watches.id })
      .from(watches)
      .where(
        and(
          eq(watches.userId, userId),
          eq(watches.productId, row.product.id),
          eq(watches.bucket, values.bucket),
        ),
      );
    if (taken) throw new DomainError('duplicate_watch');
  }
  const watch = await writeWatch(
    db,
    and(eq(watches.id, watchId), eq(watches.userId, userId))!,
    (w) => ({
      ...values,
      alertState: savedAlertState(
        w.alertState,
        values.bucket !== w.bucket,
        values.targetPriceBase !== w.targetPriceBase,
      ),
    }),
  );
  if (!watch) throw new DomainError('not_found');
  return watch;
}

/**
 * A watch's alert memory after a save: a new condition starts its alerts afresh and a new target
 * its target part (S9 part 5); a game wish's part restarts on either and keeps the copies it
 * alerted (S36 C3, `restartWish`). A stored wish part that is not a valid one stays as it is.
 */
export function savedAlertState(
  state: Watch['alertState'],
  bucketChanged: boolean,
  priceChanged: boolean,
): Watch['alertState'] {
  // Nothing restarts: the memory as stored, a NULL as the empty one, as before the wish's part came
  // (a card or sealed watch's stored text stays what it was). The closing step's compare-and-set
  // misses on that rewrite and writes its step again on the fresh text (`wish-alerts.ts`).
  const stored = state ?? {};
  if (!bucketChanged && !priceChanged) return stored;
  const parsed = parseWishState(stored.wish);
  const wish =
    parsed === null ? undefined : parsed === 'invalid' ? stored.wish : restartWish(parsed);
  if (bucketChanged) return wish === undefined ? null : { wish };
  return wish === undefined ? { zone: stored.zone } : { zone: stored.zone, wish };
}

/**
 * Writes one watch by compare-and-set on its stored alert memory (S36 C3): the closing step writing
 * between the read and the write makes this read and compute again, 3 tries, then an error (a save
 * never silently drops the step's write, nor the step the save's). `next` gives the fields to set
 * (null: nothing to write); null when no row matches `where`.
 */
export async function writeWatch(
  db: Pick<Db, 'select' | 'update'>,
  where: SQL,
  next: (watch: Watch) => Partial<Watch> | null,
): Promise<Watch | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const [row] = await db
      .select({ watch: watches, raw: sql<string | null>`${watches.alertState}` })
      .from(watches)
      .where(where);
    if (!row) return null;
    const set = next(row.watch);
    if (!set) return row.watch;
    const [written] = await db
      .update(watches)
      .set(set)
      .where(and(eq(watches.id, row.watch.id), sql`${watches.alertState} IS ${row.raw}`))
      .returning();
    if (written) return written;
  }
  throw new Error('watch_save_raced');
}

export async function removeWatch(db: Db, userId: string, watchId: string): Promise<boolean> {
  const removed = await db
    .delete(watches)
    .where(and(eq(watches.id, watchId), eq(watches.userId, userId)))
    .returning({ id: watches.id });
  return removed.length > 0;
}

/** A person's watches of one item. */
export async function watchesOf(db: Db, userId: string, productId: string): Promise<Watch[]> {
  return db
    .select()
    .from(watches)
    .where(and(eq(watches.userId, userId), eq(watches.productId, productId)))
    .orderBy(asc(watches.createdAt));
}

/** A person's watchlist with each item, oldest first. */
export async function listWatches(
  db: Db,
  userId: string,
): Promise<{ watch: Watch; product: Product }[]> {
  return db
    .select({ watch: watches, product: products })
    .from(watches)
    .innerJoin(products, eq(products.id, watches.productId))
    .where(eq(watches.userId, userId))
    .orderBy(asc(watches.createdAt));
}

/** Conditions anyone watches an item in (what collectors should cover, with owned ones). */
export async function watchedBuckets(db: Db, productId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ bucket: watches.bucket })
    .from(watches)
    .where(eq(watches.productId, productId));
  return rows.map((r) => r.bucket).filter(Boolean);
}
