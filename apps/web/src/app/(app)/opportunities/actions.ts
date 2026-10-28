'use server';

import {
  type PopularBy,
  POPULAR_BY,
  recordAdminChange,
  setPreferences,
  setSignalPick,
} from '@tora/db';
import { revalidatePath } from 'next/cache';
import { authed } from '@/lib/auth/guard';
import { type CardsFilter, cleanFilter, cleanSearch, loadCards } from './cards';
import { loadPopular } from './popular-rows';

/** Saves the person's budget, date and ticked items (S13 part 4). */
export async function savePlanAction(plan: {
  budget: number;
  until: string;
  items: { productId: string; bucket: string }[];
}): Promise<{ error?: string }> {
  const { db, user } = await authed();
  const budget = Math.round(Number(plan.budget));
  if (!Number.isFinite(budget) || budget < 0) return { error: 'budget' };
  // The date is optional: '' for none.
  if (plan.until && !/^\d{4}-\d{2}-\d{2}$/.test(String(plan.until))) return { error: 'until' };
  const items = (Array.isArray(plan.items) ? plan.items : [])
    .filter((i) => i && typeof i.productId === 'string' && typeof i.bucket === 'string')
    .slice(0, 200)
    .map((i) => ({ productId: i.productId, bucket: i.bucket }));
  await setPreferences(db, user.id, { buyPlan: { budget, until: plan.until, items } });
  revalidatePath('/opportunities', 'layout');
  return {};
}

/**
 * Shows a signal plug-in's signal as the admin's pick while not proven, or stops (S27, admins):
 * items it is on then come after the proven ones, apart and labeled.
 */
export async function pickSignalAction(signal: string, picked: boolean) {
  const { db, user } = await authed();
  if (user.role !== 'admin') return;
  const key = String(signal);
  if (!/^[a-z0-9_]{1,40}$/.test(key)) return;
  await setSignalPick(db, key, picked === true);
  await recordAdminChange(
    db,
    user.id,
    picked === true ? 'signalPicked' : 'signalUnpicked',
    { signal: key },
    '/opportunities/signals',
  );
  revalidatePath('/opportunities', 'layout');
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

/** The next rows of Popular ranked by trades (S27), from `offset`, of a name search if any. */
export async function morePopularAction(
  type: string,
  by: string,
  offset: number,
  q: string | null = null,
) {
  const { db, user } = await authed();
  const measure = (POPULAR_BY as readonly string[]).includes(by) ? (by as PopularBy) : 'sold';
  const data = await loadPopular(
    db,
    user,
    typeof type === 'string' ? type.slice(0, 40) : null,
    measure,
    Math.max(0, Math.floor(Number(offset)) || 0),
    cleanSearch(q),
  );
  return data.rows;
}
