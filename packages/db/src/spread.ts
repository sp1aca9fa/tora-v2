// The spread check (requirements S27 step 6): the items worth a look a person may be offered, by
// item type and set, to point to the groups their collection holds little of.
import { spreadSetKey, suggestsCondition } from '@tora/core';
import { inArray } from 'drizzle-orm';
import type { Db } from './client';
import { loadOpportunities, withMarket, worthALook } from './opportunities';
import { type User, products } from './schema';

/**
 * Items worth a look in the last saved run (its day), as on Worth a look (the person's
 * conditions): how many per type, and per set (`spreadSetKey`, the franchise through
 * `franchiseOf` as the lots') with their types.
 */
export async function worthByGroup(
  db: Db,
  user: User,
  franchiseOf: (franchise: string | null) => string | null = (f) => f,
): Promise<{
  day: string | null;
  types: Map<string, number>;
  sets: Map<string, { count: number; types: Set<string> }>;
}> {
  const types = new Map<string, number>();
  const sets = new Map<string, { count: number; types: Set<string> }>();
  const saved = await loadOpportunities(db);
  if (!saved) return { day: null, types, sets };
  const worth = withMarket(saved.items, saved.rules).adjusted.filter(
    (o) => suggestsCondition(user.preferences, o.itemType, o.bucket) && worthALook(o),
  );
  const ids = [...new Set(worth.map((o) => o.productId))];
  const setOf = new Map<string, string | null>();
  for (let i = 0; i < ids.length; i += 500) {
    for (const p of await db
      .select({
        id: products.id,
        franchise: products.franchise,
        setName: products.setName,
        setCode: products.setCode,
      })
      .from(products)
      .where(inArray(products.id, ids.slice(i, i + 500)))) {
      setOf.set(p.id, spreadSetKey(franchiseOf(p.franchise), p.setName, p.setCode));
    }
  }
  // An item counts once per group, whatever conditions of it are worth a look.
  const seen = new Set<string>();
  for (const o of worth) {
    if (seen.has(o.productId)) continue;
    seen.add(o.productId);
    types.set(o.itemType, (types.get(o.itemType) ?? 0) + 1);
    const set = setOf.get(o.productId);
    if (set) {
      const s = sets.get(set) ?? { count: 0, types: new Set<string>() };
      s.count++;
      s.types.add(o.itemType);
      sets.set(set, s);
    }
  }
  return { day: saved.day, types, sets };
}
