'use server';

import {
  ACQUISITION_TYPES,
  CONDITIONS,
  GRADERS,
  PACKAGING_STATES,
  RAW_GRADES,
  hasJapanese,
  tokyoDateToIso,
} from '@tora/core';
import {
  type ProductRef,
  addNote,
  addPull,
  changeCondition,
  deleteHolding,
  editHolding,
  markOpened,
  returnGrading,
  sellHolding,
  splitOff,
  submitGrading,
  updateProduct,
} from '@tora/db';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { authedDb } from '@/lib/auth/guard';
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

/** Parse, run the mutation, then go back to the holding page (or `to`). */
async function handle<S extends z.ZodType, T>(
  formData: FormData,
  schema: S,
  run: (data: z.infer<S>) => Promise<T>,
  to: (value: T) => string,
): Promise<FormState> {
  await authedDb();
  const parsed = parseForm(schema, formData);
  if ('state' in parsed) return parsed.state;
  const result = await runDomain(() => run(parsed.data));
  if (!result.ok) return result.state;
  revalidatePath('/', 'layout');
  redirect(to(result.value));
}

const at = (date: string) => tokyoDateToIso(date);

export async function editAction(id: string, _prev: FormState, formData: FormData) {
  const db = await authedDb();
  return handle(
    formData,
    z.object({
      acquiredAt: dateText,
      acquiredFrom: optText,
      acquisitionType: reqEnum(ACQUISITION_TYPES),
      quantity: qty,
      costTotalJpy: yen,
      certNumber: optText,
      notes: optText,
    }),
    (d) =>
      editHolding(db, id, {
        ...d,
        // Keep the original time of day when the date did not change.
        acquiredAt: d.acquiredAt === formData.get('originalDate') ? undefined : at(d.acquiredAt),
        acquiredFrom: d.acquiredFrom ?? null,
        certNumber: d.certNumber ?? null,
        notes: d.notes ?? null,
      }),
    () => holdingPath(id),
  );
}

export async function splitAction(id: string, _prev: FormState, formData: FormData) {
  const db = await authedDb();
  return handle(
    formData,
    z.object({ quantity: qty, date: dateText }),
    (d) => splitOff(db, id, d.quantity, at(d.date)),
    (split) => holdingPath(split.id),
  );
}

export async function openAction(id: string, _prev: FormState, formData: FormData) {
  const db = await authedDb();
  return handle(
    formData,
    z.object({ quantity: qty, packagingState: reqEnum(PACKAGING_STATES), date: dateText }),
    (d) =>
      markOpened(db, id, {
        quantity: d.quantity,
        packagingState: d.packagingState,
        occurredAt: at(d.date),
      }),
    (h) => holdingPath(h.id),
  );
}

export async function gradeSubmitAction(id: string, _prev: FormState, formData: FormData) {
  const db = await authedDb();
  return handle(
    formData,
    z.object({
      quantity: qty,
      grader: reqEnum(GRADERS),
      feeJpy: yen,
      service: optText,
      date: dateText,
    }),
    (d) =>
      submitGrading(db, id, {
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
  const db = await authedDb();
  return handle(
    formData,
    z.object({
      grader: reqEnum(GRADERS),
      grade: reqText,
      certNumber: optText,
      extraFeeJpy: optYen,
      date: dateText,
    }),
    (d) =>
      returnGrading(db, id, {
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
  const db = await authedDb();
  return handle(
    formData,
    z.object({
      quantity: qty,
      priceJpy: yen,
      feesJpy: optYen,
      platform: optText,
      date: dateText,
    }),
    (d) =>
      sellHolding(db, id, {
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
  const db = await authedDb();
  return handle(
    formData,
    z.object({
      quantity: qty,
      condition: optEnum(CONDITIONS),
      rawGrade: optEnum(RAW_GRADES),
      packagingState: optEnum(PACKAGING_STATES),
      date: dateText,
    }),
    (d) => changeCondition(db, id, { ...d, occurredAt: at(d.date) }),
    (h) => holdingPath(h.id),
  );
}

export async function noteAction(id: string, _prev: FormState, formData: FormData) {
  const db = await authedDb();
  return handle(
    formData,
    z.object({ text: reqText, date: dateText }),
    (d) => addNote(db, id, { text: d.text, occurredAt: at(d.date) }),
    () => holdingPath(id),
  );
}

export async function deleteAction(id: string, _prev: FormState, formData: FormData) {
  const db = await authedDb();
  return handle(
    formData,
    z.object({ confirm: z.literal('on') }),
    () => deleteHolding(db, id),
    () => '/',
  );
}

export async function editProductAction(
  productId: string,
  backTo: string,
  _prev: FormState,
  formData: FormData,
) {
  const db = await authedDb();
  const parsed = parseForm(productSchema, formData);
  if ('state' in parsed) return parsed.state;
  if (!parsed.data.nameJa && !parsed.data.nameEn) return { error: 'check', fields: ['nameEn'] };
  return handle(
    formData,
    z.object({}),
    () => updateProduct(db, productId, productInputFrom(parsed.data)),
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
  const db = await authedDb();
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

  let ref: ProductRef;
  if (d.productId) ref = { productId: d.productId };
  else if (d.name) {
    ref = {
      product: {
        type: 'card_single',
        // One name box for speed: Japanese text goes to name_ja, anything else to name_en.
        ...(hasJapanese(d.name) ? { nameJa: d.name } : { nameEn: d.name }),
        cardNumber: d.cardNumber ?? null,
        rarity: d.rarity ?? null,
      },
    };
  } else return { error: 'check', fields: ['name'] };

  const result = await runDomain(() =>
    addPull(db, boxId, ref, {
      quantity: d.quantity,
      rawGrade: d.rawGrade,
      acquiredAt: at(d.date),
    }),
  );
  if (!result.ok) return result.state;
  revalidatePath(holdingPath(boxId));
  revalidatePath('/');
  return { added: (prev.added ?? 0) + 1 };
}
