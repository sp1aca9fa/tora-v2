// Alerts outside the app (requirements S17): Telegram (one bot for the app, set by an admin) and
// Discord (a webhook per person). Failures of the home PC's runs go out at once to admins; imports
// with rows not added and what waits on Actions go out in one daily summary per person. The home
// PC sends failures after its runs (`pnpm alerts after-run`); the app's morning check (a Vercel
// cron job) sends "nothing ran" and the summaries, so they never arrive in the night. Watched
// items (S9 part 5): the buy zone and an ask under the target go out at once after the collect,
// sharp drops of owned and watched items in the summary.
import { decryptSecret, encryptSecret, keyedHash } from '@tora/auth';
import {
  ALERT_QUIET_DAYS,
  type AlertState,
  SHARP_DROP_7D,
  type SignalStats,
  alertPrefs,
  baseCurrency,
  fromMinor,
  judge,
  localDate,
  productClass,
  stepAlert,
  strategyOf,
  toLocalIso,
} from '@tora/core';
import { and, eq, gte, inArray, isNull } from 'drizzle-orm';
import { actionTotal, pendingActions } from './actions';
import { lastActivity, markAlerted, recordActivity, unalerted } from './activity';
import type { Db } from './client';
import { checkDbBudget } from './db-usage';
import { holdingBucket } from './valuation';
import { loadSourceRegistry, readSetting, saveSetting } from './registry';
import {
  type Activity,
  type AlertChannel,
  type AlertChannelKind,
  type Product,
  type User,
  activity,
  alertChannels,
  appSettings,
  holdings,
  products,
  signals,
  users,
  watches,
} from './schema';
import { latestSignals } from './signals';
import { currentSupply, lowestAsk } from './supply';

/** The `alertText` messages of one language (flat keys, `{name}` placeholders). */
export type AlertTexts = Record<string, string>;

export interface AlertContext {
  /** `AUTH_SECRET`: channel targets and the bot token are encrypted with it. */
  secret: string;
  /** The messages of a language (falls back to English when one is missing). */
  texts: (locale: string) => AlertTexts | Promise<AlertTexts>;
  fetch?: typeof fetch;
  /** Logs what was sent (the CLI). */
  log?: (message: string) => void;
}

const fill = (text: string, params: Record<string, string | number> = {}) =>
  text.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? ''));

/** A stored time as the people read it: `YYYY-MM-DD HH:mm`. */
const shortTime = (iso: string) => iso.slice(0, 16).replace('T', ' ');

const errorText = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).slice(0, 300);

// ---- Settings ----

interface TelegramBotSetting {
  tokenEnc: string;
  username: string;
}

/** The app's Telegram bot (its @name), when an admin set one. */
export async function telegramBotName(db: Db): Promise<string | null> {
  return (await readSetting<TelegramBotSetting>(db, 'telegramBot'))?.username ?? null;
}

async function telegramToken(db: Db, secret: string): Promise<string | null> {
  const bot = await readSetting<TelegramBotSetting>(db, 'telegramBot');
  return bot ? decryptSecret(bot.tokenEnc, secret) : null;
}

async function telegram(
  token: string,
  method: string,
  body: Record<string, unknown>,
  fetchFn: typeof fetch,
): Promise<unknown> {
  const res = await fetchFn(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => null)) as {
    ok?: boolean;
    result?: unknown;
    description?: string;
  } | null;
  if (!json?.ok) throw new Error(json?.description ?? `Telegram answered ${res.status}`);
  return json.result;
}

/**
 * Saves the app's Telegram bot (an admin pastes the token BotFather gave), checked with Telegram
 * first; null removes it (and every Telegram channel, which used it).
 */
export async function setTelegramBot(
  db: Db,
  token: string | null,
  secret: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ username: string } | { error: 'invalid' }> {
  if (token === null) {
    await db.delete(appSettings).where(eq(appSettings.key, 'telegramBot'));
    await db.delete(alertChannels).where(eq(alertChannels.kind, 'telegram'));
    return { username: '' };
  }
  const clean = token.trim();
  if (!/^\d+:[\w-]{20,}$/.test(clean)) return { error: 'invalid' };
  try {
    const me = (await telegram(clean, 'getMe', {}, fetchFn)) as { username?: string };
    if (!me.username) return { error: 'invalid' };
    await saveSetting(db, 'telegramBot', {
      tokenEnc: encryptSecret(clean, secret),
      username: me.username,
    } satisfies TelegramBotSetting);
    return { username: me.username };
  } catch {
    return { error: 'invalid' };
  }
}

/** The app's address, for links in messages (saved by the app when alerts are set up). */
export async function appUrl(db: Db): Promise<string | null> {
  return readSetting<string>(db, 'appUrl');
}

export async function setAppUrl(db: Db, url: string): Promise<void> {
  if ((await appUrl(db)) !== url) await saveSetting(db, 'appUrl', url);
}

// ---- Channels ----

export type ChannelView = Pick<
  AlertChannel,
  'id' | 'kind' | 'label' | 'lastSentAt' | 'lastError' | 'createdAt'
>;

export async function channelsOf(db: Db, userId: string): Promise<ChannelView[]> {
  return db
    .select({
      id: alertChannels.id,
      kind: alertChannels.kind,
      label: alertChannels.label,
      lastSentAt: alertChannels.lastSentAt,
      lastError: alertChannels.lastError,
      createdAt: alertChannels.createdAt,
    })
    .from(alertChannels)
    .where(eq(alertChannels.userId, userId))
    .orderBy(alertChannels.createdAt);
}

export async function removeChannel(db: Db, userId: string, id: string): Promise<void> {
  await db
    .delete(alertChannels)
    .where(and(eq(alertChannels.id, id), eq(alertChannels.userId, userId)));
}

async function addChannel(
  db: Db,
  userId: string,
  kind: AlertChannelKind,
  target: string,
  label: string | null,
  secret: string,
): Promise<string> {
  // The same chat or webhook twice would send everything twice.
  for (const c of await db
    .select()
    .from(alertChannels)
    .where(and(eq(alertChannels.userId, userId), eq(alertChannels.kind, kind)))) {
    if (decryptSecret(c.targetEnc, secret) === target) {
      await db.delete(alertChannels).where(eq(alertChannels.id, c.id));
    }
  }
  const [row] = await db
    .insert(alertChannels)
    .values({ userId, kind, targetEnc: encryptSecret(target, secret), label })
    .returning({ id: alertChannels.id });
  return row!.id;
}

const DISCORD_WEBHOOK =
  /^https:\/\/(?:canary\.|ptb\.)?(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/;

/** Adds a Discord webhook (checked with Discord first). */
export async function addDiscordChannel(
  db: Db,
  userId: string,
  url: string,
  secret: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ id: string } | { error: 'invalid' | 'unreachable' }> {
  const clean = url.trim();
  if (!DISCORD_WEBHOOK.test(clean)) return { error: 'invalid' };
  try {
    const res = await fetchFn(clean, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok)
      return { error: res.status === 404 || res.status === 401 ? 'invalid' : 'unreachable' };
    const hook = (await res.json()) as { name?: string };
    return { id: await addChannel(db, userId, 'discord', clean, hook.name ?? null, secret) };
  } catch {
    return { error: 'unreachable' };
  }
}

/**
 * The code a person sends the bot to connect (`/start <code>`, from a t.me link): tied to them
 * and the day, so nothing needs storing.
 */
export function telegramCode(userId: string, secret: string, day = localDate()): string {
  return keyedHash(`telegram:${userId}:${day}`, secret).replace(/[^\w]/g, '').slice(0, 24);
}

/** The t.me link that opens the bot with the person's code. */
export async function telegramLink(db: Db, userId: string, secret: string): Promise<string | null> {
  const bot = await telegramBotName(db);
  return bot ? `https://t.me/${bot}?start=${telegramCode(userId, secret)}` : null;
}

/**
 * Finds the person's `/start <code>` among the bot's recent messages (Telegram keeps them a day)
 * and saves that chat.
 */
export async function connectTelegram(
  db: Db,
  userId: string,
  ctx: AlertContext,
): Promise<{ id: string; label: string } | { error: 'no_bot' | 'not_found' | 'unreachable' }> {
  const fetchFn = ctx.fetch ?? fetch;
  const token = await telegramToken(db, ctx.secret);
  if (!token) return { error: 'no_bot' };
  const yesterday = localDate(new Date(Date.now() - 86_400_000));
  const codes = new Set([
    telegramCode(userId, ctx.secret),
    telegramCode(userId, ctx.secret, yesterday),
  ]);
  let updates: {
    message?: { text?: string; chat?: { id: number; username?: string; first_name?: string } };
  }[];
  try {
    updates = (await telegram(
      token,
      'getUpdates',
      { allowed_updates: ['message'] },
      fetchFn,
    )) as typeof updates;
  } catch {
    return { error: 'unreachable' };
  }
  const found = updates
    .map((u) => u.message)
    .reverse()
    .find((m) => {
      const [command, code] = (m?.text ?? '').trim().split(/\s+/);
      return command === '/start' && codes.has(code ?? '');
    });
  if (!found?.chat) return { error: 'not_found' };
  const chat = found.chat;
  const label = chat.username ? `@${chat.username}` : (chat.first_name ?? String(chat.id));
  const id = await addChannel(db, userId, 'telegram', String(chat.id), label, ctx.secret);
  const user = await db.select().from(users).where(eq(users.id, userId));
  const texts = await textsFor(db, user[0] ?? null, ctx);
  await deliverTo(db, id, texts.connected ?? 'Tora: alerts will arrive in this chat.', ctx);
  return { id, label };
}

// ---- Sending ----

async function deliver(
  channel: AlertChannel,
  text: string,
  ctx: AlertContext,
  token: string | null,
): Promise<void> {
  const fetchFn = ctx.fetch ?? fetch;
  const target = decryptSecret(channel.targetEnc, ctx.secret);
  if (channel.kind === 'discord') {
    const res = await fetchFn(target, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // No @everyone or role pings from text that came from data.
      body: JSON.stringify({ content: text.slice(0, 2000), allowed_mentions: { parse: [] } }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Discord answered ${res.status}`);
    return;
  }
  if (!token) throw new Error('No Telegram bot is set (Settings > Alerts)');
  await telegram(
    token,
    'sendMessage',
    { chat_id: target, text: text.slice(0, 4096), link_preview_options: { is_disabled: true } },
    fetchFn,
  );
}

/** Sends to one channel; remembers when it worked or why it failed. */
async function deliverTo(db: Db, channelId: string, text: string, ctx: AlertContext) {
  const [channel] = await db.select().from(alertChannels).where(eq(alertChannels.id, channelId));
  if (!channel) return false;
  const token = channel.kind === 'telegram' ? await telegramToken(db, ctx.secret) : null;
  const now = toLocalIso();
  try {
    await deliver(channel, text, ctx, token);
    await db
      .update(alertChannels)
      .set({ lastSentAt: now, lastError: null, updatedAt: now })
      .where(eq(alertChannels.id, channel.id));
    return true;
  } catch (error) {
    await db
      .update(alertChannels)
      .set({ lastError: errorText(error), updatedAt: now })
      .where(eq(alertChannels.id, channel.id));
    ctx.log?.(`alerts: ${channel.kind} of a user failed: ${errorText(error)}`);
    return false;
  }
}

/** Sends `text` to every channel of a person; how many it reached. */
export async function sendToUser(
  db: Db,
  userId: string,
  text: string,
  ctx: AlertContext,
): Promise<number> {
  let sent = 0;
  for (const c of await channelsOf(db, userId)) {
    if (await deliverTo(db, c.id, text, ctx)) sent++;
  }
  return sent;
}

/** "Send a test" for one channel. */
export async function sendTest(db: Db, user: User, channelId: string, ctx: AlertContext) {
  const [channel] = await db
    .select({ id: alertChannels.id })
    .from(alertChannels)
    .where(and(eq(alertChannels.id, channelId), eq(alertChannels.userId, user.id)));
  if (!channel) return false;
  const texts = await textsFor(db, user, ctx);
  return deliverTo(db, channel.id, texts.test ?? 'Tora: test message.', ctx);
}

/** A person's messages' language: their choice, else the app's primary. */
async function localeFor(db: Db, user: User | null): Promise<string> {
  const languages = (await loadSourceRegistry(db)).languages;
  const chosen = alertPrefs(user?.preferences).language;
  return chosen && (chosen === languages?.primary || chosen === languages?.secondary)
    ? chosen
    : (languages?.primary ?? 'en');
}

/** A person's messages: their chosen language, else the app's primary. */
export async function textsFor(db: Db, user: User | null, ctx: AlertContext): Promise<AlertTexts> {
  const locale = await localeFor(db, user);
  return { ...(await ctx.texts('en')), ...(await ctx.texts(locale)) };
}

/** Amounts in the base currency, in a person's language. */
async function moneyFor(db: Db, user: User): Promise<(minor: number) => string> {
  const [locale, registry] = await Promise.all([localeFor(db, user), loadSourceRegistry(db)]);
  const base = baseCurrency(registry);
  const format = new Intl.NumberFormat(locale, { style: 'currency', currency: base });
  return (minor) => format.format(fromMinor(minor, base));
}

/** A condition in a few words for a message: "graded:PSA:10" -> "PSA 10". */
const conditionWords = (bucket: string) =>
  bucket.replace(/^(graded|raw|sealed|cond):/, '').replaceAll(':', ' ');

/** Admins who want failures, with at least one channel. */
async function adminsToAlert(db: Db): Promise<User[]> {
  const admins = await db
    .select()
    .from(users)
    .where(and(eq(users.role, 'admin'), isNull(users.disabledAt)));
  return admins.filter((a) => alertPrefs(a.preferences).failures);
}

const linkLine = (t: AlertTexts, base: string | null, href: string | null) =>
  base && href ? `\n${base.replace(/\/$/, '')}${href}` : '';

/** Lines of a run's log that are only noise for a person (pnpm's wrapper, progress bars). */
const LOG_NOISE =
  /^(\$ |\[ELIFECYCLE\]|Error: ERR_PNPM|\s*[×│]|\[[█░]|Database: |collect failed \(exit|backup failed \(exit|alerts failed)/;

/**
 * Why a run stopped, from the collect log (scripts/collect-cron.sh): the last meaningful lines
 * of the run that started last (after its "=== <time>" header). Null when nothing says.
 */
export function stoppedReason(log: string): string | null {
  const start = log.lastIndexOf('\n=== ');
  const lines = (start >= 0 ? log.slice(start + 1) : log)
    .split('\n')
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => l && !LOG_NOISE.test(l));
  const reason = lines.slice(-2).join(' ');
  return reason ? reason.slice(0, 300) : null;
}

/** The message about a failed (or missed) run, in one person's language. */
function failureText(t: AlertTexts, entry: Activity, base: string | null): string {
  const d = entry.detail as Record<string, unknown>;
  const lines: string[] = [];
  if (entry.kind === 'collect') {
    lines.push(
      d.exitCode
        ? fill(t.collectStopped!, {
            code: Number(d.exitCode),
            reason: String(d.error ?? `exit code ${Number(d.exitCode)}`),
          })
        : t.collectFailed!,
    );
    for (const s of (d.sources as { source: string; status: string }[] | undefined) ?? []) {
      if (s.status !== 'ok')
        lines.push(
          fill(t.sourceLine!, { source: s.source, status: t[`status_${s.status}`] ?? s.status }),
        );
    }
    if (t.logHint) lines.push(t.logHint);
  } else if (entry.kind === 'backup') {
    lines.push(fill(t.backupFailed!, { error: String(d.error ?? '') }));
  } else if (entry.kind === 'check') {
    if (entry.action === 'self_check') {
      lines.push(fill(t.selfCheck!, { items: ((d.fixed as string[]) ?? []).join(', ') }));
    } else if (entry.action === 'db_budget') {
      const millions = (n: unknown) => (Number(n ?? 0) / 1e6).toFixed(1);
      lines.push(
        fill(t.dbBudget!, {
          read: millions(d.read),
          projected: millions(d.projected),
          budget: millions(d.budget),
        }),
      );
    } else {
      const params = {
        hours: Number(d.hours ?? 0),
        last: d.last ? shortTime(String(d.last)) : '-',
      };
      lines.push(fill(entry.action === 'no_backup' ? t.noBackup! : t.noCollect!, params));
    }
  }
  return lines.join('\n') + linkLine(t, base, entry.href);
}

/**
 * Sends failed collects and backups (and missed-run checks) not alerted yet to admins, at most
 * once a day per kind (the schedule retries every hour); marks them alerted.
 */
export async function alertFailures(db: Db, ctx: AlertContext, since: string): Promise<number> {
  const entries = (
    await Promise.all(
      (['collect', 'backup', 'check'] as const).map((kind) =>
        unalerted(db, { kind, userId: null, since }),
      ),
    )
  )
    .flat()
    .filter((e) => e.level === 'failed');
  if (entries.length === 0) return 0;
  const today = localDate();
  const sentToday = (await readSetting<Record<string, string>>(db, 'alertsSentToday')) ?? {};
  const toSend = entries.filter(
    (e) => sentToday[e.action ? `${e.kind}:${e.action}` : e.kind] !== today,
  );
  let sent = 0;
  if (toSend.length) {
    const base = await appUrl(db);
    for (const admin of await adminsToAlert(db)) {
      const t = await textsFor(db, admin, ctx);
      const text = toSend.map((e) => failureText(t, e, base)).join('\n\n');
      sent += await sendToUser(db, admin.id, text, ctx);
    }
    for (const e of toSend) sentToday[e.action ? `${e.kind}:${e.action}` : e.kind] = today;
    await saveSetting(db, 'alertsSentToday', sentToday);
  }
  await markAlerted(
    db,
    entries.map((e) => e.id),
  );
  return sent;
}

/**
 * A home server's automatic update (docs/home-server.md, `scripts/update-server.sh --auto`): in the
 * activity log; a failure (the server went back to the version before) goes to admins at once.
 */
export async function alertServerUpdate(
  db: Db,
  ctx: AlertContext,
  update: { from: string; to: string; failed: string | null },
): Promise<number> {
  const { from, to, failed } = update;
  await recordActivity(db, {
    kind: 'admin',
    action: failed ? 'serverUpdateFailed' : 'serverUpdate',
    level: failed ? 'failed' : 'ok',
    detail: { ...(failed ? { step: failed } : {}), from, to },
    href: '/settings/activity',
  });
  if (!failed) return 0;
  let sent = 0;
  for (const admin of await adminsToAlert(db)) {
    const t = await textsFor(db, admin, ctx);
    sent += await sendToUser(db, admin.id, fill(t.updateFailed!, { step: failed, from, to }), ctx);
  }
  return sent;
}

/** Hours without a run before the daily check says so. */
const MISSED_HOURS = 26;

/**
 * The app's daily check: when no collect or no backup was recorded for over a day (the PC is
 * off, or its schedule stopped), or the database's month heads past its budget, records it and
 * alerts admins. Nothing before the first run.
 */
export async function checkMissedRuns(
  db: Db,
  ctx: AlertContext,
  now = new Date(),
): Promise<string[]> {
  const missed: string[] = [];
  for (const kind of ['collect', 'backup'] as const) {
    const last = await lastActivity(db, kind);
    if (!last) continue;
    const hours = Math.floor((now.getTime() - Date.parse(last.occurredAt)) / 3_600_000);
    if (hours < MISSED_HOURS) continue;
    // Once a day, even when the check runs twice.
    const said = await lastActivity(db, 'check', { action: `no_${kind}` });
    if (said && now.getTime() - Date.parse(said.occurredAt) < 20 * 3_600_000) continue;
    await recordActivity(db, {
      kind: 'check',
      action: `no_${kind}`,
      level: 'failed',
      detail: { last: last.occurredAt, hours },
      href: kind === 'collect' ? '/settings/collectors' : '/settings/activity',
    });
    missed.push(kind);
  }
  // The hosted database's rows read this month against the admin's budget (S19).
  if (await checkDbBudget(db, now)) missed.push('db_budget');
  await alertFailures(db, ctx, toLocalIso(new Date(now.getTime() - 3_600_000)));
  return missed;
}

/** Hours between two summaries of one person (the PC and the app's check may both try). */
const SUMMARY_GAP_HOURS = 20;

/** Rows of an import that were not added: already in Tora, left out, or with a problem. */
function notAdded(entry: Activity) {
  const o = ((entry.detail as Record<string, unknown>).outcomes ?? {}) as Record<string, number>;
  return {
    existing: o.existing ?? 0,
    skipped: o.skipped ?? 0,
    problem: o.problem ?? 0,
    imported: o.imported ?? 0,
  };
}

/**
 * The daily summary of each person with a channel: their imports since the last summary that did
 * not add every row, and how much waits on their Actions page. Nothing to say, nothing sent.
 */
export async function sendSummaries(db: Db, ctx: AlertContext, now = new Date()): Promise<number> {
  const state = (await readSetting<Record<string, string>>(db, 'alertSummaries')) ?? {};
  // Sharp drops already shown: person -> item and condition -> day.
  const dropsShown =
    (await readSetting<Record<string, Record<string, string>>>(db, 'alertDrops')) ?? {};
  const base = await appUrl(db);
  let sent = 0;
  const people = await db.select().from(users).where(isNull(users.disabledAt));
  for (const user of people) {
    if ((await channelsOf(db, user.id)).length === 0) continue;
    const last = state[user.id];
    if (last && now.getTime() - Date.parse(last) < SUMMARY_GAP_HOURS * 3_600_000) continue;
    const prefs = alertPrefs(user.preferences);
    const t = await textsFor(db, user, ctx);
    const lines: string[] = [];
    const imports: Activity[] = [];
    if (prefs.imports) {
      const since = last ?? toLocalIso(new Date(now.getTime() - 86_400_000));
      for (const e of await db
        .select()
        .from(activity)
        .where(
          and(
            eq(activity.kind, 'import'),
            eq(activity.userId, user.id),
            isNull(activity.alertedAt),
            gte(activity.occurredAt, since),
          ),
        )
        .orderBy(activity.occurredAt)) {
        imports.push(e);
        const n = notAdded(e);
        if (n.existing + n.skipped + n.problem === 0) continue;
        lines.push(
          fill(t.summaryImport!, {
            method: t[`method_${e.action}`] ?? e.action ?? '',
            ...n,
          }) + linkLine(t, base, e.href),
        );
      }
    }
    if (prefs.actions) {
      const items = await pendingActions(db, user.id, user.noticeLevels, {
        admin: user.role === 'admin',
      });
      const count = actionTotal(items);
      if (count) lines.push(fill(t.summaryActions!, { count }) + linkLine(t, base, '/actions'));
    }
    const drops = prefs.drops ? await sharpDrops(db, user.id, dropsShown[user.id] ?? {}, now) : [];
    if (drops.length) {
      const money = await moneyFor(db, user);
      lines.push(
        [
          t.summaryDrops ?? 'Sharp drops (15% or more in a week):',
          ...drops.map(
            (d) =>
              fill(t.summaryDrop ?? '{name}: {price}, {pct} in 7 days', {
                name: d.product.name + (d.bucket ? ` (${conditionWords(d.bucket)})` : ''),
                price: money(d.fair),
                pct: `${Math.round(d.change * 100)}%`,
              }) + linkLine(t, base, `/products/${d.product.id}`),
          ),
        ].join('\n'),
      );
    }
    if (lines.length === 0) continue;
    const delivered = await sendToUser(db, user.id, [t.summaryTitle!, ...lines].join('\n\n'), ctx);
    if (delivered === 0) continue;
    sent += delivered;
    state[user.id] = toLocalIso(now);
    if (drops.length) {
      const today = localDate(now);
      dropsShown[user.id] = {
        ...dropsShown[user.id],
        ...Object.fromEntries(drops.map((d) => [d.key, today])),
      };
    }
    await markAlerted(
      db,
      imports.map((e) => e.id),
    );
  }
  await saveSetting(db, 'alertSummaries', state);
  await saveSetting(db, 'alertDrops', dropsShown);
  return sent;
}

/** A watch's alert memory, read back. */
type WatchAlertState = { zone?: AlertState; target?: AlertState };

/**
 * Watched items' alerts, at once after the nightly collect (S9 part 5): a watch whose verdict
 * turned Good price (by its person's strategy; with little data only when the watch allows it),
 * and a watch whose lowest ask went under its target. Each again only after 14 days out. Only
 * today's numbers count (a collect that failed says nothing). Every watch's memory is kept up to
 * date, also for people without a channel or with these alerts off, so turning them on later
 * does not send old news.
 */
export async function sendWatchAlerts(
  db: Db,
  ctx: AlertContext,
  now = new Date(),
): Promise<{ sent: number; alerts: number }> {
  const today = localDate(now);
  const rows = await db
    .select({ watch: watches, product: products, user: users })
    .from(watches)
    .innerJoin(products, eq(products.id, watches.productId))
    .innerJoin(users, eq(users.id, watches.userId))
    .where(isNull(users.disabledAt));
  if (rows.length === 0) return { sent: 0, alerts: 0 };
  const ids = [...new Set(rows.map((r) => r.product.id))];
  const [stats, supply] = await Promise.all([
    latestSignals(
      db,
      rows.map((r) => ({ productId: r.product.id, bucket: r.watch.bucket || null })),
      now,
    ),
    currentSupply(db, ids, now),
  ]);
  const base = await appUrl(db);
  const sourceLabel = new Map(
    (await loadSourceRegistry(db)).sources.map((s) => [s.key, s.label] as const),
  );
  const byUser = new Map<string, { user: User; lines: string[] }>();
  let alerts = 0;
  for (const { watch, product, user } of rows) {
    const state: WatchAlertState = { ...(watch.alertState ?? {}) };
    const signal = stats.get(`${product.id}|${watch.bucket}`);
    const fresh = signal?.day === today ? (signal.stats as SignalStats) : null;
    const lines: string[] = [];
    const t = await textsFor(db, user, ctx);
    const money = await moneyFor(db, user);
    const name =
      product.name +
      (rows.filter((r) => r.user.id === user.id && r.product.id === product.id).length > 1 &&
      watch.bucket
        ? ` (${conditionWords(watch.bucket)})`
        : '');
    const href = `/products/${product.id}/buy${watch.bucket ? `?condition=${encodeURIComponent(watch.bucket)}` : ''}`;
    if (fresh) {
      const j = judge(fresh, strategyOf(user.preferences, productClass(product)));
      const good = j.verdict === 'good' && (watch.alertLimited || j.limited.length === 0);
      const step = stepAlert(state.zone, good, today);
      state.zone = step.state;
      if (step.send && fresh.fair !== null && j.zone.top !== null) {
        lines.push(
          fill(t.buyZone ?? '{name}: good price, {price} (buy zone under {zone}).', {
            name,
            price: money(fresh.fair),
            zone: money(j.zone.top),
          }) +
            (j.limited.length ? ` ${t.buyLimited ?? ''}` : '') +
            linkLine(t, base, href),
        );
      }
    }
    // Today's asks only: a source that read nothing tonight says nothing.
    const ask = lowestAsk(
      (supply.get(product.id) ?? []).filter((r) => r.day === today),
      watch.bucket,
    );
    if (watch.targetPriceBase && ask) {
      const under = ask.lowestAskBase !== null && ask.lowestAskBase <= watch.targetPriceBase;
      const step = stepAlert(state.target, under, today);
      state.target = step.state;
      if (step.send) {
        lines.push(
          fill(t.buyTarget ?? '{name}: an ask at {price} ({source}), under your target {target}.', {
            name,
            price: money(ask.lowestAskBase!),
            source: sourceLabel.get(ask.source) ?? ask.source,
            target: money(watch.targetPriceBase),
          }) +
            linkLine(t, base, ask.url ? null : href) +
            (ask.url ? `\n${ask.url}` : ''),
        );
      }
    }
    if (JSON.stringify(state) !== JSON.stringify(watch.alertState ?? {})) {
      await db.update(watches).set({ alertState: state }).where(eq(watches.id, watch.id));
    }
    if (lines.length === 0 || !alertPrefs(user.preferences).buy) continue;
    alerts += lines.length;
    const entry = byUser.get(user.id) ?? { user, lines: [] };
    entry.lines.push(...lines);
    byUser.set(user.id, entry);
  }
  let sent = 0;
  for (const { user, lines } of byUser.values()) {
    const t = await textsFor(db, user, ctx);
    sent += await sendToUser(
      db,
      user.id,
      [t.buyTitle ?? 'Tora: buy timing', ...lines].join('\n\n'),
      ctx,
    );
  }
  return { sent, alerts };
}

/**
 * Sharp drops for a person's daily summary (S9 part 5): owned and watched items whose market
 * value fell 15 % or more in 7 days (from the saved daily numbers), each item at most once in 14
 * days (`shown`: item and condition -> day last shown).
 */
export async function sharpDrops(
  db: Db,
  userId: string,
  shown: Record<string, string>,
  now = new Date(),
): Promise<{ key: string; product: Product; bucket: string; fair: number; change: number }[]> {
  const today = localDate(now);
  const day = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / 86_400_000);
  const pairs = new Map<string, { product: Product; bucket: string }>();
  for (const { holding, product } of await db
    .select({ holding: holdings, product: products })
    .from(holdings)
    .innerJoin(products, eq(products.id, holdings.productId))
    .where(and(eq(holdings.userId, userId), eq(holdings.status, 'owned')))) {
    const bucket = holdingBucket(holding, product) ?? '';
    pairs.set(`${product.id}|${bucket}`, { product, bucket });
  }
  for (const { watch, product } of await db
    .select({ watch: watches, product: products })
    .from(watches)
    .innerJoin(products, eq(products.id, watches.productId))
    .where(eq(watches.userId, userId))) {
    pairs.set(`${product.id}|${watch.bucket}`, { product, bucket: watch.bucket });
  }
  if (pairs.size === 0) return [];
  const ids = [...new Set([...pairs.values()].map((p) => p.product.id))];
  const from = localDate(new Date(now.getTime() - 10 * 86_400_000));
  const byPair = new Map<string, { day: string; fair: number | null }[]>();
  for (let i = 0; i < ids.length; i += 200) {
    for (const r of await db
      .select({
        productId: signals.productId,
        bucket: signals.bucket,
        day: signals.day,
        stats: signals.stats,
      })
      .from(signals)
      .where(and(inArray(signals.productId, ids.slice(i, i + 200)), gte(signals.day, from)))) {
      const key = `${r.productId}|${r.bucket}`;
      if (!pairs.has(key)) continue;
      const list = byPair.get(key) ?? [];
      list.push({ day: r.day, fair: (r.stats as SignalStats).fair });
      byPair.set(key, list);
    }
  }
  const out = [];
  for (const [key, list] of byPair) {
    list.sort((a, b) => a.day.localeCompare(b.day));
    const last = list.at(-1)!;
    // Today's or yesterday's numbers, against those of 7 days before (a day either way).
    if (last.fair === null || day(today) - day(last.day) > 1) continue;
    const before = list.find((r) => Math.abs(day(last.day) - day(r.day) - 7) <= 1 && r.fair);
    if (!before?.fair) continue;
    const change = last.fair / before.fair - 1;
    if (change > SHARP_DROP_7D) continue;
    if (shown[key] && day(today) - day(shown[key]) < ALERT_QUIET_DAYS) continue;
    const pair = pairs.get(key)!;
    out.push({ key, product: pair.product, bucket: pair.bucket, fair: last.fair, change });
  }
  return out.sort((a, b) => a.change - b.change);
}
