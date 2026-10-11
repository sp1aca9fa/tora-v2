'use server';

import { DomainError, clearReviewNote, decideSuggestion } from '@tora/db';
import { revalidatePath } from 'next/cache';
import { authed } from '@/lib/auth/guard';

/** Accepts (runs the fix) or dismisses one suggestion of the data review. */
export async function decideSuggestionAction(id: string, accept: boolean, formData: FormData) {
  const { db, user } = await authed();
  const note = String(formData.get('note') ?? '').slice(0, 1000);
  try {
    await decideSuggestion(db, user, id, accept, note);
  } catch (error) {
    // Gone or not allowed: leave it open, the page shows it again.
    if (!(error instanceof DomainError)) throw error;
  }
  revalidatePath('/', 'layout');
}

/** Deletes one of the user's notes (the model no longer gets it). */
export async function clearNoteAction(id: string) {
  const { db, user } = await authed();
  await clearReviewNote(db, user.id, id);
  revalidatePath('/imports/suggestions');
}
