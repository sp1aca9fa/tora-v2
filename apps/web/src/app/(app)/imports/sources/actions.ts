'use server';

import { setSourceWarningDismissed, userHoldsProduct } from '@tora/db';
import { revalidatePath } from 'next/cache';
import { authed } from '@/lib/auth/guard';

/** Stops (or restarts) the "not linked to its main source" warning for one of the user's items. */
export async function setSourceWarningAction(productId: string, dismiss: boolean) {
  const { db, user } = await authed();
  if (!(await userHoldsProduct(db, user.id, productId))) return;
  await setSourceWarningDismissed(db, user.id, productId, dismiss);
  revalidatePath('/', 'layout');
}
