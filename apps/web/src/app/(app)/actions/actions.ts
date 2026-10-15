'use server';

import {
  CONDITIONS,
  type CardGrade,
  type Condition,
  type ProductClass,
  toLocalIso,
} from '@tora/core';
import {
  changeCondition,
  dismissSourceQuality,
  getHoldingDetail,
  setCardGrade,
  setSourceWarningDismissed,
  userHoldsProduct,
} from '@tora/db';
import { revalidatePath } from 'next/cache';
import { authed } from '@/lib/auth/guard';

/** A grade for one card lot, from the buttons on its Actions card. */
export async function setLotGradeAction(holdingId: string, grade: CardGrade) {
  const { db, user } = await authed();
  await setCardGrade(db, user.id, [holdingId], grade);
  revalidatePath('/', 'layout');
}

/** A condition for a whole lot (all its units), from the buttons on its Actions card. */
export async function setLotConditionAction(holdingId: string, condition: Condition) {
  if (!CONDITIONS.includes(condition)) return;
  const { db, user } = await authed();
  const detail = await getHoldingDetail(db, user.id, holdingId);
  if (!detail) return;
  await changeCondition(db, user.id, holdingId, {
    quantity: detail.holding.quantity,
    condition,
    occurredAt: toLocalIso(),
  });
  revalidatePath('/', 'layout');
}

/** Stops (or restarts) the "not linked to its main source" warning for one of the user's items. */
export async function setSourceWarningAction(productId: string, dismiss: boolean) {
  const { db, user } = await authed();
  if (!(await userHoldsProduct(db, user.id, productId))) return;
  await setSourceWarningDismissed(db, user.id, productId, dismiss);
  revalidatePath('/', 'layout');
}

/** Dismisses a source quality notice (admins): the source stays comparison only for the class. */
export async function dismissSourceQualityAction(source: string, cls: ProductClass) {
  const { db, user } = await authed();
  if (user.role !== 'admin') return;
  await dismissSourceQuality(db, source, cls);
  revalidatePath('/', 'layout');
}
