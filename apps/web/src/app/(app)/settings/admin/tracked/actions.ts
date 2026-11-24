'use server';

import { TRACKED_PASTE_MAX, type TrackedTier } from '@tora/core';
import {
  type TrackedAddResult,
  type TrackedPreviewLine,
  addTrackedGames,
  markTrackedOnPc,
  previewTrackedGames,
  recordAdminChange,
  setTrackedRestOn,
  untrackGame,
} from '@tora/db';
import { revalidatePath } from 'next/cache';
import { authed } from '@/lib/auth/guard';
import { type FormState, runDomain } from '@/lib/form';

// The tracked games' admin page (spec wishlist-tracked W18). Every action reads the signed-in person
// here and refuses a non-admin; the `@tora/db` functions check the role again (`forbidden`).

const PAGE = '/settings/admin/tracked';

/** The signed-in admin, or null for anyone else (nothing is read or written then). */
async function admin() {
  const session = await authed();
  return session.user.role === 'admin' ? session : null;
}

export interface TrackedAddState extends FormState {
  text?: string;
  tier?: TrackedTier;
  lines?: TrackedPreviewLine[];
  tooMany?: boolean;
  results?: TrackedAddResult[];
}

/**
 * The paste's two steps (W9's preview, at most 100 lines): `preview` reads and writes nothing;
 * `confirm` parses the same text again on the server and adds each line in its own transaction with
 * the choice made per line, in the tier picked (the chosen set when none).
 */
export async function trackedAddAction(
  _prev: TrackedAddState,
  formData: FormData,
): Promise<TrackedAddState> {
  const session = await admin();
  if (!session) return { error: 'forbidden' };
  const { db, user } = session;
  const text = String(formData.get('text') ?? '').slice(0, 40_000);
  const tier: TrackedTier = formData.get('tier') === 'rest' ? 'rest' : 'chosen';
  if (formData.get('step') === 'edit') return {};
  if (!text.trim()) return { error: 'check', tier };
  if (formData.get('step') !== 'confirm') {
    const preview = await runDomain(() => previewTrackedGames(db, user.id, text));
    return preview.ok ? { text, tier, ...preview.value } : { ...preview.state, text, tier };
  }
  const choices: Record<number, string> = {};
  for (let line = 1; line <= TRACKED_PASTE_MAX; line++) {
    const v = formData.get(`choice-${line}`);
    if (typeof v === 'string' && v) choices[line] = v.slice(0, 40);
  }
  const result = await runDomain(() => addTrackedGames(db, user.id, text, choices, tier));
  if (!result.ok) return { ...result.state, text, tier };
  const added = result.value.filter((r) => r.ok && !r.already).length;
  if (added) await recordAdminChange(db, user.id, 'trackedAdded', { count: added, tier }, PAGE);
  revalidatePath(PAGE);
  return { text, tier, results: result.value };
}

/** Stops tracking one game: only its tracked row goes; the item and its history stay. */
export async function untrackAction(productId: string): Promise<{ done: boolean }> {
  const session = await admin();
  if (!session) return { done: false };
  const { db, user } = session;
  const id = String(productId ?? '');
  const result = await runDomain(() => untrackGame(db, user.id, id));
  if (!result.ok || !result.value) return { done: false };
  await recordAdminChange(db, user.id, 'trackedRemoved', { productId: id }, PAGE);
  revalidatePath(PAGE);
  return { done: true };
}

/** Marks a tracked game "now on PC" from a day (not after today), or clears the mark (`clear`). */
export async function onPcAction(
  productId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await admin();
  if (!session) return { error: 'forbidden' };
  const { db, user } = session;
  const id = String(productId ?? '');
  const day = formData.get('clear') ? null : String(formData.get('day') ?? '').trim();
  if (day === '') return { error: 'check', fields: ['day'] };
  const result = await runDomain(() => markTrackedOnPc(db, user.id, id, day));
  if (!result.ok) return result.state;
  if (!result.value) return { error: 'not_found' };
  await recordAdminChange(db, user.id, 'trackedOnPc', { productId: id, day }, PAGE);
  revalidatePath(PAGE);
  return {};
}

/** The switch for the rest's monthly pages (off until an admin turns it on). */
export async function trackedRestAction(on: boolean): Promise<{ saved: boolean }> {
  const session = await admin();
  if (!session || typeof on !== 'boolean') return { saved: false };
  const { db, user } = session;
  await setTrackedRestOn(db, user.id, on);
  await recordAdminChange(db, user.id, 'trackedRest', { on }, PAGE);
  revalidatePath(PAGE);
  return { saved: true };
}
