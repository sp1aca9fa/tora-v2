import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, it } from 'vitest';
import { type AlertContext, addDiscordChannel } from './alerts';
import { type Db, createDb } from './client';
import { migrateDb } from './migrate';
import {
  addStore,
  checkFeeds,
  feedStatus,
  feedTokenUser,
  listStores,
  newFeedToken,
  readPush,
  receivePush,
  removeStore,
  saveStores,
  sendFeedMessages,
  sendStoreNotices,
  setStoreCodes,
} from './stores';
import { createUser, setPreferences } from './users';

const SECRET = 'x'.repeat(32);
const HOOK = 'https://discord.com/api/webhooks/1/abc';
let db: Db;
let uid: string;
let sent: string[];
const fakeFetch = (async (_url: string, init?: RequestInit) => {
  if (init?.body) sent.push(JSON.parse(String(init.body)).content);
  return new Response('{}', { status: 200 });
}) as typeof fetch;
const ctx: AlertContext = {
  secret: SECRET,
  texts: () => ({ storePosts: 'on sale' }),
  fetch: fakeFetch,
};

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-stores-'));
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  const creds = { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] };
  uid = (await createUser(db, 'a', creds)).user.id;
  sent = [];
  await saveStores(db, 'test', [
    {
      key: 'umeda',
      chain: 'yodobashi',
      name: 'ヨドバシ梅田',
      codes: ['UMD'],
      region: '大阪府',
      lat: 34.704,
      lon: 135.496,
    },
    {
      key: 'akiba',
      chain: 'yodobashi',
      name: 'ヨドバシAkiba',
      codes: ['AKB'],
      region: '東京都',
      lat: 35.699,
      lon: 139.774,
    },
  ]);
  return () => rm(dir, { recursive: true, force: true });
});

const now = new Date('2026-10-19T12:00:00+09:00');
const post = (id: string, text: string, minutesAgo = 1) => ({
  id,
  text,
  postedAt: new Date(now.getTime() - minutesAgo * 60_000).toISOString(),
  url: `https://example.com/${id}`,
});

it('keeps admin codes when the plug-in lists its stores again', async () => {
  const [umeda] = await listStores(db);
  await setStoreCodes(db, umeda!.id, [' ｕｍ ', 'um']);
  await saveStores(db, 'test', [
    { key: 'umeda', chain: 'yodobashi', name: 'ヨドバシ梅田', codes: ['UMD', '梅田'] },
  ]);
  const again = (await listStores(db)).find((s) => s.id === umeda!.id)!;
  expect([again.codes, again.extraCodes]).toEqual([['UMD', '梅田'], ['um']]);
});

it('knows a person by their feed token, and only the newest one', async () => {
  const old = await newFeedToken(db, uid);
  const token = await newFeedToken(db, uid);
  expect(await feedTokenUser(db, token)).toBe(uid);
  expect(await feedTokenUser(db, old)).toBeNull();
  expect(await feedTokenUser(db, 'nope')).toBeNull();
});

it('checks what a feed pushes', () => {
  expect(readPush({ source: 'Bad Key', posts: [] })).toMatch(/source/);
  expect(readPush({ source: 'gamenv', posts: [{ id: '1' }] })).toMatch(/id and a text/);
  expect(
    readPush({
      source: 'gamenv',
      chain: 'yodobashi',
      posts: [{ id: '1', text: 'x', url: 'javascript:1' }],
    }),
  ).toEqual({
    source: 'gamenv',
    chain: 'yodobashi',
    posts: [{ id: '1', text: 'x', author: null, url: null, postedAt: null, chain: null }],
  });
});

it("notifies the people whose area holds a post's store, once per store for a while", async () => {
  await addDiscordChannel(db, uid, HOOK, SECRET, fakeFetch);
  await setPreferences(db, uid, {
    storeArea: { home: { mode: 'distance', point: { lat: 35.69, lon: 139.7 }, km: 10 } },
  });
  await newFeedToken(db, uid);
  const push = (posts: ReturnType<typeof post>[]) =>
    receivePush(db, uid, { source: 'gamenv', chain: 'yodobashi', posts }, now);
  // The first push only fills the list.
  expect(await sendStoreNotices(db, await push([post('1', 'AKB 販売中')]), ctx, now)).toBe(0);
  expect((await feedStatus(db, uid))?.lastSource).toBe('gamenv');
  // Umeda is out of the area, an old post makes no notice, a post seen before is not new.
  const r = await push([
    post('1', 'AKB 販売中'),
    post('2', 'UMD 販売中'),
    post('3', 'AKB 整理券', 90),
    post('4', 'AKB 30th 販売'),
  ]);
  expect(r.fresh.map((p) => p.externalId)).toEqual(['2', '3', '4']);
  expect(await sendStoreNotices(db, r, ctx, now)).toBe(1);
  expect(sent.at(-1)).toContain('ヨドバシAkiba: AKB 30th 販売');
  expect(sent.at(-1)).not.toContain('UMD');
  // Another post about the same store soon after: no second notice.
  const again = await push([post('5', 'AKB まだある')]);
  expect(await sendStoreNotices(db, again, ctx, now)).toBe(0);
});

it("tells the feed's person about unknown stores and posts maybe missed", async () => {
  await addDiscordChannel(db, uid, HOOK, SECRET, fakeFetch);
  await newFeedToken(db, uid);
  const push = (posts: ReturnType<typeof post>[], chain = 'yodobashi') =>
    receivePush(db, uid, { source: 'gamenv', chain, posts }, now);
  await push([post('1', 'AKB 販売中')]);
  sent = [];
  // A post naming no store or place Tora knows: told, on any board; one it places: not.
  const r = await push([post('2', '🦄 カードセット開始')]);
  expect(await sendFeedMessages(db, uid, r, ctx, now)).toBe(1);
  expect(sent.at(-1)).toContain('🦄 カードセット開始');
  const placed = await push([post('3', 'UMD 何か')]);
  expect(await sendFeedMessages(db, uid, placed, ctx, now)).toBe(0);
  // A whole page new at once (the pinned post known): maybe missed.
  const page = Array.from({ length: 12 }, (_, i) => post(`p${i}`, 'AKB 何も無し', 2));
  const turned = await push([post('1', 'AKB 販売中'), ...page]);
  expect(turned.gap).toEqual({ chain: 'yodobashi', posts: 12 });
  // Some overlap with the last visit: no gap.
  expect((await push([post('p0', 'x'), post('p1', 'x'), post('n1', 'AKB')])).gap).toBeNull();
});

it('tells once when the feed goes silent within the hours, and when it speaks again', async () => {
  await addDiscordChannel(db, uid, HOOK, SECRET, fakeFetch);
  await newFeedToken(db, uid);
  await setPreferences(db, uid, { storeFeed: { silentMinutes: 10, from: '08:00', to: '23:00' } });
  await receivePush(db, uid, { source: 'gamenv', posts: [] }, now);
  const later = (minutes: number) => new Date(now.getTime() + minutes * 60_000);
  sent = [];
  expect(await checkFeeds(db, ctx, later(5))).toBe(0);
  expect(await checkFeeds(db, ctx, later(11))).toBe(1);
  expect(await checkFeeds(db, ctx, later(30))).toBe(0);
  const back = await receivePush(db, uid, { source: 'gamenv', posts: [] }, later(31));
  expect(back.resumed).toBe(true);
  expect(await sendFeedMessages(db, uid, back, ctx, later(31))).toBe(1);
  // Silent outside the hours (12:00 + 11 h = 23:00): not told.
  expect(await checkFeeds(db, ctx, later(31 + 11 * 60))).toBe(0);
});

it('adds and removes stores by hand, never a plug-in one', async () => {
  const added = await addStore(db, {
    chain: 'place',
    name: '木場',
    codes: [],
    lat: 35.67,
    lon: 139.81,
  });
  expect((await listStores(db)).some((s) => s.id === added.id)).toBe(true);
  const [plugin] = (await listStores(db)).filter((s) => s.source === 'test');
  expect(await removeStore(db, plugin!.id)).toBe(false);
  expect(await removeStore(db, added.id)).toBe(true);
});
