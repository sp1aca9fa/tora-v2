// The spread check (requirements S27 step 6): the items worth a look a person may be offered, by
// item type and set, to point to the groups their collection holds little of.
import { suggestsCondition } from '@tora/core';
import { inArray } from 'drizzle-orm';
import type { Db } from './client';
import { loadOpportunities, withMarket, worthALook } from './opportunities';
import { type User, products } from './schema';

/** A product's set for the spread: its set name, else its code; null for none. */
export const spreadSet = (p: { setName: string | null; setCode: string | null }) =>
  p.setName ?? p.setCode ?? null;

/** Items worth a look today, as on Worth a look (the person's conditions), by type and by set. */
export async function worthByGroup(
  db: Db,
  user: User,
): Promise<{ types: Map<string, number>; sets: Map<string, number> }> {
  const types = new Map<string, number>();
  const sets = new Map<string, number>();
  const saved = await loadOpportunities(db);
  if (!saved) return { types, sets };
  const worth = withMarket(saved.items, saved.rules).adjusted.filter(
    (o) => suggestsCondition(user.preferences, o.itemType, o.bucket) && worthALook(o),
  );
  const ids = [...new Set(worth.map((o) => o.productId))];
  const setOf = new Map<string, string | null>();
  for (let i = 0; i < ids.length; i += 500) {
    for (const p of await db
      .select({ id: products.id, setName: products.setName, setCode: products.setCode })
      .from(products)
      .where(inArray(products.id, ids.slice(i, i + 500)))) {
      setOf.set(p.id, spreadSet(p));
    }
  }
  // An item counts once per group, whatever conditions of it are worth a look.
  const seen = new Set<string>();
  for (const o of worth) {
    if (!seen.has(`t|${o.itemType}|${o.productId}`)) {
      seen.add(`t|${o.itemType}|${o.productId}`);
      types.set(o.itemType, (types.get(o.itemType) ?? 0) + 1);
    }
    const set = setOf.get(o.productId);
    if (set && !seen.has(`s|${o.productId}`)) {
      seen.add(`s|${o.productId}`);
      sets.set(set, (sets.get(set) ?? 0) + 1);
    }
  }
  return { types, sets };
}
