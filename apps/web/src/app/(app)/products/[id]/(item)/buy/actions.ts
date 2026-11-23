'use server';

import { DomainError, markNotItem, unmarkNotItem } from '@tora/db';
import { revalidatePath } from 'next/cache';
import { authed } from '@/lib/auth/guard';

// "Not the item" on a game's stored listing (S36 A2). Who may is checked in `markNotItem` and
// `unmarkNotItem` (a wish on the item, or an admin; games only); a refused or stale click changes
// nothing.

async function run(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
  }
}

export async function markNotItemAction(productId: string, source: string, ref: string) {
  const { db, user } = await authed();
  await run(() => markNotItem(db, user, { productId, source, ref }));
  revalidatePath(`/products/${productId}`, 'layout');
}

export async function unmarkNotItemAction(productId: string, source: string, ref: string) {
  const { db, user } = await authed();
  await run(() => unmarkNotItem(db, user, { productId, source, ref }));
  revalidatePath(`/products/${productId}`, 'layout');
}
