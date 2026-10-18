import 'server-only';
import {
  getProduct,
  holdingBucket,
  latestSignals,
  productLots,
  valueHoldings,
  watchesOf,
} from '@tora/db';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { authed } from '@/lib/auth/guard';

/**
 * The item, the person's lots and watches of it, and its main condition: what the header and
 * every sub page need (S22). Cached per request, so the layout and the page read it once.
 * Shown to people who hold or watch it.
 */
export const loadItem = cache(async (id: string) => {
  const { db, user } = await authed();
  const [product, lots, watches] = await Promise.all([
    getProduct(db, id),
    productLots(db, user.id, id),
    watchesOf(db, user.id, id),
  ]);
  if (!product || (lots.length === 0 && watches.length === 0)) notFound();
  const owned = lots.filter((h) => h.status === 'owned');
  // The main condition: the one most of the owned units are in, else the one first watched.
  const unitsByBucket = new Map<string, number>();
  for (const h of owned) {
    const b = holdingBucket(h, product);
    if (b) unitsByBucket.set(b, (unitsByBucket.get(b) ?? 0) + h.quantity);
  }
  const mainBucket =
    [...unitsByBucket].sort((a, b) => b[1] - a[1])[0]?.[0] ?? (watches[0]?.bucket || null);
  return { db, user, product, lots, watches, owned, mainBucket };
});

/**
 * Today's buy timing numbers in a condition, the main one by default (null before the first
 * collect).
 */
export const loadSignal = cache(async (id: string, condition?: string | null) => {
  const { db, product, mainBucket } = await loadItem(id);
  const bucket = condition === undefined ? mainBucket : condition;
  const rows = await latestSignals(db, [{ productId: product.id, bucket }]);
  return rows.get(`${product.id}|${bucket ?? ''}`)?.stats ?? null;
});

/**
 * Each owned lot's value and the totals, by each lot's tracking switches (S8): spent counts lots
 * counted in cost, value those counted in value, P/L those counted in both. Opened items keep
 * their cost (their value moved to the pulls logged from them).
 */
export const loadValues = cache(async (id: string) => {
  const { db, user, product, lots, owned } = await loadItem(id);
  const valuations = await valueHoldings(
    db,
    user.id,
    owned.map((holding) => ({ holding, product })),
  );
  const values = new Map(owned.map((h) => [h.id, valuations.get(h.id)?.valueBase ?? null]));
  const units = owned.reduce((n, h) => n + h.quantity, 0);
  const opened = lots.filter((h) => h.status === 'consumed' && h.countInCost);
  const openedCost = opened.reduce((n, h) => n + h.costTotalBase, 0);
  const spent =
    owned.filter((h) => h.countInCost).reduce((n, h) => n + h.costTotalBase, 0) + openedCost;
  const valued = owned.filter((h) => h.countInValue && values.get(h.id) != null);
  const value = valued.reduce((n, h) => n + values.get(h.id)!, 0);
  const inPl = valued.filter((h) => h.countInCost);
  const openedInPl = opened.filter((h) => h.countInValue).reduce((n, h) => n + h.costTotalBase, 0);
  const pl =
    inPl.length || openedInPl
      ? inPl.reduce((n, h) => n + values.get(h.id)! - h.costTotalBase, 0) - openedInPl
      : null;
  return {
    values,
    units,
    spent,
    /** Null when no lot has a value. */
    value: valued.length || openedCost ? value : null,
    pl,
    valued: valued.length,
  };
});
