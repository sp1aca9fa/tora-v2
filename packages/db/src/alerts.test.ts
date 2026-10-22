import { decryptSecret } from '@tora/auth';
import { toLocalIso } from '@tora/core';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { beforeEach, expect, it } from 'vitest';
import { listActivity, recordActivity } from './activity';
import {
  type AlertContext,
  addDiscordChannel,
  alertServerEvent,
  alertFailures,
  channelsOf,
  checkMissedRuns,
  morningCheck,
  connectTelegram,
  sendSummaries,
  sendWatchAlerts,
  setTelegramBot,
  telegramCode,
  stoppedReason,
} from './alerts';
import { type Db, createDb } from './client';
import { finishImportRun, saveImportRows, startImportRun } from './imports';
import { migrateDb } from './migrate';
import { saveSourceInfos } from './registry';
import { createProduct } from './mutations';
import { activity, alertChannels, signals, supply, watches } from './schema';
import { addWatch } from './watches';
import { TEST_SOURCES } from './testing';
import { createUser } from './users';

const SECRET = 'test-secret-0123456789abcdef0123456789';
const HOOK = 'https://discord.com/api/webhooks/123/abc-DEF_1';

let db: Db;
let admin: string;
let member: string;
/** Messages sent, by where they went. */
let sent: { to: string; text: string }[];
let telegramUpdates: unknown[];
let failDiscord: boolean;

const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  if (url.startsWith('https://discord.com/')) {
    if (!init?.method) return Response.json({ name: 'tora-alerts' });
    if (failDiscord) return new Response('no', { status: 404 });
    // A message's text and its cards (embeds) as one text.
    const embeds = (body.embeds ?? []) as {
      title?: string;
      description?: string;
      footer?: { text: string };
    }[];
    sent.push({
      to: 'discord',
      text: [body.content, ...embeds.flatMap((e) => [e.title, e.description, e.footer?.text])]
        .filter(Boolean)
        .join('\n'),
    });
    return new Response(null, { status: 204 });
  }
  const method = url.split('/').pop();
  if (method === 'getMe') return Response.json({ ok: true, result: { username: 'tora_bot' } });
  if (method === 'getUpdates') return Response.json({ ok: true, result: telegramUpdates });
  if (method === 'sendMessage') {
    sent.push({ to: `telegram:${body.chat_id}`, text: body.text });
    return Response.json({ ok: true, result: {} });
  }
  return Response.json({ ok: false, description: 'unknown' });
}) as typeof fetch;

const TEXTS: Record<string, Record<string, string>> = {
  en: {
    test: 'test',
    connected: 'connected',
    collectFailed: 'collect failed',
    collectStopped: 'collect stopped {code}',
    sourceLine: '{source}: {status}',
    status_failed: 'failed',
    backupFailed: 'backup failed: {error}',
    noCollect: 'no collect for {hours} h',
    noBackup: 'no backup for {hours} h',
    summaryTitle: 'summary',
    summaryImport:
      '{method}: {imported} added, {existing} existing, {skipped} skipped, {problem} problems',
    summaryActions: 'actions {count}',
    method_file: 'Spreadsheet',
    buyTitle: 'buy',
    buyZone: '{name}: good {price} under {zone}',
    buyLimited: '(limited)',
    buyTarget: '{name}: ask {price} {source} under {target}',
    summaryDrops: 'drops',
    summaryDrop: '{name}: {price} {pct}',
  },
  ja: { summaryTitle: 'まとめ' },
};
const ctx: AlertContext = { secret: SECRET, texts: (l) => TEXTS[l] ?? {}, fetch: fakeFetch };

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-alerts-'));
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  await saveSourceInfos(db, TEST_SOURCES);
  const creds = { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] };
  admin = (await createUser(db, 'admin', creds, 'admin')).user.id;
  member = (await createUser(db, 'member', creds)).user.id;
  sent = [];
  telegramUpdates = [];
  failDiscord = false;
  return () => rm(dir, { recursive: true, force: true });
});

it('keeps Discord webhooks encrypted and remembers a failed send', async () => {
  expect(await addDiscordChannel(db, admin, 'https://example.com/hook', SECRET, fakeFetch)).toEqual(
    { error: 'invalid' },
  );
  const added = await addDiscordChannel(db, admin, HOOK, SECRET, fakeFetch);
  expect(added).toHaveProperty('id');
  const [row] = await db.select().from(alertChannels);
  expect(row!.targetEnc).not.toContain('discord');
  expect(decryptSecret(row!.targetEnc, SECRET)).toBe(HOOK);
  // The same webhook again replaces it.
  await addDiscordChannel(db, admin, HOOK, SECRET, fakeFetch);
  expect(await channelsOf(db, admin)).toHaveLength(1);

  failDiscord = true;
  await recordActivity(db, { kind: 'backup', level: 'failed', detail: { error: 'disk full' } });
  await alertFailures(db, ctx, toLocalIso(new Date(Date.now() - 60_000)));
  const [channel] = await channelsOf(db, admin);
  expect(channel!.lastError).toMatch(/404/);
});

it('sends a failed run to admins once a day, never to members', async () => {
  await addDiscordChannel(db, admin, HOOK, SECRET, fakeFetch);
  await addDiscordChannel(db, member, 'https://discord.com/api/webhooks/9/x', SECRET, fakeFetch);
  const since = toLocalIso(new Date(Date.now() - 60_000));
  await recordActivity(db, {
    kind: 'collect',
    level: 'failed',
    detail: {
      sources: [
        { source: 'snkrdunk', status: 'failed' },
        { source: 'mercari', status: 'ok' },
      ],
    },
  });
  expect(await alertFailures(db, ctx, since)).toBe(1);
  expect(sent).toEqual([{ to: 'discord', text: 'collect failed\nsnkrdunk: failed' }]);
  // The hourly retry fails again: recorded, not sent again today.
  await recordActivity(db, { kind: 'collect', level: 'failed', detail: { exitCode: 1 } });
  expect(await alertFailures(db, ctx, since)).toBe(0);
  expect(sent).toHaveLength(1);
  const entries = await db.select().from(activity);
  expect(entries.every((e) => e.alertedAt)).toBe(true);
});

it('says so when nothing ran for over a day, once', async () => {
  await addDiscordChannel(db, admin, HOOK, SECRET, fakeFetch);
  const now = new Date();
  await recordActivity(db, {
    kind: 'collect',
    occurredAt: toLocalIso(new Date(now.getTime() - 30 * 3_600_000)),
  });
  await recordActivity(db, {
    kind: 'backup',
    occurredAt: toLocalIso(new Date(now.getTime() - 3_600_000)),
  });
  expect(await checkMissedRuns(db, ctx, now)).toEqual(['collect']);
  expect(sent.map((s) => s.text)).toEqual(['no collect for 30 h\n'.trim()]);
  expect(await checkMissedRuns(db, ctx, new Date(now.getTime() + 60_000))).toEqual([]);
  expect(sent).toHaveLength(1);
});

it('sends each person a daily summary of imports that did not add every row', async () => {
  await addDiscordChannel(db, member, HOOK, SECRET, fakeFetch);
  const run = await startImportRun(db, { userId: member, method: 'file' });
  await saveImportRows(db, run, [
    { title: 'A', outcome: 'imported' },
    { title: 'B', outcome: 'existing', reason: 'same_order' },
    { title: 'C', outcome: 'problem', reason: 'bad_date' },
  ]);
  await finishImportRun(db, run, { created: 1 });
  // The import is in the log with what happened to its rows; only its owner sees it.
  const [entry] = await listActivity(db, { id: member, admin: false });
  expect(entry).toMatchObject({ kind: 'import', action: 'file', level: 'problem' });
  expect(await listActivity(db, { id: admin, admin: false })).toEqual([]);
  expect(await listActivity(db, { id: admin, admin: true })).toHaveLength(1);

  expect(await sendSummaries(db, ctx)).toBe(1);
  expect(sent[0]!.text).toBe(`-# summary\nSpreadsheet: 1 added, 1 existing, 0 skipped, 1 problems`);
  // At most one a day.
  expect(await sendSummaries(db, ctx)).toBe(0);
  const [after] = await db.select().from(activity).where(eq(activity.kind, 'import'));
  expect(after!.alertedAt).not.toBeNull();
});

it('alerts a watch entering the buy zone or with an ask under its target, again after 14 days out', async () => {
  await addDiscordChannel(db, member, HOOK, SECRET, fakeFetch);
  const product = await createProduct(db, member, {
    category: 'tcg',
    kind: 'booster_box',
    name: 'Box',
    franchise: 'pokemon',
    region: 'jp',
  });
  const { watch } = await addWatch(
    db,
    member,
    { productId: product.id },
    { packagingState: 'sealed_shrink', targetPriceBase: 9000 },
  );
  const stats = (fair: number) => ({
    fair,
    sales30: 5,
    days180: 40,
    days365: 80,
    usual180: 10_000,
    q25d180: 9_500,
    q75d180: 10_500,
    q10d365: 9_000,
    cheaperThan180: 0.8,
    trend14: 0,
    trend28: 0,
    trend84: 0,
    ask: null,
    ageDays: null,
    releaseFrom: null,
    market: null,
    pattern: null,
  });
  const night = async (day: string, fair: number, ask: number) => {
    await db.delete(signals);
    await db.delete(supply);
    await db
      .insert(signals)
      .values({ productId: product.id, bucket: watch.bucket, day, stats: stats(fair) });
    await db.insert(supply).values({
      productId: product.id,
      source: 'snkrdunk',
      bucket: watch.bucket,
      day,
      lowestAskBase: ask,
      fetchedAt: `${day}T03:00:00`,
    });
    sent = [];
    return sendWatchAlerts(db, ctx, new Date(`${day}T12:00:00Z`));
  };
  // In the zone (Steady: under the lower quarter) and an ask under the target: both, one message.
  expect(await night('2026-11-01', 9_000, 8_500)).toEqual({ sent: 1, alerts: 2 });
  expect(sent[0]!.text).toBe(
    '-# buy\nBox\ngood ¥9,000 under ¥9,500\nBox\nask ¥8,500 SNKRDUNK under ¥9,000',
  );
  // Still in: nothing. Out for 5 days and back: nothing.
  expect(await night('2026-11-02', 9_000, 8_500)).toEqual({ sent: 0, alerts: 0 });
  await night('2026-11-03', 10_000, 9_500);
  expect(await night('2026-11-08', 9_000, 8_500)).toEqual({ sent: 0, alerts: 0 });
  // Out for 14 days: again.
  await night('2026-11-09', 10_000, 9_500);
  expect(await night('2026-11-23', 9_000, 9_500)).toEqual({ sent: 1, alerts: 1 });
  // An old signal (the collect failed) says nothing, and the memory is kept.
  const [before] = await db.select().from(watches);
  await db.delete(supply);
  expect(await sendWatchAlerts(db, ctx, new Date('2026-12-30T12:00:00Z'))).toEqual({
    sent: 0,
    alerts: 0,
  });
  const [after] = await db.select().from(watches);
  expect(after!.alertState).toEqual(before!.alertState);
});

it('connects a Telegram chat from the code sent to the bot', async () => {
  expect(await setTelegramBot(db, 'nope', SECRET, fakeFetch)).toEqual({ error: 'invalid' });
  expect(await setTelegramBot(db, '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ', SECRET, fakeFetch)).toEqual({
    username: 'tora_bot',
  });
  expect(await connectTelegram(db, member, ctx)).toEqual({ error: 'not_found' });
  telegramUpdates = [
    { message: { text: '/start someone-else', chat: { id: 1, username: 'x' } } },
    {
      message: { text: `/start ${telegramCode(member, SECRET)}`, chat: { id: 42, username: 'me' } },
    },
  ];
  expect(await connectTelegram(db, member, ctx)).toMatchObject({ label: '@me' });
  expect(sent).toEqual([{ to: 'telegram:42', text: 'connected' }]);
  // Removing the bot stops every Telegram channel.
  await setTelegramBot(db, null, SECRET, fakeFetch);
  expect(await channelsOf(db, member)).toEqual([]);
});

it('reads why a run stopped from the collect log, without the pnpm noise', () => {
  const log = [
    '=== 2026-10-16T19:02:04+09:00 ===',
    'values: 93 saved, 0 removed',
    '=== 2026-10-17T00:04:03+09:00  ===',
    '$ tsx src/cli/collect.ts',
    'Database: libsql://example.turso.io',
    'Database is missing migration(s): 0030_signals. Run `pnpm db:migrate` first.',
    '[ELIFECYCLE] Command failed with exit code 1.',
    'Error: ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL',
    '',
    '  × "pnpm recursive run" failed in /home/x/tora-v2/packages/collector-sdk',
    'collect failed (exit 1); will retry on the next trigger',
    '',
  ].join('\n');
  expect(stoppedReason(log)).toBe(
    'Database is missing migration(s): 0030_signals. Run `pnpm db:migrate` first.',
  );
  expect(stoppedReason('=== 2026-10-17 ===\n$ tsx x\n')).toBeNull();
});

it('runs the morning check once a day from 08:00 on a long-lived server', async () => {
  await addDiscordChannel(db, admin, HOOK, SECRET, fakeFetch);
  await recordActivity(db, { kind: 'collect', occurredAt: '2026-10-19T00:30:00.000+09:00' });
  expect(await morningCheck(db, ctx, new Date('2026-10-21T07:58:00+09:00'))).toBe(false);
  expect(await morningCheck(db, ctx, new Date('2026-10-21T08:02:00+09:00'))).toBe(true);
  expect(sent.map((s) => s.text)).toEqual(['no collect for 55 h']);
  expect(await morningCheck(db, ctx, new Date('2026-10-21T08:04:00+09:00'))).toBe(false);
  expect(await morningCheck(db, ctx, new Date('2026-10-22T08:00:00+09:00'))).toBe(true);
});

it("logs a server's own events, and tells admins only when asked", async () => {
  await addDiscordChannel(db, admin, HOOK, SECRET, fakeFetch);
  const before = sent.length;
  expect(await alertServerEvent(db, ctx, { title: 'Address reset', level: 'problem' })).toBe(0);
  expect(sent.length).toBe(before);
  const down = { title: 'Address down', text: 'check its network', level: 'failed' } as const;
  expect(await alertServerEvent(db, ctx, { ...down, tell: true })).toBe(1);
  expect(sent.at(-1)!.text).toContain('Address down. check its network');
  const log = await listActivity(db, { id: admin, admin: true });
  expect(log.filter((e) => e.action === 'serverEvent').map((e) => [e.level, e.detail])).toEqual(
    expect.arrayContaining([
      ['problem', { event: 'Address reset' }],
      ['failed', { event: 'Address down', text: 'check its network' }],
    ]),
  );
});
