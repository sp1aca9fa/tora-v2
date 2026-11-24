'use server';

import {
  type Condition,
  ITEM_FACT_KINDS,
  WISH_CONDITIONS,
  WISH_ESTIMATE_BASES,
  WISH_RISKS,
} from '@tora/core';
import {
  recordItemFact,
  saveWishEstimate,
  setWishCondition,
  setWishTarget,
  withdrawItemFact,
} from '@tora/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { authed } from '@/lib/auth/guard';
import {
  type FormState,
  amount,
  dateText,
  optAmount,
  optText,
  parseForm,
  reqEnum,
  runDomain,
} from '@/lib/form';

// The game wish page's actions (S36 C2, spec W15). Each one is checked again in @tora/db against the
// signed-in person: another person's wish is not found, a fact is taken back by its author or an
// admin only.

export interface WishFormState extends FormState {
  /** Set after a save, so the form can say so and clear. */
  saved?: number;
}

const done = (id: string): WishFormState => {
  revalidatePath(`/watchlist/${id}`);
  revalidatePath('/watchlist');
  return { saved: Date.now() };
};

const conditionSchema = z.object({
  condition: reqEnum(WISH_CONDITIONS as [Condition, ...Condition[]]),
});

/** The wish's condition (Terms "Condition"): its target is kept; a collision is refused. */
export async function setConditionAction(
  wishId: string,
  _prev: WishFormState,
  formData: FormData,
): Promise<WishFormState> {
  const { db, user } = await authed();
  const parsed = await parseForm(conditionSchema, formData);
  if ('state' in parsed) return parsed.state;
  const result = await runDomain(() =>
    setWishCondition(db, user.id, wishId, parsed.data.condition),
  );
  return result.ok ? done(wishId) : result.state;
}

const targetSchema = z.object({ target: optAmount });

/** The wish's price (the watch target); empty clears it. */
export async function setTargetAction(
  wishId: string,
  _prev: WishFormState,
  formData: FormData,
): Promise<WishFormState> {
  const { db, user } = await authed();
  const parsed = await parseForm(targetSchema, formData);
  if ('state' in parsed) return parsed.state;
  const target = await parsed.data.target;
  const result = await runDomain(() => setWishTarget(db, user.id, wishId, target || null));
  return result.ok ? done(wishId) : result.state;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const estimateSchema = z.object({
  low: amount,
  high: amount,
  settleBy: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined),
    z.string().regex(MONTH).optional(),
  ),
  basis: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined),
    z.enum(WISH_ESTIMATE_BASES).optional(),
  ),
  riskOther: optText,
  sources: optText,
});

/** An estimate on the person's own wish (append-only; in the base currency). */
export async function addEstimateAction(
  wishId: string,
  _prev: WishFormState,
  formData: FormData,
): Promise<WishFormState> {
  const { db, user } = await authed();
  const parsed = await parseForm(estimateSchema, formData);
  if ('state' in parsed) return parsed.state;
  const d = parsed.data;
  const [low, high] = [await d.low, await d.high];
  if (high < low) return { error: 'check', fields: ['high'] };
  const picked = formData.getAll('risk').map(String);
  const risks = WISH_RISKS.filter((r) => picked.includes(r)).map((kind) =>
    kind === 'other' ? { kind, text: d.riskOther ?? '' } : { kind },
  );
  const sources = (d.sources ?? '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  const result = await runDomain(() =>
    saveWishEstimate(db, user.id, wishId, {
      low,
      high,
      settleBy: d.settleBy ?? null,
      basis: d.basis ?? null,
      risks,
      sources,
    }),
  );
  return result.ok ? done(wishId) : result.state;
}

const factSchema = z.object({
  day: dateText,
  kind: reqEnum(ITEM_FACT_KINDS),
  text: optText,
  sourceUrl: optText,
});

/** A dated fact about the wish's item (shared per item, with who recorded it). */
export async function recordFactAction(
  wishId: string,
  _prev: WishFormState,
  formData: FormData,
): Promise<WishFormState> {
  const { db, user } = await authed();
  const parsed = await parseForm(factSchema, formData);
  if ('state' in parsed) return parsed.state;
  const result = await runDomain(() => recordItemFact(db, user.id, wishId, parsed.data));
  return result.ok ? done(wishId) : result.state;
}

/** Takes back a recorded fact: its author or an admin (checked in @tora/db). */
export async function withdrawFactAction(wishId: string, factId: string): Promise<void> {
  const { db, user } = await authed();
  const result = await runDomain(() =>
    withdrawItemFact(db, { id: user.id, role: user.role }, wishId, factId),
  );
  if (result.ok) done(wishId);
}
