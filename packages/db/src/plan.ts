// A budget and a date (requirements S13 part 4): the items a person may plan to buy, each with
// when and at what price, from its saved buy timing numbers and the person's strategy.
import {
  type OpportunitySignal,
  type PlanStep,
  deriveBucket,
  localDate,
  planStep,
  productClass,
  strategyOf,
  suggestsCondition,
} from '@tora/core';
import { and, eq, inArray, like } from 'drizzle-orm';
import type { Db } from './client';
import { type Product, type User, holdings, products, watches } from './schema';
import { loadOpportunities, withMarket, worthALook } from './opportunities';
import { latestSignals } from './signals';

export interface PlanItem {
  productId: string;
  bucket: string;
  product: Product;
  step: PlanStep;
  /**
   * Why it is offered: a proven opportunity, a watch, or already in the plan; none for the other
   * items a suggested mix may pick (S27).
   */
  from: ('opportunity' | 'watch' | 'plan')[];
  ticked: boolean;
  /** For a suggested mix (S27): its item type and set, worth a look, its score and signals. */
  mix: {
    type: string;
    set: string;
    worth: boolean;
    score: number;
    signals: OpportunitySignal[];
  };
}

/**
 * The items to plan with: those with a proven opportunity signal, the person's watches and what
 * their plan holds; each with its step (when, at what price) when buy timing numbers are saved.
 */
export async function buyPlanFor(db: Db, user: User, now = new Date()): Promise<PlanItem[]> {
  const wanted = new Map<string, { productId: string; bucket: string; from: PlanItem['from'] }>();
  const add = (productId: string, bucket: string, from: PlanItem['from'][number]) => {
    const key = `${productId}|${bucket}`;
    const had = wanted.get(key);
    if (had) {
      if (!had.from.includes(from)) had.from.push(from);
    } else wanted.set(key, { productId, bucket, from: [from] });
  };
  const saved = await loadOpportunities(db);
  const opportunities = saved ? withMarket(saved.items, saved.rules).adjusted : [];
  const ranked = new Map(opportunities.map((o) => [`${o.productId}|${o.bucket}`, o]));
  for (const o of opportunities) {
    // Conditions the person doesn't want suggested stay out (their watches and plan still come in).
    if (!suggestsCondition(user.preferences, o.itemType, o.bucket)) continue;
    if (worthALook(o)) add(o.productId, o.bucket, 'opportunity');
    // Every other item can come into a suggested mix.
    else if (!wanted.has(`${o.productId}|${o.bucket}`)) {
      wanted.set(`${o.productId}|${o.bucket}`, {
        productId: o.productId,
        bucket: o.bucket,
        from: [],
      });
    }
  }
  for (const w of await db
    .select({ productId: watches.productId, bucket: watches.bucket })
    .from(watches)
    .where(eq(watches.userId, user.id))) {
    add(w.productId, w.bucket, 'watch');
  }
  const plan = user.preferences?.buyPlan;
  const ticked = new Set((plan?.items ?? []).map((i) => `${i.productId}|${i.bucket}`));
  for (const i of plan?.items ?? []) add(i.productId, i.bucket, 'plan');
  const list = [...wanted.values()];
  if (!list.length) return [];
  const ids = [...new Set(list.map((w) => w.productId))];
  const byId = new Map<string, Product>();
  for (let i = 0; i < ids.length; i += 500) {
    for (const p of await db
      .select()
      .from(products)
      .where(inArray(products.id, ids.slice(i, i + 500)))) {
      byId.set(p.id, p);
    }
  }
  const signals = await latestSignals(
    db,
    list.map((w) => ({ productId: w.productId, bucket: w.bucket || null })),
    now,
  );
  const today = localDate(now);
  return list.flatMap((w) => {
    const product = byId.get(w.productId);
    if (!product) return [];
    const row = signals.get(`${w.productId}|${w.bucket}`);
    // The row may be a few days old: its age is on its own day.
    const step: PlanStep = row
      ? planStep(row.stats, strategyOf(user.preferences, productClass(product)), today, row.day)
      : { when: 'none', day: null, price: null, reason: 'no_price' };
    const o = ranked.get(`${w.productId}|${w.bucket}`);
    return [
      {
        ...w,
        product,
        step,
        ticked: ticked.has(`${w.productId}|${w.bucket}`),
        mix: {
          type: productClass(product),
          // Its set (a single's, a box's): a mix holds one of each; an item without one is its own.
          set: product.setId ?? product.setCode ?? product.id,
          worth: !!o && worthALook(o),
          score: o?.score ?? 0,
          signals: o ? [...o.proven, ...o.picked] : [],
        },
      },
    ];
  });
}

/**
 * What a person bought in a month (S27, a monthly plan): their lots acquired that month by
 * purchase and counted in cost (not things bought to use; sold since or not), at cost in the base
 * currency. `keys`: each lot's `productId|bucket` and `productId|` (a plan item in any condition).
 * `noCost`: lots with no cost written (counted as 0). `month` is `YYYY-MM` in the admin's time
 * zone, as lots' acquired times are written.
 */
export async function spentInMonth(
  db: Db,
  userId: string,
  month: string,
): Promise<{ total: number; lots: number; noCost: number; keys: string[] }> {
  const rows = await db
    .select({ holding: holdings, product: products })
    .from(holdings)
    .innerJoin(products, eq(products.id, holdings.productId))
    .where(
      and(
        eq(holdings.userId, userId),
        eq(holdings.acquisitionType, 'purchase'),
        eq(holdings.countInCost, true),
        like(holdings.acquiredAt, `${month}-%`),
      ),
    );
  const keys = new Set<string>();
  for (const { holding, product } of rows) {
    keys.add(`${product.id}|`);
    const bucket = deriveBucket({ productClass: productClass(product), ...holding });
    if (bucket) keys.add(`${product.id}|${bucket}`);
  }
  return {
    total: rows.reduce((sum, r) => sum + r.holding.costTotalBase, 0),
    lots: rows.length,
    noCost: rows.filter((r) => r.holding.costTotalBase === 0).length,
    keys: [...keys],
  };
}
