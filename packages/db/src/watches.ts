import { deriveBucket, productClass } from '@tora/core';
import { and, asc, eq } from 'drizzle-orm';
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
  const values = fields(product, input);
  const [watch] = await db
    .insert(watches)
    .values({ userId, productId: product.id, ...values })
    .onConflictDoUpdate({
      target: [watches.userId, watches.productId, watches.bucket],
      set: { targetPriceBase: values.targetPriceBase, note: values.note },
    })
    .returning();
  return { watch: watch!, product };
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
  const [watch] = await db.update(watches).set(values).where(eq(watches.id, watchId)).returning();
  return watch!;
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
