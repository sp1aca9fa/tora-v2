'use server';

import { DomainError, decideSuggestion } from '@tora/db';
import { revalidatePath } from 'next/cache';
import { authed } from '@/lib/auth/guard';

/** Accepts (runs the fix) or dismisses one suggestion of the data review. */
export async function decideSuggestionAction(id: string, accept: boolean) {
  const { db, user } = await authed();
  try {
    await decideSuggestion(db, user, id, accept);
  } catch (error) {
    // Gone or not allowed: leave it open, the page shows it again.
    if (!(error instanceof DomainError)) throw error;
  }
  revalidatePath('/', 'layout');
}
