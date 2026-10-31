// The admin's categories (requirements S16 part 3): how many items use each part, what a change
// touches, and saving it (items follow: item types, removed fields and values cleared).
import { type Taxonomy, checkTaxonomy, conditionListOf, itemTypeKey } from '@tora/core';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { Db } from './client';
import { DomainError } from './mutations';
import { loadSourceRegistry, setTaxonomy } from './registry';
import { holdings, products } from './schema';

/** Items per category, kind, custom field and choice; lots per condition-list value. */
export interface CategoryUsage {
  categories: Record<string, number>;
  /** `{category}/{kind}` */
  kinds: Record<string, number>;
  /** `{category}/{field}` */
  fields: Record<string, number>;
  /** `{category}/{field}/{choice}` */
  choices: Record<string, number>;
  /** `{list}/{value}`: lots */
  values: Record<string, number>;
  /** `{category}/{region}` */
  regions: Record<string, number>;
}

export async function categoryUsage(db: Db): Promise<CategoryUsage> {
  const usage: CategoryUsage = {
    categories: {},
    kinds: {},
    fields: {},
    choices: {},
    values: {},
    regions: {},
  };
  const add = (map: Record<string, number>, key: string, n = 1) => {
    map[key] = (map[key] ?? 0) + n;
  };
  for (const r of await db
    .select({ category: products.category, kind: products.kind, n: sql<number>`count(*)` })
    .from(products)
    .groupBy(products.category, products.kind)) {
    add(usage.categories, r.category, Number(r.n));
    add(usage.kinds, `${r.category}/${r.kind}`, Number(r.n));
  }
  for (const r of await db
    .select({ category: products.category, region: products.region, n: sql<number>`count(*)` })
    .from(products)
    .where(isNotNull(products.region))
    .groupBy(products.category, products.region)) {
    add(usage.regions, `${r.category}/${r.region}`, Number(r.n));
  }
  for (const p of await db
    .select({ category: products.category, fields: products.fields })
    .from(products)
    .where(isNotNull(products.fields))) {
    for (const [k, v] of Object.entries(p.fields ?? {})) {
      add(usage.fields, `${p.category}/${k}`);
      if (typeof v === 'string') add(usage.choices, `${p.category}/${k}/${v}`);
    }
  }
  for (const r of await db
    .select({ type: products.itemType, value: holdings.conditionValue, n: sql<number>`count(*)` })
    .from(holdings)
    .innerJoin(products, eq(products.id, holdings.productId))
    .where(isNotNull(holdings.conditionValue))
    .groupBy(products.itemType, holdings.conditionValue)) {
    add(usage.values, `${conditionListOf(r.type ?? '')}/${r.value}`, Number(r.n));
  }
  return usage;
}

/** What saving `next` over `prev` would do to registered items. */
export interface TaxonomyChange {
  /** Problems that stop the save (codes for the app's texts). */
  blocked: string[];
  /** Items or lots whose data changes, by reason: `{ code, name, count }`. */
  touched: { code: string; name: string; count: number }[];
}

export function taxonomyChange(
  prev: Taxonomy,
  next: Taxonomy,
  usage: CategoryUsage,
): TaxonomyChange {
  const blocked = checkTaxonomy(next);
  const touched: TaxonomyChange['touched'] = [];
  for (const before of prev.categories) {
    const after = next.categories.find((c) => c.key === before.key);
    if (!after) {
      if (usage.categories[before.key]) blocked.push('category_in_use');
      continue;
    }
    for (const k of before.kinds) {
      const n = usage.kinds[`${before.key}/${k.key}`] ?? 0;
      const now = after.kinds.find((x) => x.key === k.key);
      if (!now) {
        if (n) blocked.push('kind_in_use');
      } else if (now.conditions !== k.conditions && n) {
        touched.push({ code: 'kind_list', name: `${before.key}/${k.key}`, count: n });
      }
    }
    for (const r of before.regions ?? []) {
      const n = usage.regions[`${before.key}/${r}`] ?? 0;
      if (n && !after.regions?.includes(r)) {
        touched.push({ code: 'region_removed', name: `${before.key}: ${r}`, count: n });
      }
    }
    for (const f of before.fields.filter((x) => !x.standard)) {
      const n = usage.fields[`${before.key}/${f.key}`] ?? 0;
      const now = after.fields.find((x) => x.key === f.key);
      if (!now) {
        if (n) touched.push({ code: 'field_removed', name: f.key, count: n });
        continue;
      }
      for (const c of f.choices ?? []) {
        const m = usage.choices[`${before.key}/${f.key}/${c.key}`] ?? 0;
        if (m && !now.choices?.some((x) => x.key === c.key)) {
          touched.push({ code: 'choice_removed', name: `${f.key}: ${c.key}`, count: m });
        }
      }
    }
  }
  for (const l of prev.lists.filter((x) => !x.builtIn)) {
    const now = next.lists.find((x) => x.key === l.key);
    for (const v of l.values) {
      const n = usage.values[`${l.key}/${v.key}`] ?? 0;
      if (n && !now?.values.some((x) => x.key === v.key)) {
        touched.push({ code: 'value_removed', name: `${l.key}: ${v.key}`, count: n });
      }
    }
  }
  return { blocked: [...new Set(blocked)], touched };
}

/**
 * Saves the admin's categories. Refused when blocked, or when it touches items and `confirmed`
 * is not set. Items follow: each kind's item type, removed custom fields and choices, removed
 * condition values (those lots get no value until a new one is set). Returns what it touched.
 */
export async function saveTaxonomy(
  db: Db,
  next: Taxonomy,
  confirmed: boolean,
): Promise<TaxonomyChange> {
  const prev = (await loadSourceRegistry(db)).taxonomy!;
  const change = taxonomyChange(prev, next, await categoryUsage(db));
  if (change.blocked.length) throw new DomainError('invalid_input');
  if (change.touched.length && !confirmed) return change;

  // All or nothing, the setting last: items never follow a taxonomy that was not saved.
  await db.transaction(async (tx) => {
    // Removed custom fields, choices and regions leave the items.
    for (const c of next.categories) {
      const removed = (prev.categories.find((x) => x.key === c.key)?.regions ?? []).filter(
        (r) => !c.regions?.includes(r),
      );
      if (removed.length)
        await tx
          .update(products)
          .set({ region: null })
          .where(and(eq(products.category, c.key), inArray(products.region, removed)));
      const keep = new Map(
        c.fields.filter((f) => !f.standard).map((f) => [f.key, f.choices?.map((x) => x.key)]),
      );
      const rows = await tx
        .select({ id: products.id, fields: products.fields })
        .from(products)
        .where(and(eq(products.category, c.key), isNotNull(products.fields)));
      for (const r of rows) {
        const fields = Object.fromEntries(
          Object.entries(r.fields ?? {}).filter(([k, v]) => {
            if (!keep.has(k)) return false;
            const choices = keep.get(k);
            return !choices || typeof v !== 'string' || choices.includes(v);
          }),
        );
        if (Object.keys(fields).length !== Object.keys(r.fields ?? {}).length) {
          await tx
            .update(products)
            .set({ fields: Object.keys(fields).length ? fields : null })
            .where(eq(products.id, r.id));
        }
      }
      // Each kind's item type (its condition list may have changed).
      for (const k of c.kinds) {
        await tx
          .update(products)
          .set({ itemType: itemTypeKey(c.key, k.conditions) })
          .where(and(eq(products.category, c.key), eq(products.kind, k.key)));
      }
    }
    // Lots keep only values their item's list still has.
    const values = new Map(
      next.lists.filter((l) => !l.builtIn).map((l) => [l.key, l.values.map((v) => v.key)]),
    );
    const lots = await tx
      .select({ id: holdings.id, value: holdings.conditionValue, type: products.itemType })
      .from(holdings)
      .innerJoin(products, eq(products.id, holdings.productId))
      .where(isNotNull(holdings.conditionValue));
    for (const lot of lots) {
      if (!values.get(conditionListOf(lot.type ?? ''))?.includes(lot.value!)) {
        await tx.update(holdings).set({ conditionValue: null }).where(eq(holdings.id, lot.id));
      }
    }
    await setTaxonomy(tx, next);
  });
  return change;
}
