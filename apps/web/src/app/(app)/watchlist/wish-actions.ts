'use server';

import {
  type BulkLine,
  type BulkResult,
  BULK_MAX,
  DomainError,
  addBulk,
  addGameWish,
  confirmWish,
  gameLookAlikes,
  markWishListing,
  markWishSale,
  previewBulk,
  releaseWish,
  saveWishRules,
  turnOnWishRules,
  unmarkWishSale,
} from '@tora/db';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { authed } from '@/lib/auth/guard';
import { type FormState, optAmount, optText, parseForm, reqText, runDomain } from '@/lib/form';

// Adding game wishes and the registration check's actions (requirements S36 B1). Every action reads
// the signed-in person here and checks the wish in `@tora/db` (`wishForAction`: the wish's owner, or
// an admin); a refused or stale click changes nothing.

const checkPath = (wishId: string) => `/watchlist/${wishId}/check`;

const gameSchema = z.object({
  name: reqText,
  console: reqText,
  region: optText,
  edition: optText,
  targetPriceBase: optAmount,
});

export interface GameState extends FormState {
  /** Games already in Tora that read the same: the person picks one or a new item (fix C2). */
  lookAlikes?: BulkLine['lookAlikes'];
}

/**
 * Adds one game (S36 B1: name, console, region default Japan, edition, boxed), then its check. A
 * game already in Tora under the same name and console is offered first (fix C2): the form comes
 * back with it, and the person picks it (`choice` its id) or a new item (`choice` "new"). A choice
 * that is not among today's look-alikes (the name or console changed) asks again.
 */
export async function addGameWishAction(_prev: GameState, formData: FormData): Promise<GameState> {
  const { db, user } = await authed();
  const parsed = await parseForm(gameSchema, formData);
  if ('state' in parsed) return parsed.state;
  const d = parsed.data;
  const boxed = formData.get('boxed') === 'on';
  const lookAlikes = await gameLookAlikes(db, user.id, d.name, d.console, { boxed });
  const choice = formData.get('choice');
  const known = lookAlikes.some((a) => a.id === choice);
  if (lookAlikes.length && choice !== 'new' && !known) return { lookAlikes };
  const result = await runDomain(() =>
    addGameWish(db, user.id, {
      name: d.name,
      console: d.console,
      reuse: known ? String(choice) : null,
      region: d.region ?? null,
      edition: d.edition ?? null,
      boxed,
      watch: { targetPriceBase: d.targetPriceBase || null },
    }),
  );
  if (!result.ok) return result.state;
  revalidatePath('/', 'layout');
  redirect(checkPath(result.value.watch.id));
}

export interface BulkState extends FormState {
  text?: string;
  lines?: BulkLine[];
  tooMany?: boolean;
  results?: BulkResult[];
}

/**
 * The paste's two steps (S36 B1): `preview` reads and writes nothing; `confirm` parses the same text
 * again on the server and adds each line in its own transaction, with the choice made per line.
 */
export async function bulkWishAction(_prev: BulkState, formData: FormData): Promise<BulkState> {
  const { db, user } = await authed();
  const text = String(formData.get('text') ?? '').slice(0, 20_000);
  const step = formData.get('step');
  if (step === 'edit') return { text };
  if (!text.trim()) return { error: 'check' };
  if (step !== 'confirm') {
    const preview = await previewBulk(db, user.id, text);
    return { text, ...preview };
  }
  const choices: Record<number, string> = {};
  for (let line = 1; line <= BULK_MAX; line++) {
    const v = formData.get(`choice-${line}`);
    if (typeof v === 'string' && v) choices[line] = v.slice(0, 40);
  }
  const result = await runDomain(() => addBulk(db, user.id, text, choices));
  if (!result.ok) return { ...result.state, text };
  revalidatePath('/', 'layout');
  return { text, results: result.value };
}

/** A check page button: the change, then the page again; a domain refusal changes nothing. */
async function run(wishId: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
  }
  revalidatePath(checkPath(wishId));
  revalidatePath('/watchlist');
}

export async function confirmSalesAction(wishId: string, hash: string) {
  const { db, user } = await authed();
  await run(wishId, () => confirmWish(db, user, { wishId, kind: 'sales', hash }));
}

export async function confirmListingsAction(wishId: string, source: string, hash: string) {
  const { db, user } = await authed();
  await run(wishId, () => confirmWish(db, user, { wishId, kind: 'listings', source, hash }));
}

export async function markSaleAction(wishId: string, saleId: string) {
  const { db, user } = await authed();
  await run(wishId, () => markWishSale(db, user, { wishId, saleId }));
}

export async function unmarkSaleAction(wishId: string, saleId: string) {
  const { db, user } = await authed();
  await run(wishId, () => unmarkWishSale(db, user, { wishId, saleId }));
}

export async function markListingAction(wishId: string, source: string, ref: string) {
  const { db, user } = await authed();
  await run(wishId, () => markWishListing(db, user, { wishId, source, ref }));
}

export async function turnOnRulesAction(wishId: string) {
  const { db, user } = await authed();
  await run(wishId, () => turnOnWishRules(db, user, wishId));
}

export async function releaseAction(wishId: string) {
  const { db, user } = await authed();
  await run(wishId, () => releaseWish(db, user, wishId));
}

/** Saves the item's words and edition (S36 B1); the page then says the check comes back later. */
export async function saveRulesAction(
  wishId: string,
  _prev: FormState & { ok?: boolean },
  formData: FormData,
): Promise<FormState & { ok?: boolean }> {
  const { db, user } = await authed();
  const text = (name: string) => String(formData.get(name) ?? '').slice(0, 4000);
  const result = await runDomain(() =>
    saveWishRules(db, user, {
      wishId,
      required: text('required'),
      excluded: text('excluded'),
      edition: text('edition'),
    }),
  );
  if (!result.ok) return result.state;
  revalidatePath(checkPath(wishId));
  revalidatePath('/watchlist');
  return { ok: true };
}
