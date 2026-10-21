// A budget and a date (requirements S13 part 4): the items a person may plan to buy, each with
// when and at what price, from its saved buy timing numbers and the person's strategy.
import {
  type PlanStep,
  localDate,
  planStep,
  productClass,
  rankOpportunity,
  strategyOf,
} from '@tora/core';
import { eq, inArray } from 'drizzle-orm';
import type { Db } from './client';
import { readSetting } from './registry';
import { type Product, type User, products, watches } from './schema';
import type { SavedOpportunities } from './opportunities';
import { latestSignals } from './signals';

export interface PlanItem {
  productId: string;
  bucket: string;
  product: Product;
  step: PlanStep;
  /** Why it is offered: a proven opportunity, a watch, or already in the plan. */
  from: ('opportunity' | 'watch' | 'plan')[];
  ticked: boolean;
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
  const saved = await readSetting<SavedOpportunities>(db, 'opportunities');
  for (const o of saved?.items ?? []) {
    if (rankOpportunity(o.on, saved!.tests[o.group]).proven.length) {
      add(o.productId, o.bucket, 'opportunity');
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
    const stats = signals.get(`${w.productId}|${w.bucket}`)?.stats;
    const step: PlanStep = stats
      ? planStep(stats, strategyOf(user.preferences, productClass(product)), today)
      : { when: 'none', day: null, price: null, reason: 'no_price' };
    return [{ ...w, product, step, ticked: ticked.has(`${w.productId}|${w.bucket}`) }];
  });
}
