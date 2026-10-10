'use server';

import {
  ACQUISITION_TYPES,
  CONDITIONS,
  GRADERS,
  PACKAGING_STATES,
  RAW_GRADES,
  tokyoDateToIso,
} from '@tora/core';
import {
  type Db,
  addNote,
  addPull,
  changeCondition,
  deleteHolding,
  editHolding,
  markOrderCancelled,
  markOpened,
  productLots,
  returnGrading,
  sellHolding,
  splitOff,
  submitGrading,
  suggestFromKnownProducts,
  updateProduct,
} from '@tora/db';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { type Session, authed } from '@/lib/auth/guard';
import {
  type FormState,
  dateText,
  optEnum,
  optText,
  optYen,
  parseForm,
  qty,
  reqEnum,
  reqText,
  runDomain,
  yen,
} from '@/lib/form';
import { productInputFrom, productSchema } from '@/lib/schemas';

const holdingPath = (id: string) => `/holdings/${id}`;
const at = (date: string) => tokyoDateToIso(date);

/** Parse, run the mutation as the signed-in user, then go back to the holding page (or `to`). */
async function handle<S extends z.ZodType, T>(
  formData: FormData,
  schema: S,
  run: (data: z.infer<S>, ctx: { db: Db; userId: string; session: Session }) => Promise<T>,
  to: (value: T) => string,
): Promise<FormState> {
  const session = await authed();
  const parsed = parseForm(schema, formData);
  if ('state' in parsed) return parsed.state;
  const result = await runDomain(() =>
    run(parsed.data, { db: session.db, userId: session.user.id, session }),
  );
  if (!result.ok) return result.state;
  revalidatePath('/', 'layout');
  redirect(to(result.value));
}

export async function editAction(id: string, _prev: FormState, formData: FormData) {
  return handle(
    formData,
    z.object({
      acquiredAt: dateText,
      acquiredFrom: optText,
      acquisitionType: reqEnum(ACQUISITION_TYPES),
      quantity: qty,
      costTotalJpy: yen,
      certNumber: optText,
      orderId: optText,
      notes: optText,
    }),
    (d, { db, userId }) =>
      editHolding(db, userId, id, {
        ...d,
        // Keep the original time of day when the date did not change.
        acquiredAt: d.acquiredAt === formData.get('originalDate') ? undefined : at(d.acquiredAt),
        acquiredFrom: d.acquiredFrom ?? null,
        certNumber: d.certNumber ?? null,
        orderId: d.orderId ?? null,
        notes: d.notes ?? null,
      }),
    () => holdingPath(id),
  );
}

export async function splitAction(id: string, _prev: FormState, formData: FormData) {
  return handle(
    formData,
    z.object({ quantity: qty, date: dateText }),
    (d, { db, userId }) => splitOff(db, userId, id, d.quantity, at(d.date)),
    (split) => holdingPath(split.id),
  );
}

export async function openAction(id: string, _prev: FormState, formData: FormData) {
  return handle(
    formData,
    z.object({ quantity: qty, packagingState: reqEnum(PACKAGING_STATES), date: dateText }),
    (d, { db, userId }) =>
      markOpened(db, userId, id, {
        quantity: d.quantity,
        packagingState: d.packagingState,
        occurredAt: at(d.date),
      }),
    (h) => holdingPath(h.id),
  );
}

export async function gradeSubmitAction(id: string, _prev: FormState, formData: FormData) {
  return handle(
    formData,
    z.object({
      quantity: qty,
      grader: reqEnum(GRADERS),
      feeJpy: yen,
      service: optText,
      date: dateText,
    }),
    (d, { db, userId }) =>
      submitGrading(db, userId, id, {
        quantity: d.quantity,
        grader: d.grader,
        feeJpy: d.feeJpy,
        service: d.service,
        occurredAt: at(d.date),
      }),
    (h) => holdingPath(h.id),
  );
}

export async function gradeReturnAction(id: string, _prev: FormState, formData: FormData) {
  return handle(
    formData,
    z.object({
      grader: reqEnum(GRADERS),
      grade: reqText,
      certNumber: optText,
      extraFeeJpy: optYen,
      date: dateText,
    }),
    (d, { db, userId }) =>
      returnGrading(db, userId, id, {
        grader: d.grader,
        grade: d.grade,
        certNumber: d.certNumber,
        extraFeeJpy: d.extraFeeJpy,
        occurredAt: at(d.date),
      }),
    (h) => holdingPath(h.id),
  );
}

export async function sellAction(id: string, _prev: FormState, formData: FormData) {
  return handle(
    formData,
    z.object({
      quantity: qty,
      priceJpy: yen,
      feesJpy: optYen,
      platform: optText,
      date: dateText,
    }),
    (d, { db, userId }) =>
      sellHolding(db, userId, id, {
        quantity: d.quantity,
        priceJpy: d.priceJpy,
        feesJpy: d.feesJpy ?? 0,
        platform: d.platform,
        occurredAt: at(d.date),
      }),
    (h) => holdingPath(h.id),
  );
}

export async function conditionAction(id: string, _prev: FormState, formData: FormData) {
  return handle(
    formData,
    z.object({
      quantity: qty,
      condition: optEnum(CONDITIONS),
      rawGrade: optEnum(RAW_GRADES),
      packagingState: optEnum(PACKAGING_STATES),
      date: dateText,
    }),
    (d, { db, userId }) => changeCondition(db, userId, id, { ...d, occurredAt: at(d.date) }),
    (h) => holdingPath(h.id),
  );
}

export async function noteAction(id: string, _prev: FormState, formData: FormData) {
  return handle(
    formData,
    z.object({ text: reqText, date: dateText }),
    (d, { db, userId }) => addNote(db, userId, id, { text: d.text, occurredAt: at(d.date) }),
    () => holdingPath(id),
  );
}

export async function deleteAction(id: string, _prev: FormState, formData: FormData) {
  return handle(
    formData,
    z.object({ confirm: z.literal('on') }),
    (_d, { db, userId }) => deleteHolding(db, userId, id),
    () => '/',
  );
}

/** The whole order was cancelled: removes its lots and makes imports skip the order ID. */
export async function cancelOrderAction(id: string, _prev: FormState, formData: FormData) {
  return handle(
    formData,
    z.object({ confirm: z.literal('on') }),
    async (_d, { db, userId }) => {
      const { productId } = await markOrderCancelled(db, userId, id);
      return (await productLots(db, userId, productId)).length ? `/products/${productId}` : '/';
    },
    (to) => to,
  );
}

export async function editProductAction(
  productId: string,
  backTo: string,
  _prev: FormState,
  formData: FormData,
) {
  const parsed = parseForm(productSchema, formData);
  if ('state' in parsed) return parsed.state;
  const input = productInputFrom(parsed.data);
  if (!input) return { error: 'check', fields: ['name'] };
  return handle(
    formData,
    z.object({}),
    (_d, { db, session }) => updateProduct(db, session.user, productId, input),
    () => (backTo.startsWith('/holdings/') ? backTo : '/'),
  );
}

export type PullState = FormState & { added?: number };

/** Rapid pull entry: stays on the page (no redirect) so the next card can be typed at once. */
export async function addPullAction(
  boxId: string,
  prev: PullState,
  formData: FormData,
): Promise<PullState> {
  const { db, user } = await authed();
  const parsed = parseForm(
    z.object({
      productId: optText,
      name: optText,
      cardNumber: optText,
      rarity: optText,
      rawGrade: reqEnum(RAW_GRADES),
      quantity: qty,
      date: dateText,
    }),
    formData,
  );
  if ('state' in parsed) return parsed.state;
  const d = parsed.data;
  const ref = d.productId
    ? { productId: d.productId }
    : d.name
      ? { card: { name: d.name, cardNumber: d.cardNumber ?? null, rarity: d.rarity ?? null } }
      : null;
  if (!ref) return { error: 'check', fields: ['name'] };

  const result = await runDomain(() =>
    addPull(db, user.id, boxId, ref, {
      quantity: d.quantity,
      rawGrade: d.rawGrade,
      acquiredAt: at(d.date),
    }),
  );
  if (!result.ok) return result.state;
  // Offer a linked look-alike's listing right away (no need to wait for the collector).
  await suggestFromKnownProducts(db, result.value.product.id);
  revalidatePath(holdingPath(boxId));
  revalidatePath('/');
  return { added: (prev.added ?? 0) + 1 };
}
