'use server';

import { setPreferences } from '@tora/db';
import { revalidatePath } from 'next/cache';
import { authed } from '@/lib/auth/guard';
import { type CardsFilter, cleanFilter, loadCards } from './cards';

/** Saves the person's budget, date and ticked items (S13 part 4). */
export async function savePlanAction(plan: {
  budget: number;
  until: string;
  items: { productId: string; bucket: string }[];
}): Promise<{ error?: string }> {
  const { db, user } = await authed();
  const budget = Math.round(Number(plan.budget));
  if (!Number.isFinite(budget) || budget < 0) return { error: 'budget' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(plan.until))) return { error: 'until' };
  const items = (Array.isArray(plan.items) ? plan.items : [])
    .filter((i) => i && typeof i.productId === 'string' && typeof i.bucket === 'string')
    .slice(0, 200)
    .map((i) => ({ productId: i.productId, bucket: i.bucket }));
  await setPreferences(db, user.id, { buyPlan: { budget, until: plan.until, items } });
  revalidatePath('/opportunities', 'layout');
  return {};
}

/** The next rows of the Worth a look list (S26), from `offset`. */
export async function moreOpportunitiesAction(filter: CardsFilter, offset: number) {
  const { db, user } = await authed();
  const data = await loadCards(
    db,
    user,
    cleanFilter(filter ?? {}),
    Math.max(0, Math.floor(Number(offset)) || 0),
  );
  return data?.rows ?? [];
}
