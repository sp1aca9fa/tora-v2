'use server';

import {
  addDiscordChannel,
  connectTelegram,
  recordAdminChange,
  removeChannel,
  sendTest,
  setPreferences,
  setTelegramBot,
} from '@tora/db';
import { revalidatePath } from 'next/cache';
import { isLocale } from '@/i18n/locale';
import { alertContext, rememberAppUrl } from '@/lib/alerts';
import { authed } from '@/lib/auth/guard';

export type AlertState = { ok?: boolean; error?: string };

const PAGE = '/settings/alerts';

export async function addDiscordAction(_: AlertState, form: FormData): Promise<AlertState> {
  const { db, user } = await authed();
  const ctx = alertContext();
  if (!ctx) return { error: 'no_secret' };
  const result = await addDiscordChannel(db, user.id, String(form.get('url') ?? ''), ctx.secret);
  if ('error' in result) return { error: result.error };
  await rememberAppUrl(db);
  await sendTest(db, user, result.id, ctx);
  revalidatePath(PAGE);
  return { ok: true };
}

export async function connectTelegramAction(): Promise<AlertState> {
  const { db, user } = await authed();
  const ctx = alertContext();
  if (!ctx) return { error: 'no_secret' };
  const result = await connectTelegram(db, user.id, ctx);
  if ('error' in result) return { error: result.error };
  await rememberAppUrl(db);
  revalidatePath(PAGE);
  return { ok: true };
}

export async function testChannelAction(id: string): Promise<AlertState> {
  const { db, user } = await authed();
  const ctx = alertContext();
  if (!ctx) return { error: 'no_secret' };
  const ok = await sendTest(db, user, String(id), ctx);
  revalidatePath(PAGE);
  return ok ? { ok } : { error: 'failed' };
}

export async function removeChannelAction(id: string): Promise<void> {
  const { db, user } = await authed();
  await removeChannel(db, user.id, String(id));
  revalidatePath(PAGE);
}

export async function saveAlertPrefsAction(_: AlertState, form: FormData): Promise<AlertState> {
  const { db, user } = await authed();
  const language = String(form.get('language') ?? '');
  await setPreferences(db, user.id, {
    alerts: {
      failures: form.get('failures') === 'on',
      imports: form.get('imports') === 'on',
      actions: form.get('actions') === 'on',
      ...(isLocale(language) && { language }),
    },
  });
  revalidatePath(PAGE);
  return { ok: true };
}

/** The app's Telegram bot (admins): a token checked with Telegram, or none. */
export async function setTelegramBotAction(_: AlertState, form: FormData): Promise<AlertState> {
  const { db, user } = await authed();
  if (user.role !== 'admin') return {};
  const ctx = alertContext();
  if (!ctx) return { error: 'no_secret' };
  const remove = form.get('remove') === '1';
  const result = await setTelegramBot(
    db,
    remove ? null : String(form.get('token') ?? ''),
    ctx.secret,
  );
  if ('error' in result) return { error: result.error };
  await recordAdminChange(
    db,
    user.id,
    'telegramBot',
    { to: remove ? null : `@${result.username}` },
    PAGE,
  );
  await rememberAppUrl(db);
  revalidatePath(PAGE);
  return { ok: true };
}
