'use server';

import {
  NOTICE_KINDS,
  NOTICE_KIND_ROLES,
  NOTICE_PARTS,
  NOTICE_TEXTS,
  type NoticeKind,
  type NoticePrefs,
  type NoticeRole,
  type NoticeStyle,
  noticeExamples,
} from '@tora/core';
import {
  addDiscordChannel,
  connectTelegram,
  localeFor,
  moneyFor,
  recordAdminChange,
  removeChannel,
  sendTest,
  sendToUser,
  setPreferences,
  setTelegramBot,
  textsFor,
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
      buy: form.get('buy') === 'on',
      drops: form.get('drops') === 'on',
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

// ---- Message style (Customize notices) ----

const STYLE_PAGE = '/settings/alerts/style';

/** Checks a kind's style and wording from the page: only known parts, colors and texts. */
function cleanStyle(kind: NoticeKind, style: NoticeStyle, texts: Record<string, string>) {
  const clean: NoticeStyle = {};
  if (style?.format === 'plain') clean.format = 'plain';
  const colors = Object.entries(style?.colors ?? {}).filter(
    ([role, hex]) =>
      NOTICE_KIND_ROLES[kind].includes(role as NoticeRole) &&
      typeof hex === 'string' &&
      /^#[0-9a-f]{6}$/i.test(hex),
  );
  if (colors.length) clean.colors = Object.fromEntries(colors);
  const hide = NOTICE_PARTS.filter((p) => style?.hide?.[p] === true);
  if (hide.length) clean.hide = Object.fromEntries(hide.map((p) => [p, true]));
  const words = Object.fromEntries(
    Object.entries(texts ?? {}).filter(
      ([key, value]) =>
        NOTICE_TEXTS[kind].includes(key) &&
        typeof value === 'string' &&
        value.trim() !== '' &&
        value.length <= 500,
    ),
  );
  return { style: clean, texts: words };
}

/** Saves one kind's style and wording (the wording in the person's notice language). */
export async function saveNoticeStyleAction(
  kind: NoticeKind,
  style: NoticeStyle,
  texts: Record<string, string>,
): Promise<{ error?: string }> {
  const { db, user } = await authed();
  if (!NOTICE_KINDS.includes(kind)) return { error: 'kind' };
  const locale = await localeFor(db, user);
  const clean = cleanStyle(kind, style, texts);
  const prefs: NoticePrefs = user.preferences?.notices ?? {};
  const own = { ...prefs.texts?.[locale] };
  for (const key of NOTICE_TEXTS[kind]) delete own[key];
  await setPreferences(db, user.id, {
    notices: {
      styles: { ...prefs.styles, [kind]: clean.style },
      texts: { ...prefs.texts, [locale]: { ...own, ...clean.texts } },
    },
  });
  revalidatePath(STYLE_PAGE);
  return {};
}

/** Sends a kind's example, as saved, to the person's channels. */
export async function sendNoticeExampleAction(
  kind: NoticeKind,
): Promise<{ sent?: number; error?: string }> {
  const { db, user } = await authed();
  const ctx = alertContext();
  if (!ctx) return { error: 'no_secret' };
  if (!NOTICE_KINDS.includes(kind)) return { error: 'kind' };
  const [texts, money] = await Promise.all([textsFor(db, user, ctx), moneyFor(db, user)]);
  const sent = await sendToUser(db, user.id, noticeExamples(texts, money)[kind], ctx);
  return { sent };
}
