'use server';

import { consoleKey } from '@tora/core';
import {
  addSuggestedConsoles,
  cleanConsole,
  deleteConsole,
  listConsoles,
  recordAdminChange,
  saveConsole,
} from '@tora/db';
import { revalidatePath } from 'next/cache';
import { authed } from '@/lib/auth/guard';

const PAGE = '/settings/admin/consoles';

/** A console as the form sends it: other spellings one per line or comma separated. */
export interface ConsoleForm {
  key: string;
  names: Record<string, string>;
  aliases: string;
  categories: Record<string, string>;
  boxedAllowed: boolean;
  sort: string;
}

export type ConsoleFormError = 'key' | 'exists' | 'names' | 'aliases' | 'category' | 'sort';

/**
 * Adds a console (`editing` null) or changes the one with key `editing` (its key stays: item rules
 * name it). Admins only (S36 Terms "Console table").
 */
export async function saveConsoleAction(
  form: ConsoleForm,
  editing: string | null,
): Promise<{ error: ConsoleFormError } | { saved: string } | undefined> {
  const { db, user } = await authed();
  if (user.role !== 'admin') return;
  if (!form || typeof form !== 'object') return { error: 'key' };
  const key = consoleKey(String(editing ?? form.key ?? ''));
  if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(key)) return { error: 'key' };
  const existing = (await listConsoles(db)).find((c) => c.key === key);
  if (editing === null && existing) return { error: 'exists' };
  if (editing !== null && !existing) return { error: 'key' };
  const sortText = String(form.sort ?? '').trim();
  const sort = sortText === '' ? 0 : Number(sortText);
  if (!Number.isInteger(sort) || sort < 0 || sort > 9999) return { error: 'sort' };
  const input = {
    key,
    names: form.names ?? {},
    aliases: String(form.aliases ?? '')
      .split(/[\n,、]/)
      .map((a) => a.trim())
      .filter(Boolean),
    categories: form.categories ?? {},
    boxedAllowed: form.boxedAllowed === true,
    sort,
  };
  // Say which part is wrong: names, then other spellings, then a category number.
  if (!cleanConsole({ ...input, aliases: [], categories: {} })) return { error: 'names' };
  if (!cleanConsole({ ...input, categories: {} })) return { error: 'aliases' };
  if (!cleanConsole(input)) return { error: 'category' };
  await saveConsole(db, input);
  await recordAdminChange(db, user.id, 'consoleSaved', { console: key }, PAGE);
  revalidatePath(PAGE);
  return { saved: key };
}

/** Deletes a console nothing uses (admins); says how many items use it otherwise. */
export async function deleteConsoleAction(
  key: string,
): Promise<{ error: 'used'; rules: number; products: number } | { error: 'missing' } | undefined> {
  const { db, user } = await authed();
  if (user.role !== 'admin') return;
  const result = await deleteConsole(db, String(key ?? ''));
  if (!result.deleted) {
    return result.use ? { error: 'used', ...result.use } : { error: 'missing' };
  }
  await recordAdminChange(db, user.id, 'consoleRemoved', { console: consoleKey(key) }, PAGE);
  revalidatePath(PAGE);
}

/** Adds the plug-ins' suggested consoles that have no row yet (admins); rows that exist stay. */
export async function addSuggestedConsolesAction(): Promise<{ added: number } | undefined> {
  const { db, user } = await authed();
  if (user.role !== 'admin') return;
  const added = await addSuggestedConsoles(db);
  if (added.length) {
    await recordAdminChange(db, user.id, 'consolesSuggested', { consoles: added }, PAGE);
    revalidatePath(PAGE);
  }
  return { added: added.length };
}
