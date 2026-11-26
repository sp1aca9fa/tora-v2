import { decryptSecret } from '@tora/auth';
import { linesNotice, storeNotice, toLocalIso } from '@tora/core';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readAlertTexts } from './alert-texts';
import { listActivity, recordActivity } from './activity';
import {
  alertMarketRefusals,
  type AlertContext,
  type AlertTexts,
  addDiscordChannel,
  alertLoginFailure,
  alertServerEvent,
  alertServerUpdate,
  alertFailures,
  channelsOf,
  FAILURE_LEASE_KEY,
  WATCH_LEASE_KEY,
  checkMissedRuns,
  MISSED_RUNS_LEASE_WAIT_MS,
  morningCheck,
  connectTelegram,
  listAlertLog,
  pruneAlertLog,
  sendSummaries,
  sendTest,
  sendToUser,
  sendWatchAlerts,
  setChannelMention,
  setTelegramBot,
  telegramCode,
  stoppedReason,
} from './alerts';
import { type Db, createDb } from './client';
import { finishImportRun, saveImportRows, startImportRun } from './imports';
import { migrateDb } from './migrate';
import { recordRefusal } from './market-jobs';
import { saveSetting, saveSourceInfos } from './registry';
import { createProduct } from './mutations';
import {
  activity,
  alertChannels,
  alertLog,
  appSettings,
  collectorRuns,
  productSources,
  signals,
  supply,
  users,
  watches,
} from './schema';
import { LEASE_MS } from './lease';
import { addWatch, updateWatch } from './watches';
import { TEST_SOURCES } from './testing';
import { createUser, setUserDisabled } from './users';

const SECRET = 'test-secret-0123456789abcdef0123456789';
const HOOK = 'https://discord.com/api/webhooks/123/abc-DEF_1';

let db: Db;
let admin: string;
let member: string;
/** Messages sent, by where they went. */
let sent: { to: string; text: string }[];
let telegramUpdates: unknown[];
/** Telegram messages sent (their ids count up) and those they answered. */
let messageIds: number;
let answered: number[];
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
    if (body.reply_parameters) answered.push(body.reply_parameters.message_id);
    return Response.json({ ok: true, result: { message_id: ++messageIds } });
  }
  return Response.json({ ok: false, description: 'unknown' });
}) as typeof fetch;

const TEXTS: Record<string, Record<string, string>> = {
  en: {
    test: 'test',
    connected: 'connected',
    collectFailed: 'collect failed',
    listingsGone: '{count, plural, one {# listing} other {# listings}} set aside',
    listingGoneLine: '{source}: {name}',
    collectStopped: 'collect stopped {code}',
    sourceLine: '{source}: {status}',
    status_failed: 'failed',
    status_blocked_rankings: 'refused reading rankings',
    backupFailed: 'backup failed: {error}',
    noCollect: 'no collect for {hours} h',
    noBackup: 'no backup for {hours} h',
    updateCiFailed: 'ci failed on {to}, still {from}',
    sourceQuiet: 'quiet: {sources}',
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
    login_password: 'wrong password.',
    login_code: 'wrong code.',
    loginNotYou: 'Not you?',
    loginPasswordKnown: 'Password was right.',
    loginPasswordKnownAdmin: 'Admins: password was right.',
    login_devices: 'on 2 devices ({devices}).',
  },
  ja: { summaryTitle: 'まとめ' },
};
const ctx: AlertContext = { secret: SECRET, texts: (l) => TEXTS[l] ?? {}, fetch: fakeFetch };

/** A notice of one line. */
const linesNoticeOf = (text: string) => linesNotice('admin', null, [{ text, role: 'info' }], null);

/** A day's numbers of a watched item (Steady's zone: under 9,500). */
const signalStats = (fair: number) => ({
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
  messageIds = 0;
  answered = [];
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

it('tries a failure again at the next run when no channel took it', async () => {
  await addDiscordChannel(db, admin, HOOK, SECRET, fakeFetch);
  const since = toLocalIso(new Date(Date.now() - 60_000));
  await recordActivity(db, { kind: 'backup', level: 'failed', detail: { error: 'disk full' } });
  failDiscord = true;
  expect(await alertFailures(db, ctx, since)).toBe(0);
  expect((await db.select().from(activity)).some((e) => e.alertedAt)).toBe(false);
  failDiscord = false;
  // The next call's own window starts after the failure: still sent.
  expect(await alertFailures(db, ctx, toLocalIso(new Date(Date.now() + 60_000)))).toBe(1);
  expect(sent.map((s) => s.text)).toEqual(['backup failed: disk full']);
  expect((await db.select().from(activity)).every((e) => e.alertedAt)).toBe(true);
});

it('two overlapping failure alert calls send a failure once (A15)', async () => {
  await addDiscordChannel(db, admin, HOOK, SECRET, fakeFetch);
  const since = toLocalIso(new Date(Date.now() - 60_000));
  await recordActivity(db, { kind: 'backup', level: 'failed', detail: { error: 'disk full' } });
  const options = {
    clock: () => 1_000_000,
    sleep: () => new Promise<void>((r) => setTimeout(r, 5)),
  };
  const results = await Promise.all([
    alertFailures(db, ctx, since, options),
    alertFailures(db, ctx, since, options),
  ]);
  expect(results.sort()).toEqual([0, 1]);
  expect(sent.map((s) => s.text)).toEqual(['backup failed: disk full']);
  const [lease] = await db.select().from(appSettings).where(eq(appSettings.key, FAILURE_LEASE_KEY));
  expect(lease!.value).toMatchObject({ until: 0 });
});

/** The test's channels, with the lease under `key` taken by another pass after the first message. */
const stealAfterFirstPost = (key: string): AlertContext => {
  let done = false;
  return {
    ...ctx,
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const res = await fakeFetch(input, init);
      if (init?.method && !done) {
        done = true;
        await db
          .update(appSettings)
          .set({ value: { id: 'other', until: 1_000_000 + LEASE_MS } })
          .where(eq(appSettings.key, key));
      }
      return res;
    }) as typeof fetch,
  };
};

const leaseOf = async (key: string) =>
  (await db.select().from(appSettings).where(eq(appSettings.key, key)))[0]?.value;

/** A lease clock pinned, and a holder `slow` that renews at each wait. */
const renewingHolder = async (key: string) => {
  const clock = { t: 1_000_000 };
  const hold = () =>
    db
      .insert(appSettings)
      .values({ key, value: { id: 'slow', until: clock.t + LEASE_MS } })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value: { id: 'slow', until: clock.t + LEASE_MS } },
      });
  await hold();
  return {
    clock,
    options: {
      clock: () => clock.t,
      sleep: async (ms: number) => {
        clock.t += ms;
        await hold();
      },
    },
  };
};

it('a failure alert pass whose lease another took stops before the next admin, the entries unmarked', async () => {
  const creds = { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] };
  const second = (await createUser(db, 'admin2', creds, 'admin')).user.id;
  await addDiscordChannel(db, admin, HOOK, SECRET, fakeFetch);
  await addDiscordChannel(db, second, 'https://discord.com/api/webhooks/9/x', SECRET, fakeFetch);
  await recordActivity(db, { kind: 'backup', level: 'failed', detail: { error: 'disk full' } });
  const since = toLocalIso(new Date(Date.now() - 60_000));
  const pinned = { clock: () => 1_000_000 };
  expect(await alertFailures(db, stealAfterFirstPost(FAILURE_LEASE_KEY), since, pinned)).toBe(1);
  expect(sent).toHaveLength(1);
  // Left for the pass that took over.
  expect((await db.select().from(activity)).some((e) => e.alertedAt)).toBe(false);
  expect(await leaseOf(FAILURE_LEASE_KEY)).toMatchObject({ id: 'other' });
});

it('a failure alert pass that fails ends its lease', async () => {
  await addDiscordChannel(db, admin, HOOK, SECRET, fakeFetch);
  await recordActivity(db, { kind: 'backup', level: 'failed', detail: { error: 'disk full' } });
  const failing: AlertContext = {
    ...ctx,
    texts: () => {
      throw new Error('texts down');
    },
  };
  await expect(
    alertFailures(db, failing, toLocalIso(new Date(Date.now() - 60_000)), {
      clock: () => 1_000_000,
    }),
  ).rejects.toThrow('texts down');
  expect(await leaseOf(FAILURE_LEASE_KEY)).toMatchObject({ until: 0 });
});

it('a failure alert call that gives up waiting leaves the entries for a later call', async () => {
  await addDiscordChannel(db, admin, HOOK, SECRET, fakeFetch);
  await recordActivity(db, { kind: 'backup', level: 'failed', detail: { error: 'disk full' } });
  const since = toLocalIso(new Date(Date.now() - 60_000));
  const { clock, options } = await renewingHolder(FAILURE_LEASE_KEY);
  expect(await alertFailures(db, ctx, since, options)).toBe(0);
  expect(sent).toHaveLength(0);
  expect((await db.select().from(activity))[0]!.alertedAt).toBeNull();
  // The holder ended (released): the next call sends the entry.
  await db
    .update(appSettings)
    .set({ value: { id: 'slow', until: 0 } })
    .where(eq(appSettings.key, FAILURE_LEASE_KEY));
  expect(await alertFailures(db, ctx, since, { clock: () => clock.t })).toBe(1);
  expect(sent.map((s) => s.text)).toEqual(['backup failed: disk full']);
});

it('a failure alert call with a short wait gives up after it, not at the holder expiry', async () => {
  await recordActivity(db, { kind: 'backup', level: 'failed', detail: { error: 'disk full' } });
  const { clock, options } = await renewingHolder(FAILURE_LEASE_KEY);
  const since = toLocalIso(new Date(Date.now() - 60_000));
  expect(await alertFailures(db, ctx, since, { ...options, maxWaitMs: 20_000 })).toBe(0);
  expect(clock.t - 1_000_000).toBe(20_000);
});

afterEach(() => void vi.useRealTimers());

it("the morning check waits for the failure lease at most 20 s (the hosted job's 60 s limit)", async () => {
  expect(MISSED_RUNS_LEASE_WAIT_MS).toBe(20_000);
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout'] });
  vi.setSystemTime(new Date('2026-11-01T09:00:00Z'));
  const start = Date.now();
  // A holder that died a moment ago: without the limit the check would wait 11 minutes.
  await db
    .insert(appSettings)
    .values({ key: FAILURE_LEASE_KEY, value: { id: 'dead', until: start + LEASE_MS } });
  let done = false;
  const check = checkMissedRuns(db, ctx, new Date(start)).finally(() => void (done = true));
  for (let i = 0; i < 400 && !done; i++) {
    await new Promise<void>((r) => setImmediate(r));
    await vi.advanceTimersByTimeAsync(1_000);
  }
  await check;
  expect(done).toBe(true);
  expect(Date.now() - start).toBeLessThan(60_000);
  expect(await leaseOf(FAILURE_LEASE_KEY)).toMatchObject({ id: 'dead' });
});

it('marks failures alerted when no admin has a channel (nothing to try again)', async () => {
  await recordActivity(db, { kind: 'backup', level: 'failed', detail: { error: 'disk full' } });
  expect(await alertFailures(db, ctx, toLocalIso(new Date(Date.now() - 60_000)))).toBe(0);
  expect((await db.select().from(activity)).every((e) => e.alertedAt)).toBe(true);
});

it('tells admins of a site refusing while reading rankings or box opening cards, once a day', async () => {
  await addDiscordChannel(db, admin, HOOK, SECRET, fakeFetch);
  const since = toLocalIso(new Date(Date.now() - 60_000));
  const refused = (source: string, status: string) => ({
    kind: 'collect' as const,
    level: 'failed' as const,
    detail: { sources: [{ source, status, requests: 0, observations: 0 }] },
  });
  await recordActivity(db, refused('megastore', 'blocked_rankings'));
  expect(await alertFailures(db, ctx, since)).toBe(1);
  expect(sent.at(-1)!.text).toBe('collect failed\nmegastore: refused reading rankings');
  // The day's retry (the site is left alone by then, but say another run reports it): not again.
  await recordActivity(db, refused('megastore', 'blocked_opening'));
  expect(await alertFailures(db, ctx, since)).toBe(0);
  expect(sent).toHaveLength(1);
  // The real texts exist for both, under the same section as the collector's.
  const alertText = readAlertTexts('en', join(__dirname, '../../..'));
  expect(alertText.status_blocked).toBeTruthy();
  expect(alertText.status_blocked_rankings).toContain('rankings');
  expect(alertText.status_blocked_opening).toContain('box opening cards');
});

it('tells admins about listings set aside, though the run did not fail', async () => {
  await addDiscordChannel(db, admin, HOOK, SECRET, fakeFetch);
  const since = toLocalIso(new Date(Date.now() - 60_000));
  await recordActivity(db, {
    kind: 'check',
    action: 'listings_gone',
    level: 'problem',
    detail: { listings: [{ source: 'snkrdunk', productId: 'p1', name: 'Box', error: 'HTTP 404' }] },
  });
  expect(await alertFailures(db, ctx, since)).toBe(1);
  expect(sent.at(-1)!.text).toBe('1 listing set aside\nsnkrdunk: Box');
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

it('says once a day when a source that usually finds sales finds none for 3 days (S15)', async () => {
  await addDiscordChannel(db, admin, HOOK, SECRET, fakeFetch);
  const now = new Date();
  const day = 86_400_000;
  // 12 nights: a source that found sales most nights, then nothing for the last 3; another that
  // rarely finds any; a third whose last nights failed (alerted as failures instead).
  const run = (source: string, daysAgo: number, added: number, status = 'ok' as const) => ({
    source,
    startedAt: toLocalIso(new Date(now.getTime() - daysAgo * day - 3_600_000)),
    status,
    observationsAdded: added,
  });
  await recordActivity(db, { kind: 'collect', occurredAt: toLocalIso(now) });
  await recordActivity(db, { kind: 'backup', occurredAt: toLocalIso(now) });
  await db.insert(collectorRuns).values([
    ...[...Array(12).keys()].map((d) => run('changed', d, d < 3 ? 0 : d === 7 ? 0 : 40)),
    // A second run the same day for one item adds none; the day still counts as finding some.
    run('changed', 5, 0),
    ...[...Array(12).keys()].map((d) => run('rare', d, d % 4 === 0 ? 2 : 0)),
    ...[...Array(12).keys()].map((d) =>
      d < 3 ? run('broken', d, 0, 'failed' as never) : run('broken', d, 30),
    ),
  ]);
  expect(await checkMissedRuns(db, ctx, now)).toEqual(['quiet_source']);
  expect(sent.map((s) => s.text)).toEqual(['quiet: changed']);
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
  const night = async (day: string, fair: number, ask: number) => {
    await db.delete(signals);
    await db.delete(supply);
    await db
      .insert(signals)
      .values({ productId: product.id, bucket: watch.bucket, day, stats: signalStats(fair) });
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

it("keeps a watch's alert memory until a channel took the alert; asks under half the fair value are no target alert", async () => {
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
  const day = '2026-11-01';
  const now = new Date(`${day}T12:00:00Z`);
  const ask = (source: string, lowestAskBase: number) => ({
    productId: product.id,
    source,
    bucket: watch.bucket,
    day,
    lowestAskBase,
    fetchedAt: `${day}T03:00:00`,
  });
  // Fair 18,000 (no good price): Mercari's 5,000 is under half of it, SNKRDUNK's 9,000 is not.
  await db
    .insert(signals)
    .values({ productId: product.id, bucket: watch.bucket, day, stats: signalStats(18_000) });
  await db.insert(supply).values([ask('mercari', 5_000), ask('snkrdunk', 9_000)]);
  failDiscord = true;
  expect(await sendWatchAlerts(db, ctx, now)).toEqual({ sent: 0, alerts: 1 });
  expect((await db.select().from(watches))[0]!.alertState ?? {}).toEqual({});
  // A rerun the same day, with the channel back: sent, then remembered.
  failDiscord = false;
  expect(await sendWatchAlerts(db, ctx, now)).toEqual({ sent: 1, alerts: 1 });
  expect(sent.map((s) => s.text)).toEqual(['-# buy\nBox\nask ¥9,000 SNKRDUNK under ¥9,000']);
  expect(await sendWatchAlerts(db, ctx, now)).toEqual({ sent: 0, alerts: 0 });
});

it('a new target by watching the item again starts the target memory over, and keeps the Good price one (A14)', async () => {
  await addDiscordChannel(db, member, HOOK, SECRET, fakeFetch);
  const product = await createProduct(db, member, {
    category: 'tcg',
    kind: 'booster_box',
    name: 'Box',
    franchise: 'pokemon',
    region: 'jp',
  });
  const input = { packagingState: 'sealed_shrink' as const };
  const { watch } = await addWatch(
    db,
    member,
    { productId: product.id },
    { ...input, targetPriceBase: 8_000 },
  );
  const night = async (day: string, ask: number) => {
    await db.delete(supply);
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
  // In at 7,900 against 8,000: sent.
  expect(await night('2026-11-01', 7_900)).toEqual({ sent: 1, alerts: 1 });
  const zone = { on: true, sent: '2026-10-20' };
  const [stored] = await db.select().from(watches);
  await db
    .update(watches)
    .set({ alertState: { ...stored!.alertState, zone } })
    .where(eq(watches.id, watch.id));
  // Watched again at 7,000: the target's memory starts over (out), the Good price one stays.
  await addWatch(db, member, { productId: product.id }, { ...input, targetPriceBase: 7_000 });
  const [after] = await db.select().from(watches);
  expect(after!.alertState).toEqual({ zone });
  // 6,900 a week later is under the new target: sent, though the old memory was in.
  expect(await night('2026-11-08', 6_900)).toEqual({ sent: 1, alerts: 1 });
  expect(sent.map((s) => s.text)).toEqual(['-# buy\nBox\nask ¥6,900 SNKRDUNK under ¥7,000']);
  // The same target again restarts nothing: 6,800 the next night is still in.
  await addWatch(db, member, { productId: product.id }, { ...input, targetPriceBase: 7_000 });
  expect(await night('2026-11-09', 6_800)).toEqual({ sent: 0, alerts: 0 });
});

it('two overlapping watch alert passes send an alert once (A15)', async () => {
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
    { packagingState: 'sealed_shrink', targetPriceBase: 8_000 },
  );
  const day = '2026-11-01';
  await db.insert(supply).values({
    productId: product.id,
    source: 'snkrdunk',
    bucket: watch.bucket,
    day,
    lowestAskBase: 7_900,
    fetchedAt: `${day}T03:00:00`,
  });
  // The lease's clock pinned; each wait only yields, so the waiter goes on once the holder ends.
  const options = {
    clock: () => 1_000_000,
    sleep: () => new Promise<void>((r) => setTimeout(r, 5)),
  };
  const now = new Date(`${day}T12:00:00Z`);
  const results = await Promise.all([
    sendWatchAlerts(db, ctx, now, options),
    sendWatchAlerts(db, ctx, now, options),
  ]);
  expect(results.map((r) => r.sent).sort()).toEqual([0, 1]);
  expect(sent).toHaveLength(1);
  const [lease] = await db.select().from(appSettings).where(eq(appSettings.key, WATCH_LEASE_KEY));
  expect(lease!.value).toMatchObject({ until: 0 });
});

it("a watch alert pass waits out a dead holder's lease, and gives up on one still renewed (A15)", async () => {
  let t = 1_000_000;
  await db.insert(appSettings).values({ key: WATCH_LEASE_KEY, value: { id: 'dead', until: t } });
  const logs: string[] = [];
  const lctx = { ...ctx, log: (m: string) => void logs.push(m) };
  const wait = { clock: () => t, sleep: async (ms: number) => void (t += ms) };
  expect(await sendWatchAlerts(db, lctx, new Date(), wait)).toEqual({ sent: 0, alerts: 0 });
  expect(t).toBeGreaterThanOrEqual(1_000_000 + 60_000);
  expect(logs).toEqual([]);
  // A holder that keeps renewing: skipped, said in the log, its lease untouched.
  await db
    .update(appSettings)
    .set({ value: { id: 'slow', until: t + 10 * 60_000 } })
    .where(eq(appSettings.key, WATCH_LEASE_KEY));
  const renewing = {
    clock: () => t,
    sleep: async (ms: number) => {
      t += ms;
      await db
        .update(appSettings)
        .set({ value: { id: 'slow', until: t + 10 * 60_000 } })
        .where(eq(appSettings.key, WATCH_LEASE_KEY));
    },
  };
  expect(await sendWatchAlerts(db, lctx, new Date(), renewing)).toEqual({ sent: 0, alerts: 0 });
  expect(logs).toEqual(['watch alerts: skipped, another pass running']);
  const [lease] = await db.select().from(appSettings).where(eq(appSettings.key, WATCH_LEASE_KEY));
  expect(lease!.value).toMatchObject({ id: 'slow' });
});

/** A sealed box `userId` watches at a target, with an ask on `day`. */
const watchedBox = async (userId: string, day: string, target: number, ask: number) => {
  const product = await createProduct(db, userId, {
    category: 'tcg',
    kind: 'booster_box',
    name: 'Box',
    franchise: 'pokemon',
    region: 'jp',
  });
  const { watch } = await addWatch(
    db,
    userId,
    { productId: product.id },
    { packagingState: 'sealed_shrink', targetPriceBase: target },
  );
  await db.insert(supply).values({
    productId: product.id,
    source: 'snkrdunk',
    bucket: watch.bucket,
    day,
    lowestAskBase: ask,
    fetchedAt: `${day}T03:00:00`,
  });
  return { product, watch };
};

const memoryOf = async (id: string) =>
  (await db.select().from(watches).where(eq(watches.id, id)))[0]!.alertState;

it('a watch alert pass whose lease another took stops before the next person, their memory unwritten', async () => {
  await addDiscordChannel(db, admin, HOOK, SECRET, fakeFetch);
  await addDiscordChannel(db, member, 'https://discord.com/api/webhooks/9/x', SECRET, fakeFetch);
  const day = '2026-11-01';
  const a = await watchedBox(admin, day, 8_000, 7_900);
  const m = await watchedBox(member, day, 8_000, 7_900);
  const result = await sendWatchAlerts(
    db,
    stealAfterFirstPost(WATCH_LEASE_KEY),
    new Date(`${day}T12:00:00Z`),
    { clock: () => 1_000_000 },
  );
  expect(result).toEqual({ sent: 1, alerts: 2 });
  expect(sent).toHaveLength(1);
  const memories = [await memoryOf(a.watch.id), await memoryOf(m.watch.id)];
  expect(memories.filter((s) => s?.target?.on)).toHaveLength(1);
  expect(memories.filter((s) => !s?.target)).toHaveLength(1);
  expect(await leaseOf(WATCH_LEASE_KEY)).toMatchObject({ id: 'other' });
});

it('a watch alert pass whose lease another took while reading sends nothing and counts no alert', async () => {
  await addDiscordChannel(db, member, HOOK, SECRET, fakeFetch);
  const day = '2026-11-01';
  const { watch } = await watchedBox(member, day, 8_000, 7_900);
  // The lease's clock a minute on at each look, so the read loop renews before the first watch;
  // another pass takes the lease just before that renewal.
  let t = 1_000_000;
  let stolen = false;
  const stealing = new Proxy(db, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (prop !== 'update') return typeof value === 'function' ? value.bind(target) : value;
      return (table: typeof appSettings) => {
        const builder = target.update(table);
        if (table !== appSettings || stolen) return builder;
        stolen = true;
        type Set = Parameters<typeof builder.set>[0];
        type Where = Parameters<ReturnType<typeof builder.set>['where']>[0];
        return {
          set: (values: Set) => ({
            where: (where: Where) => ({
              returning: async (fields: { key: typeof appSettings.key }) => {
                await target
                  .update(appSettings)
                  .set({ value: { id: 'other', until: t + LEASE_MS } })
                  .where(eq(appSettings.key, WATCH_LEASE_KEY));
                return builder.set(values).where(where).returning(fields);
              },
            }),
          }),
        };
      };
    },
  });
  const logs: string[] = [];
  const result = await sendWatchAlerts(
    stealing,
    { ...ctx, log: (m) => void logs.push(m) },
    new Date(`${day}T12:00:00Z`),
    { clock: () => (t += 61_000) },
  );
  expect(stolen).toBe(true);
  expect(result).toEqual({ sent: 0, alerts: 0 });
  expect(sent).toHaveLength(0);
  expect(await memoryOf(watch.id)).toBeNull();
  expect(logs).toEqual(['watch alerts: stopped, another pass took over']);
  expect(await leaseOf(WATCH_LEASE_KEY)).toMatchObject({ id: 'other' });
});

it('a watch alert pass that fails ends its lease', async () => {
  await addDiscordChannel(db, member, HOOK, SECRET, fakeFetch);
  const day = '2026-11-01';
  await watchedBox(member, day, 8_000, 7_900);
  const failing: AlertContext = {
    ...ctx,
    texts: () => {
      throw new Error('texts down');
    },
  };
  await expect(
    sendWatchAlerts(db, failing, new Date(`${day}T12:00:00Z`), { clock: () => 1_000_000 }),
  ).rejects.toThrow('texts down');
  expect(await leaseOf(WATCH_LEASE_KEY)).toMatchObject({ until: 0 });
});

it('a new target saved while a watch alert was sent stands: the next ask under it is sent (A14)', async () => {
  await addDiscordChannel(db, member, HOOK, SECRET, fakeFetch);
  const { product, watch } = await watchedBox(member, '2026-11-01', 8_000, 7_900);
  const input = { packagingState: 'sealed_shrink' as const };
  // Watched again at 7,000 while the 7,900 alert goes out (the pass read the old target).
  let saved = false;
  const saving: AlertContext = {
    ...ctx,
    fetch: (async (input2: string | URL | Request, init?: RequestInit) => {
      const res = await fakeFetch(input2, init);
      if (init?.method && !saved) {
        saved = true;
        await addWatch(db, member, { productId: product.id }, { ...input, targetPriceBase: 7_000 });
      }
      return res;
    }) as typeof fetch,
  };
  const pinned = { clock: () => 1_000_000 };
  expect(await sendWatchAlerts(db, saving, new Date('2026-11-01T12:00:00Z'), pinned)).toEqual({
    sent: 1,
    alerts: 1,
  });
  // The save's memory (target part started over), not the pass's.
  expect((await memoryOf(watch.id))?.target).toBeUndefined();
  sent = [];
  await db.delete(supply);
  await db.insert(supply).values({
    productId: product.id,
    source: 'snkrdunk',
    bucket: watch.bucket,
    day: '2026-11-08',
    lowestAskBase: 6_900,
    fetchedAt: '2026-11-08T03:00:00',
  });
  expect(await sendWatchAlerts(db, ctx, new Date('2026-11-08T12:00:00Z'), pinned)).toEqual({
    sent: 1,
    alerts: 1,
  });
  expect(sent.map((s) => s.text)).toEqual(['-# buy\nBox\nask ¥6,900 SNKRDUNK under ¥7,000']);
});

it('a new target saved while a good price alert was sent keeps the zone memory: not sent twice (A14)', async () => {
  await addDiscordChannel(db, member, HOOK, SECRET, fakeFetch);
  const product = await createProduct(db, member, {
    category: 'tcg',
    kind: 'booster_box',
    name: 'Box',
    franchise: 'pokemon',
    region: 'jp',
  });
  const input = { packagingState: 'sealed_shrink' as const };
  const { watch } = await addWatch(
    db,
    member,
    { productId: product.id },
    { ...input, targetPriceBase: 9_000 },
  );
  const day = '2026-11-01';
  // In the zone (fair 9,000 under 9,500); the ask 9,500 is over the target: the zone alert only.
  await db
    .insert(signals)
    .values({ productId: product.id, bucket: watch.bucket, day, stats: signalStats(9_000) });
  await db.insert(supply).values({
    productId: product.id,
    source: 'snkrdunk',
    bucket: watch.bucket,
    day,
    lowestAskBase: 9_500,
    fetchedAt: `${day}T03:00:00`,
  });
  let saved = false;
  const saving: AlertContext = {
    ...ctx,
    fetch: (async (url: string | URL | Request, init?: RequestInit) => {
      const res = await fakeFetch(url, init);
      if (init?.method && !saved) {
        saved = true;
        await addWatch(db, member, { productId: product.id }, { ...input, targetPriceBase: 8_000 });
      }
      return res;
    }) as typeof fetch,
  };
  const now = new Date(`${day}T12:00:00Z`);
  const pinned = { clock: () => 1_000_000 };
  expect(await sendWatchAlerts(db, saving, now, pinned)).toEqual({ sent: 1, alerts: 1 });
  expect(saved).toBe(true);
  const [after] = await db.select().from(watches);
  expect(after!.targetPriceBase).toBe(8_000);
  expect(after!.alertState?.zone).toMatchObject({ on: true });
  sent = [];
  expect(await sendWatchAlerts(db, ctx, now, pinned)).toEqual({ sent: 0, alerts: 0 });
});

it('a note saved while a watch alert was sent restarts nothing: the alert is remembered (A14)', async () => {
  await addDiscordChannel(db, member, HOOK, SECRET, fakeFetch);
  const { watch } = await watchedBox(member, '2026-11-01', 8_000, 7_900);
  let saved = false;
  const saving: AlertContext = {
    ...ctx,
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const res = await fakeFetch(input, init);
      if (init?.method && !saved) {
        saved = true;
        // The stored NULL memory is saved as the empty one: the pass's compare-and-set misses.
        await updateWatch(db, member, watch.id, {
          packagingState: 'sealed_shrink',
          targetPriceBase: 8_000,
          note: 'from the shop',
        });
      }
      return res;
    }) as typeof fetch,
  };
  const now = new Date('2026-11-01T12:00:00Z');
  const pinned = { clock: () => 1_000_000 };
  expect(await sendWatchAlerts(db, saving, now, pinned)).toEqual({ sent: 1, alerts: 1 });
  expect(saved).toBe(true);
  expect((await memoryOf(watch.id))?.target).toMatchObject({ on: true });
  expect((await db.select().from(watches))[0]!.note).toBe('from the shop');
  expect(await sendWatchAlerts(db, ctx, now, pinned)).toEqual({ sent: 0, alerts: 0 });
});

it('sends no zone or target alert for a game, unverified or checked: its own alerts do (S36 C3)', async () => {
  await addDiscordChannel(db, member, HOOK, SECRET, fakeFetch);
  const day = '2026-11-01';
  const now = new Date(`${day}T12:00:00Z`);
  // Made-up games: one found only by a saved search, one also on a shop's own page.
  const watched = async (name: string) => {
    const product = await createProduct(db, member, {
      category: 'game',
      kind: 'software',
      name,
      platform: 'Alpha Station',
    });
    const { watch } = await addWatch(
      db,
      member,
      { productId: product.id },
      { targetPriceBase: 9000 },
    );
    await db.insert(productSources).values({
      productId: product.id,
      source: 'mercari',
      externalId: 'search',
      query: { keywords: [name] },
    });
    await db.insert(supply).values({
      productId: product.id,
      source: 'mercari',
      bucket: watch.bucket,
      day,
      lowestAskBase: 5_000,
      fetchedAt: `${day}T03:00:00`,
    });
    return { product, watch };
  };
  await watched('Search Game');
  expect(await sendWatchAlerts(db, ctx, now)).toEqual({ sent: 0, alerts: 0 });
  // Nothing stepped: the state stays as it was.
  expect((await db.select().from(watches))[0]!.alertState).toBeNull();

  const withShop = await watched('Shop Game');
  await db.insert(productSources).values({
    productId: withShop.product.id,
    source: 'snkrdunk',
    externalId: 'item-1',
    url: 'https://example.test/item-1',
  });
  await db.insert(supply).values({
    productId: withShop.product.id,
    source: 'snkrdunk',
    bucket: withShop.watch.bucket,
    day,
    lowestAskBase: 8_000,
    fetchedAt: `${day}T03:00:00`,
  });
  // A checked ask under the target: still nothing (S36 C3: a game wish alerts on its copies).
  expect(await sendWatchAlerts(db, ctx, now)).toEqual({ sent: 0, alerts: 0 });
  expect(sent).toEqual([]);
  expect((await db.select().from(watches)).map((w) => w.alertState)).toEqual([null, null]);
});

it("leaves a game's zone and target state as it was; cards and sealed step as before (S36 C3)", async () => {
  await addDiscordChannel(db, member, HOOK, SECRET, fakeFetch);
  // Made-up items, each found by a saved search at the same marketplace, target 9,000.
  const items = {
    Card: { category: 'tcg', kind: 'single', name: 'Card', franchise: 'pokemon', region: 'jp' },
    Box: { category: 'tcg', kind: 'booster_box', name: 'Box', franchise: 'pokemon', region: 'jp' },
    Game: { category: 'game', kind: 'software', name: 'Game', platform: 'Alpha Station' },
    Flagged: { category: 'game', kind: 'software', name: 'Flagged', platform: 'Alpha Station' },
  };
  // Sent on 10-20 and still on: before this change for the plain ones, after it for "Flagged".
  const before = { target: { on: true, sent: '2026-10-20' } };
  const flagged = { target: { ...before.target, checked: true } };
  const ids: Record<string, { productId: string; bucket: string; watchId: string }> = {};
  for (const [name, item] of Object.entries(items)) {
    const product = await createProduct(db, member, item);
    const { watch } = await addWatch(
      db,
      member,
      { productId: product.id },
      { targetPriceBase: 9000 },
    );
    await db
      .update(watches)
      .set({
        alertState: name === 'Flagged' ? flagged : before,
      })
      .where(eq(watches.id, watch.id));
    await db.insert(productSources).values({
      productId: product.id,
      source: 'mercari',
      externalId: 'search',
      query: { keywords: [name] },
    });
    ids[name] = { productId: product.id, bucket: watch.bucket, watchId: watch.id };
  }
  const asks = async (day: string, price: number, source = 'mercari') =>
    db.insert(supply).values(
      Object.values(ids).map((i) => ({
        productId: i.productId,
        source,
        bucket: i.bucket,
        day,
        lowestAskBase: price,
        fetchedAt: `${day}T03:00:00`,
      })),
    );
  const states = async () =>
    Object.fromEntries(
      await Promise.all(
        Object.entries(ids).map(async ([name, i]) => [
          name,
          (await db.select().from(watches).where(eq(watches.id, i.watchId)))[0]!.alertState,
        ]),
      ),
    );

  // Day 1: every ask is the marketplace's, under the target. Cards and sealed stay on (no alert,
  // the state untouched); the games are not stepped at all.
  await asks('2026-11-01', 5_000);
  expect(await sendWatchAlerts(db, ctx, new Date('2026-11-01T12:00:00Z'))).toEqual({
    sent: 0,
    alerts: 0,
  });
  expect(await states()).toEqual({
    Card: before,
    Box: before,
    Game: before,
    Flagged: flagged,
  });

  // Day 2: a shop's own page shows the games under the target: still nothing for them. Cards and
  // sealed: an ask over the target turns them off, with no new field.
  for (const name of ['Game', 'Flagged']) {
    await db.insert(productSources).values({
      productId: ids[name]!.productId,
      source: 'snkrdunk',
      externalId: `item-${name}`,
      url: 'https://example.test/item',
    });
  }
  await asks('2026-11-02', 9_500);
  await db.insert(supply).values(
    ['Game', 'Flagged'].map((name) => ({
      productId: ids[name]!.productId,
      source: 'snkrdunk',
      bucket: ids[name]!.bucket,
      day: '2026-11-02',
      lowestAskBase: 8_000,
      fetchedAt: '2026-11-02T03:00:00',
    })),
  );
  expect(await sendWatchAlerts(db, ctx, new Date('2026-11-02T12:00:00Z'))).toEqual({
    sent: 0,
    alerts: 0,
  });
  expect(sent).toEqual([]);
  const off = { target: { on: false, offSince: '2026-11-02', sent: '2026-10-20' } };
  expect(await states()).toEqual({
    Card: off,
    Box: off,
    Game: before,
    Flagged: flagged,
  });
});

it('keeps a mentioned Discord message within 2000 characters', async () => {
  const bodies: Record<string, unknown>[] = [];
  const record = (async (input: string | URL | Request, init?: RequestInit) => {
    if (init?.method) bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    return fakeFetch(input, init);
  }) as typeof fetch;
  const { id } = (await addDiscordChannel(db, member, HOOK, SECRET, record)) as { id: string };
  await setChannelMention(db, member, id, '123456789012345678');
  await db
    .update(users)
    .set({ preferences: { notices: { styles: { admin: { format: 'plain' } } } } })
    .where(eq(users.id, member));
  await sendToUser(db, member, linesNoticeOf('x'.repeat(2500)), { ...ctx, fetch: record });
  const content = String(bodies.at(-1)!.content);
  expect(content).toMatch(/^<@123456789012345678>\nx/);
  expect(content).toHaveLength(2000);
});

it('sends Telegram HTML it cannot read again as plain text, once', async () => {
  const tried: { parse?: string; text: string }[] = [];
  const picky = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/sendMessage')) {
      const body = JSON.parse(String(init!.body)) as { parse_mode?: string; text: string };
      tried.push({ parse: body.parse_mode, text: body.text });
      if (body.parse_mode === 'HTML')
        return Response.json(
          { ok: false, description: "Bad Request: can't parse entities" },
          { status: 400 },
        );
    }
    return fakeFetch(input, init);
  }) as typeof fetch;
  await setTelegramBot(db, '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ', SECRET, fakeFetch);
  telegramUpdates = [
    { message: { text: `/start ${telegramCode(member, SECRET)}`, chat: { id: 42 } } },
  ];
  await connectTelegram(db, member, ctx);
  sent = [];
  expect(await sendToUser(db, member, linesNoticeOf('a & b'), { ...ctx, fetch: picky })).toBe(1);
  expect(tried.map((t) => t.parse ?? 'plain')).toEqual(['HTML', 'plain']);
  expect(sent).toEqual([{ to: 'telegram:42', text: 'a & b' }]);
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
  // Set up (no "finish the setup" card in the summary).
  await saveSetting(db, 'currency', { base: 'JPY', rates: {} });
  await saveSetting(db, 'timeZone', 'Asia/Tokyo');
  await recordActivity(db, { kind: 'collect', occurredAt: '2026-10-19T00:30:00.000+09:00' });
  expect(await morningCheck(db, ctx, new Date('2026-10-21T07:58:00+09:00'))).toBe(false);
  expect(await morningCheck(db, ctx, new Date('2026-10-21T08:02:00+09:00'))).toBe(true);
  expect(sent.map((s) => s.text)).toEqual(['no collect for 55 h']);
  expect(await morningCheck(db, ctx, new Date('2026-10-21T08:04:00+09:00'))).toBe(false);
  expect(await morningCheck(db, ctx, new Date('2026-10-22T08:00:00+09:00'))).toBe(true);
});

it('tells why a sign-in failed: the account, else admins; one message per 15 minutes', async () => {
  await addDiscordChannel(db, admin, HOOK, SECRET, fakeFetch);
  const at = (minutes: number) =>
    new Date(Date.parse('2026-10-30T10:00:00+09:00') + minutes * 60_000);
  const from = { ip: '203.0.113.9', device: 'Firefox on Linux' };
  const who = { userId: member, username: 'member', ...from, passwordKnown: false };
  const send = (over: Partial<Parameters<typeof alertLoginFailure>[2]>, minutes: number) =>
    alertLoginFailure(db, ctx, { reason: 'password', ...who, ...over }, at(minutes));
  // The member has no channel: admins are told, with admins' advice.
  expect(await send({}, 0)).toBe(1);
  expect(sent.at(-1)!.text).toMatch(/member failed: wrong password\. From 203\.0\.113\.9 /);
  // Held back, but a failure with the right password has its own slot.
  expect(await send({}, 1)).toBe(0);
  expect(await send({ reason: 'code', passwordKnown: true }, 2)).toBe(1);
  expect(sent.at(-1)!.text).toMatch(/wrong code\..*Admins: password was right\./);
  expect(await send({}, 16)).toBe(1);
  expect(sent.at(-1)!.text).toContain('1 more failed');
  // With a channel of their own, the member is told (their advice), admins are not.
  await addDiscordChannel(db, member, `${HOOK}2`, SECRET, fakeFetch);
  const before = sent.length;
  const devices = {
    reason: 'devices' as const,
    passwordKnown: true,
    devices: ['iPhone', 'Mac'],
  };
  expect(await send(devices, 40)).toBe(1);
  expect(sent.length).toBe(before + 1);
  expect(sent.at(-1)!.text).toMatch(/2 devices \(iPhone, Mac\)\..*Password was right\./);
  // A turned-off account: admins again.
  await setUserDisabled(db, member, true);
  expect(await send({}, 60)).toBe(1);
  expect(sent.at(-1)!.text).not.toContain('Not you?');
  // A name nobody has travels as its length only (it may be a password in the wrong field).
  const unknown = { ...who, userId: null, username: 'secretpass' };
  expect(await alertLoginFailure(db, ctx, { reason: 'unknownUser', ...unknown }, at(0))).toBe(1);
  expect(sent.at(-1)!.text).toContain('a name of 10 characters');
  expect(sent.at(-1)!.text).not.toContain('secret');
});

it('a server update that never left its version says so: CI failed, refused, waiting for CI', async () => {
  // The app's own wording (apps/web/messages), in every language it ships.
  const messages = (l: string): AlertTexts =>
    readAlertTexts(l, join(import.meta.dirname, '../../..'));
  for (const l of ['en', 'ja', 'es']) {
    for (const k of [
      'updateCiFailed',
      'updateRefused',
      'updateWaiting',
      'ciPending',
      'ciUnknown',
    ]) {
      expect(messages(l)[k], `${l}: ${k}`).toBeTruthy();
    }
    expect(messages(l).updateCiFailed).not.toBe(messages(l).updateFailed);
  }
  const real: AlertContext = { ...ctx, texts: messages };
  await addDiscordChannel(db, admin, HOOK, SECRET, fakeFetch);
  const before = sent.length;
  const update = { from: 'abc1234', to: 'def5678' };
  expect(await alertServerUpdate(db, real, { ...update, failed: 'ci' })).toEqual({
    sent: 1,
    failed: 0,
  });
  expect(sent.at(-1)!.text).toContain(
    'Tora: GitHub CI failed on def5678, so the server did not update and keeps running abc1234. It tries again when a newer version is pushed, or when ops/update-server.sh is run by hand.',
  );
  expect(sent.at(-1)!.text).not.toContain('went back');
  expect(await alertServerUpdate(db, real, { ...update, failed: 'uncommitted' })).toEqual({
    sent: 1,
    failed: 0,
  });
  expect(sent.at(-1)!.text).toContain(
    'Tora: the server did not update to def5678: its code folder has uncommitted changes, and going back would lose them. It keeps running abc1234.',
  );
  expect(
    await alertServerUpdate(db, real, { ...update, failed: null, waiting: 'pending' }),
  ).toEqual({ sent: 1, failed: 0 });
  expect(sent.at(-1)!.text).toContain(
    "Tora: the server has not updated for 24 h and keeps running abc1234; the newest version, def5678, is waiting for GitHub CI (not finished or not started). Check the repo's Actions tab",
  );
  expect(
    await alertServerUpdate(db, real, { ...update, failed: null, waiting: 'unknown' }),
  ).toEqual({ sent: 1, failed: 0 });
  expect(sent.at(-1)!.text).toContain('(no usable answer from GitHub)');
  // A step that failed after the update began still says it went back.
  expect(await alertServerUpdate(db, real, { ...update, failed: 'build' })).toEqual({
    sent: 1,
    failed: 0,
  });
  expect(sent.at(-1)!.text).toContain('It went back to abc1234');
  expect(sent.length).toBe(before + 5);
  const log = await listActivity(db, { id: admin, admin: true });
  expect(
    log
      .filter((e) => e.action?.startsWith('serverUpdate'))
      .map((e) => [e.action, e.level])
      .reverse(),
  ).toEqual([
    ['serverUpdateCiFailed', 'failed'],
    ['serverUpdateRefused', 'failed'],
    ['serverUpdateWaiting', 'problem'],
    ['serverUpdateWaiting', 'problem'],
    ['serverUpdateFailed', 'failed'],
  ]);
});

it('a server update alert no channel took: counted as failed, retried without a second entry', async () => {
  await addDiscordChannel(db, admin, HOOK, SECRET, fakeFetch);
  const update = { from: 'abc1234', to: 'def5678', failed: 'ci' };
  const entries = async () =>
    (await listActivity(db, { id: admin, admin: true })).filter(
      (e) => e.action === 'serverUpdateCiFailed',
    ).length;
  failDiscord = true;
  expect(await alertServerUpdate(db, ctx, update)).toEqual({ sent: 0, failed: 1 });
  expect(await entries()).toBe(1);
  expect(await alertServerUpdate(db, ctx, { ...update, retry: true })).toEqual({
    sent: 0,
    failed: 1,
  });
  failDiscord = false;
  expect(await alertServerUpdate(db, ctx, { ...update, retry: true })).toEqual({
    sent: 1,
    failed: 0,
  });
  expect(await entries()).toBe(1);
  // A retry whose first try never wrote its entry (another update since) writes it.
  expect(await alertServerUpdate(db, ctx, { ...update, to: 'fed9876', retry: true })).toEqual({
    sent: 1,
    failed: 0,
  });
  expect(await entries()).toBe(2);
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

it('sends a store notice a location per Telegram message, a reply answering its post', async () => {
  await setTelegramBot(db, '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ', SECRET, fakeFetch);
  telegramUpdates = [
    { message: { text: `/start ${telegramCode(member, SECRET)}`, chat: { id: 42 } } },
  ];
  await connectTelegram(db, member, ctx);
  const post = (key: string, location: string, thread: string | null = null) => ({
    key,
    thread,
    location: { id: location, title: location, url: null },
    store: `${location} store`,
    products: [],
    text: key,
    when: '18:00',
    url: null,
    comment: !!thread,
  });
  sent = [];
  await sendToUser(db, member, storeNotice({}, [post('b:1', 'A'), post('b:2', 'B')], null), ctx);
  expect(sent.map((m) => m.text.match(/<b>(\w)<\/b>/)?.[1])).toEqual(['A', 'B']);
  // A's message was the second sent (after "connected").
  await sendToUser(db, member, storeNotice({}, [post('b:3', 'A', 'b:1')], null), ctx);
  expect(answered).toEqual([2]);
  // Replies to posts never sent here answer nothing.
  await sendToUser(db, member, storeNotice({}, [post('b:4', 'A', 'b:9')], null), ctx);
  expect(answered).toEqual([2]);
});

it('posts into a Discord forum: a post per location, each message mentioning the person', async () => {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  let posts = 0;
  const deleted = new Set<string>();
  const forum = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (!init?.method) return Response.json({ name: 'forum-hook' });
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    calls.push({ url, body });
    const thread = new URL(url).searchParams.get('thread_id');
    if (thread && deleted.has(thread)) return Response.json({ code: 10003 }, { status: 404 });
    if (thread) return new Response(null, { status: 204 });
    if (!body.thread_name) return Response.json({ code: 220001 }, { status: 400 });
    return Response.json({ id: 'm', channel_id: `t${++posts}` });
  }) as typeof fetch;
  const fctx = { ...ctx, fetch: forum };
  const { id } = (await addDiscordChannel(db, member, HOOK, SECRET, forum)) as { id: string };
  expect(await setChannelMention(db, member, id, 'not an id')).toBe(false);
  expect(await setChannelMention(db, member, id, '123456789012345678')).toBe(true);
  const post = (key: string, location: string) => ({
    key,
    location: { id: location, title: location, url: null },
    store: `${location} store`,
    products: [],
    text: key,
    when: '18:00',
    url: null,
    comment: false,
  });
  await sendToUser(db, member, storeNotice({}, [post('b:1', 'A'), post('b:2', 'B')], null), fctx);
  // Refused as a plain message, then a post per location, named with the day.
  expect(calls[0]!.body.thread_name).toBeUndefined();
  expect(calls.slice(1).map((c) => String(c.body.thread_name).split(' · ')[0])).toEqual(['A', 'B']);
  expect((await channelsOf(db, member))[0]).toMatchObject({ forum: true });
  for (const c of calls.slice(1)) {
    expect(String(c.body.content)).toMatch(/^<@123456789012345678>/);
    expect(c.body.allowed_mentions).toEqual({ parse: [], users: ['123456789012345678'] });
  }
  // Later messages about A go into A's post; other alerts into one Tora post.
  calls.length = 0;
  await sendToUser(db, member, storeNotice({}, [post('b:3', 'A')], null), fctx);
  expect(calls.map((c) => new URL(c.url).searchParams.get('thread_id'))).toEqual(['t1']);
  await sendTest(db, (await db.select().from(users).where(eq(users.id, member)))[0]!, id, fctx);
  expect(calls.at(-1)!.body.thread_name).toBe('Tora');
  // A post deleted in Discord is made again.
  deleted.add('t1');
  calls.length = 0;
  await sendToUser(db, member, storeNotice({}, [post('b:4', 'A')], null), fctx);
  expect(calls.map((c) => !!c.body.thread_name)).toEqual([false, true]);
});

it('keeps a history of every delivery, per channel, with filters', async () => {
  await addDiscordChannel(db, admin, HOOK, SECRET, fakeFetch);
  await setTelegramBot(db, '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ', SECRET, fakeFetch);
  telegramUpdates = [
    {
      message: { text: `/start ${telegramCode(admin, SECRET)}`, chat: { id: 42, username: 'me' } },
    },
  ];
  await connectTelegram(db, admin, ctx);
  await recordActivity(db, { kind: 'backup', level: 'failed', detail: { error: 'disk full' } });
  failDiscord = true;
  await alertFailures(db, ctx, toLocalIso(new Date(Date.now() - 60_000)));

  const all = await listAlertLog(db, admin, { kind: 'admin' });
  expect(all.map((e) => [e.channelKind, e.status])).toEqual(
    expect.arrayContaining([
      ['discord', 'failed'],
      ['telegram', 'sent'],
    ]),
  );
  expect(all.find((e) => e.channelKind === 'telegram')!.text).toContain('backup failed: disk full');
  expect(all.find((e) => e.status === 'failed')!.error).toMatch(/404/);
  expect(await listAlertLog(db, admin, { channel: 'discord', status: 'sent' })).toEqual([]);
  expect(await listAlertLog(db, member)).toEqual([]);
  const today = toLocalIso().slice(0, 10);
  expect(await listAlertLog(db, admin, { from: today, to: today, kind: 'admin' })).toHaveLength(2);
  expect(await listAlertLog(db, admin, { to: '2020-01-01' })).toEqual([]);

  // Removing a channel keeps its history; old rows go after 180 days.
  await db.delete(alertChannels);
  expect((await listAlertLog(db, admin, { kind: 'admin' }))[0]!.channelId).toBeNull();
  expect(await pruneAlertLog(db, new Date(Date.now() + 181 * 86_400_000))).toBeGreaterThan(0);
  expect(await db.select().from(alertLog)).toEqual([]);
});

it('sends a marketplace refusal to admins once, again when no channel took it (S36 B4)', async () => {
  await addDiscordChannel(db, admin, HOOK, SECRET, fakeFetch);
  const refusals: AlertContext = {
    ...ctx,
    texts: (l) => ({ ...TEXTS[l], marketRefused: '{source} refused: {perDay} a day from {at}' }),
  };
  const at = new Date('2026-11-24T12:00:00+09:00');
  const later = new Date('2026-11-24T12:05:00+09:00');
  await recordRefusal(db, { source: 'marketa', at });
  failDiscord = true;
  expect(await alertMarketRefusals(db, refusals, later)).toBe(0);
  failDiscord = false;
  expect(await alertMarketRefusals(db, refusals, later)).toBe(1);
  const from = toLocalIso(new Date('2026-11-27T12:00:00+09:00')).slice(0, 16).replace('T', ' ');
  expect(sent.map((s) => s.text)).toEqual([`marketa refused: 100 a day from ${from}`]);
  expect(await alertMarketRefusals(db, refusals, later)).toBe(0);
  // Other admin entries are not this pass's.
  await recordActivity(db, { kind: 'admin', action: 'gameRules', level: 'ok', detail: {} });
  expect(await alertMarketRefusals(db, refusals, later)).toBe(0);
});
