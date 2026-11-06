import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localDate, toLocalIso } from '@tora/core';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { type AlertContext, addDiscordChannel } from './alerts';
import { type Db, createDb } from './client';
import { migrateDb } from './migrate';
import {
  addGlossary,
  boardsToWatch,
  addStore,
  checkFeeds,
  dropOldImages,
  feedStatus,
  feedTokenUser,
  feedTracking,
  listStores,
  lotteryMarksOf,
  newFeedToken,
  postsPage,
  postImageIds,
  pruneStorePosts,
  readPush,
  receivePush,
  storesState,
  recentPosts,
  hideGlossary,
  removeGlossary,
  removeStore,
  saveGlossary,
  saveStores,
  saveTrackingHours,
  sendFeedMessages,
  sendStoreNotices,
  confirmedLotteryPosts,
  sendStartsExample,
  setLotteryMark,
  setStoreCodes,
  rematchPosts,
  storeCodes,
  storeGlossary,
  trackNow,
  trackerState,
} from './stores';
import { storeNotices, storePosts, users } from './schema';
import { replayMarkdown, replayNotices, replayTotals } from './stores-replay';
import { createUser, setPreferences } from './users';

const SECRET = 'x'.repeat(32);
const HOOK = 'https://discord.com/api/webhooks/1/abc';
let db: Db;
let uid: string;
let sent: string[];
const fakeFetch = (async (_url: string, init?: RequestInit) => {
  if (init?.body) {
    // A message's text and its cards (embeds) as one text.
    const body = JSON.parse(String(init.body)) as {
      content?: string;
      embeds?: { title: string; description?: string; footer?: { text: string } }[];
    };
    sent.push(
      [
        body.content,
        ...(body.embeds ?? []).flatMap((e) => [e.title, e.description, e.footer?.text]),
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }
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
      key: 'chuo',
      chain: 'megastore',
      name: 'メガストア中央',
      codes: ['MID'],
      region: '大阪府',
      lat: 34.704,
      lon: 135.496,
    },
    {
      key: 'kita',
      chain: 'megastore',
      name: 'メガストアKita',
      codes: ['KTA'],
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
  const [chuo] = await listStores(db);
  await setStoreCodes(db, chuo!.id, ['MID', ' ｕｍ ', 'um']);
  await saveStores(db, 'test', [
    { key: 'chuo', chain: 'megastore', name: 'メガストア中央', codes: ['MID', '中央'] },
  ]);
  const again = (await listStores(db)).find((s) => s.id === chuo!.id)!;
  expect([again.codes, again.extraCodes]).toEqual([['MID', '中央'], ['um']]);
  expect(storeCodes(again)).toEqual(['MID', '中央', 'um']);
  // The plug-in's code left out is removed, and stays removed.
  await setStoreCodes(db, chuo!.id, ['中央', 'um']);
  await saveStores(db, 'test', [
    { key: 'chuo', chain: 'megastore', name: 'メガストア中央', codes: ['MID', '中央'] },
  ]);
  expect(storeCodes((await listStores(db)).find((s) => s.id === chuo!.id)!)).toEqual([
    '中央',
    'um',
  ]);
});

it("matches the chain's posts again when a store's codes change", async () => {
  await newFeedToken(db, uid);
  const [chuo, kita] = await listStores(db);
  await setStoreCodes(db, kita!.id, ['KTA', '◆']);
  await receivePush(
    db,
    uid,
    { source: 'myboard', chain: 'megastore', posts: [post('1', '◆'), post('2', 'MID')] },
    now,
  );
  const ids = async () =>
    Object.fromEntries((await db.select().from(storePosts)).map((p) => [p.externalId, p.storeIds]));
  expect(await ids()).toEqual({ '1': [kita!.id], '2': [chuo!.id] });
  // ◆ meant メガストア中央 after all: moved there.
  await setStoreCodes(db, kita!.id, ['KTA']);
  await setStoreCodes(db, chuo!.id, ['MID', '◆']);
  expect(await ids()).toEqual({ '1': [chuo!.id], '2': [chuo!.id] });
  expect(await rematchPosts(db, 'megastore')).toBe(0);
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
  expect(readPush({ source: 'myboard', posts: [{ id: '1' }] })).toMatch(/id and a text/);
  expect(
    readPush({
      source: 'myboard',
      chain: 'megastore',
      posts: [{ id: '1', text: 'x', url: 'javascript:1' }],
    }),
  ).toEqual({
    source: 'myboard',
    board: null,
    watching: null,
    offered: null,
    seen: null,
    gap: null,
    hello: null,
    chain: 'megastore',
    products: null,
    next: null,
    posts: [
      { id: '1', text: 'x', author: null, url: null, postedAt: null, chain: null, replyTo: null },
    ],
  });
  const at = '2026-10-19T03:01:00.000Z';
  expect(readPush({ source: 'myboard', posts: [], next: { board: 'b', at } })).toMatchObject({
    next: { board: 'b', at },
  });
  expect(readPush({ source: 'myboard', posts: [], next: { at: 'soon' } })).toMatchObject({
    next: null,
  });
});

it("shows the feed's last read and its next one on the Stores pages", async () => {
  await newFeedToken(db, uid);
  expect((await storesState(db, uid)).status).toBeNull();
  const next = { board: 'store-b', at: new Date(now.getTime() + 60_000).toISOString() };
  await receivePush(
    db,
    uid,
    {
      source: 'myboard',
      board: 'store-a',
      watching: ['store-a', 'store-b'],
      seen: 12,
      posts: [],
      next,
    },
    now,
  );
  expect((await storesState(db, uid)).status).toEqual({
    at: toLocalIso(now),
    source: 'myboard',
    board: 'store-a',
    posts: 12,
    next: { board: 'store-b', at: toLocalIso(new Date(next.at)) },
    watched: [
      { key: 'store-a', readAt: toLocalIso(now) },
      { key: 'store-b', readAt: null },
    ],
  });
  // A push that does not say clears it.
  await receivePush(db, uid, { source: 'myboard', board: 'store-b', seen: 3, posts: [] }, now);
  expect((await storesState(db, uid)).status?.next).toBeNull();
});

it("notifies the people whose area holds a post's store, once per store for a while", async () => {
  await addDiscordChannel(db, uid, HOOK, SECRET, fakeFetch);
  await setPreferences(db, uid, {
    storeArea: { home: { mode: 'distance', point: { lat: 35.69, lon: 139.7 }, km: 10 } },
  });
  await newFeedToken(db, uid);
  const push = (posts: ReturnType<typeof post>[]) =>
    receivePush(db, uid, { source: 'myboard', chain: 'megastore', posts }, now);
  // The first push only fills the list.
  expect(await sendStoreNotices(db, await push([post('1', 'KTA 販売中')]), ctx, now)).toBe(0);
  expect((await feedStatus(db, uid))?.lastSource).toBe('myboard');
  // Chuo is out of the area, an old post makes no notice, a post seen before is not new.
  const r = await push([
    post('1', 'KTA 販売中'),
    post('2', 'MID 販売中'),
    post('3', 'KTA 整理券', 90),
    post('4', 'KTA 30th 販売'),
  ]);
  expect(r.fresh.map((p) => p.externalId)).toEqual(['2', '3', '4']);
  expect(await sendStoreNotices(db, r, ctx, now)).toBe(1);
  // A card per location (the store alone here: no section heading), each post's time as
  // Discord shows it, its link, then the post.
  expect(sent.at(-1)).toContain('on sale\nメガストアKita\n<t:');
  expect(sent.at(-1)).toContain('· [post](https://example.com/4)\n> KTA 30th 販売');
  expect(sent.at(-1)).not.toContain('MID');
  // Another post about the same store soon after: no second notice.
  const again = await push([post('5', 'KTA まだある')]);
  expect(await sendStoreNotices(db, again, ctx, now)).toBe(0);
});

it("starts a store's quiet time only when a channel took its notice", async () => {
  await addDiscordChannel(db, uid, HOOK, SECRET, fakeFetch);
  await setPreferences(db, uid, {
    storeArea: { home: { mode: 'distance', point: { lat: 35.69, lon: 139.7 }, km: 10 } },
  });
  await newFeedToken(db, uid);
  const push = (posts: ReturnType<typeof post>[]) =>
    receivePush(db, uid, { source: 'myboard', chain: 'megastore', posts }, now);
  await push([post('1', 'KTA 販売中')]);
  const refused = (async () => new Response('no', { status: 500 })) as unknown as typeof fetch;
  const r = await push([post('2', 'KTA 販売中')]);
  expect(await sendStoreNotices(db, r, { ...ctx, fetch: refused }, now)).toBe(0);
  // The next post about the same store goes out: nothing was told.
  const again = await push([post('3', 'KTA まだある')]);
  expect(await sendStoreNotices(db, again, ctx, now)).toBe(1);
  expect(sent.at(-1)).toContain('KTA まだある');
});

it("keeps a post's pictures a week and sends them after its notice", async () => {
  await addDiscordChannel(db, uid, HOOK, SECRET, fakeFetch);
  await setPreferences(db, uid, {
    storeArea: { home: { mode: 'distance', point: { lat: 35.69, lon: 139.7 }, km: 10 } },
  });
  await newFeedToken(db, uid);
  await receivePush(
    db,
    uid,
    { source: 'myboard', chain: 'megastore', posts: [post('1', 'KTA')] },
    now,
  );
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array(12).fill(0)]).toString('base64');
  const read = readPush({
    source: 'myboard',
    chain: 'megastore',
    posts: [
      {
        ...post('2', 'KTA 販売中'),
        // A picture, and a page that is no picture whatever it says (left out).
        images: [
          { url: 'https://example.com/a.jpg', data: jpeg },
          { url: 'https://example.com/b.jpg', data: Buffer.from('<html>').toString('base64') },
        ],
      },
    ],
  });
  if (typeof read === 'string') throw new Error(read);
  expect(read.posts[0]!.pictures).toHaveLength(1);
  const r = await receivePush(db, uid, read, now);
  const files: string[] = [];
  const withFiles = (async (url: string, init?: RequestInit) => {
    if (init?.body instanceof FormData)
      for (const [, v] of init.body.entries()) if (v instanceof Blob) files.push((v as File).name);
    return fakeFetch(url, init?.body instanceof FormData ? undefined : init);
  }) as typeof fetch;
  expect(await sendStoreNotices(db, r, { ...ctx, fetch: withFiles }, now)).toBe(1);
  expect(sent.at(-1)).toContain('KTA 販売中');
  expect(files).toEqual(['2-1.jpeg']);
  // Gone after a week; the post stays.
  const id = r.fresh[0]!.id;
  expect((await postImageIds(db, [id])).get(id)).toHaveLength(1);
  await dropOldImages(db, new Date(now.getTime() + 8 * 86_400_000));
  expect((await postImageIds(db, [id])).get(id)).toBeUndefined();
  expect((await recentPosts(db)).some((p) => p.id === id)).toBe(true);
});

it('sends replies at once as comments to their post, with the products its codes name', async () => {
  await addDiscordChannel(db, uid, HOOK, SECRET, fakeFetch);
  await setPreferences(db, uid, {
    storeArea: { home: { mode: 'distance', point: { lat: 35.69, lon: 139.7 }, km: 10 } },
  });
  await newFeedToken(db, uid);
  const push = (
    posts: (ReturnType<typeof post> & { replyTo?: string })[],
    products?: { code: string; meaning: string }[],
  ) => receivePush(db, uid, { source: 'myboard', chain: 'megastore', posts, products }, now);
  await push([post('1', 'KTA 販売中')]);
  // The feed's product list is saved as product codes.
  const r = await push(
    [post('10', 'KTA 雪(1)'), { ...post('11', 'まだ列あり *長い*'), replyTo: '10' }],
    [{ code: '雪', meaning: 'Snow set' }],
  );
  expect((await storeGlossary(db)).find((g) => g.code === '雪')).toMatchObject({
    meaning: 'Snow set',
    product: true,
  });
  const reply = r.fresh.find((p) => p.externalId === '11')!;
  expect(reply).toMatchObject({ replyTo: '10', thread: '10' });
  expect(reply.storeIds).toEqual(r.fresh.find((p) => p.externalId === '10')!.storeIds);
  expect(await sendStoreNotices(db, r, ctx, now)).toBe(1);
  const text = sent.at(-1)!;
  expect(text).toContain('*Snow set* · [post](https://example.com/10)\n> KTA 雪(1)');
  // The reply under its post, the products not repeated.
  expect(text).toContain('> KTA 雪(1)\n↳ <t:');
  expect(text).toContain(':R> · [reply](https://example.com/11)\n> まだ列あり');
  // The time of each post, shown by Discord in the reader's time zone.
  const at = Math.floor(Date.parse(r.fresh[0]!.postedAt) / 1000);
  expect(text).toContain(`<t:${at}:t> · <t:${at}:R>`);
  // The post's own text shows as written.
  expect(text).toContain('> まだ列あり \\*長い\\*');
  // Later replies come at once, also within the store's quiet time; a reply to a reply keeps the
  // thread.
  const more = await push([{ ...post('12', '完売'), replyTo: '11' }]);
  expect(more.fresh[0]).toMatchObject({ replyTo: '11', thread: '10' });
  expect(await sendStoreNotices(db, more, ctx, now)).toBe(1);
  // Its post not in the notice: the post's start, and its products.
  expect(sent.at(-1)).toContain('↳ *KTA 雪(1)* · <t:');
  expect(sent.at(-1)).toContain('*Snow set* · [reply](https://example.com/12)');
  // Replies naming no store are no "unknown store" post.
  expect(await sendFeedMessages(db, uid, more, ctx, now)).toBe(0);
  // A store's English label, for people reading English (its name being Japanese).
  const kita = (await listStores(db)).find((s) => s.sourceKey === 'kita')!;
  await saveStores(db, 'test', [
    {
      key: 'kita',
      chain: kita.chain,
      name: kita.name,
      language: 'ja',
      labels: { en: 'Megastore Kita' },
      codes: kita.codes,
      lat: kita.lat,
      lon: kita.lon,
    },
  ]);
  const later = await push([{ ...post('13', '終了'), replyTo: '10' }]);
  expect(await sendStoreNotices(db, later, ctx, now)).toBe(1);
  expect(sent.at(-1)).toContain('on sale\nMegastore Kita\n↳');
});

it("tells the feed's person about unknown stores and posts maybe missed", async () => {
  await addDiscordChannel(db, uid, HOOK, SECRET, fakeFetch);
  await newFeedToken(db, uid);
  const push = (posts: ReturnType<typeof post>[], chain = 'megastore') =>
    receivePush(db, uid, { source: 'myboard', chain, posts }, now);
  await push([post('1', 'KTA 販売中')]);
  sent = [];
  // A post naming no store or place Tora knows: told, on any board; one it places: not.
  const r = await push([post('2', '▲ カードセット開始')]);
  expect(await sendFeedMessages(db, uid, r, ctx, now)).toBe(1);
  expect(sent.at(-1)).toContain('▲ カードセット開始');
  const placed = await push([post('3', 'MID 何か')]);
  expect(await sendFeedMessages(db, uid, placed, ctx, now)).toBe(0);
  // A whole page new at once (the pinned post known): maybe missed.
  const page = Array.from({ length: 12 }, (_, i) => post(`p${i}`, 'KTA 何も無し', 2));
  const turned = await push([post('1', 'KTA 販売中'), ...page]);
  expect(turned.gap).toEqual({ chain: 'megastore', posts: 12 });
  // Some overlap with the last visit: no gap.
  expect((await push([post('p0', 'x'), post('p1', 'x'), post('n1', 'KTA')])).gap).toBeNull();
});

it('tells once when the feed goes silent within the hours, and when it speaks again', async () => {
  await addDiscordChannel(db, uid, HOOK, SECRET, fakeFetch);
  await newFeedToken(db, uid);
  await setPreferences(db, uid, { storeFeed: { silentMinutes: 10, from: '08:00', to: '23:00' } });
  await receivePush(db, uid, { source: 'myboard', posts: [] }, now);
  const later = (minutes: number) => new Date(now.getTime() + minutes * 60_000);
  sent = [];
  expect(await checkFeeds(db, ctx, later(5))).toBe(0);
  expect(await checkFeeds(db, ctx, later(11))).toBe(1);
  expect(await checkFeeds(db, ctx, later(30))).toBe(0);
  const back = await receivePush(db, uid, { source: 'myboard', posts: [] }, later(31));
  expect(back.resumed).toBe(true);
  expect(await sendFeedMessages(db, uid, back, ctx, later(31))).toBe(1);
  // Silent outside the hours (12:00 + 11 h = 23:00): not told.
  expect(await checkFeeds(db, ctx, later(31 + 11 * 60))).toBe(0);
});

it('counts silence from the server start after a night off, and reminds while it lasts', async () => {
  await addDiscordChannel(db, uid, HOOK, SECRET, fakeFetch);
  await newFeedToken(db, uid);
  await setPreferences(db, uid, { storeFeed: { silentMinutes: 10, from: '08:00', to: '23:00' } });
  // The feed's last push the night before; the server starts at 09:00.
  const night = new Date('2026-10-21T22:30:00+09:00');
  await receivePush(db, uid, { source: 'myboard', posts: [] }, night);
  const startedAt = new Date('2026-10-22T09:00:00+09:00');
  const at = (time: string) => new Date(`2026-10-22T${time}:00+09:00`);
  sent = [];
  expect(await checkFeeds(db, ctx, at('09:05'), { startedAt })).toBe(0);
  expect(await checkFeeds(db, ctx, at('09:11'), { startedAt })).toBe(1);
  expect(sent.at(-1)).toContain('since the server started at 10-22 09:00 (11 min');
  expect(sent.at(-1)).toContain('its last push: 10-21 22:30');
  // Still silent: again every 2 hours.
  expect(await checkFeeds(db, ctx, at('10:30'), { startedAt })).toBe(0);
  expect(await checkFeeds(db, ctx, at('11:12'), { startedAt })).toBe(1);
  expect(sent.at(-1)).toContain('still silent: nothing since 10-22 09:00 (2 h)');
  // A push clears it.
  await receivePush(db, uid, { source: 'myboard', posts: [] }, at('11:20'));
  expect(await checkFeeds(db, ctx, at('11:25'), { startedAt })).toBe(0);
});

it('lets feeds rest outside the tracking hours, and counts silence from the start', async () => {
  await addDiscordChannel(db, uid, HOOK, SECRET, fakeFetch);
  await newFeedToken(db, uid);
  await setPreferences(db, uid, { storeFeed: { silentMinutes: 10, from: '00:00', to: '23:59' } });
  await saveTrackingHours(db, { from: '09:00', to: '21:00', minDelay: 0, maxDelay: 0 });
  const at = (day: string, time: string) => new Date(`2026-10-${day}T${time}:00+09:00`);
  // Its last push before the stop; nothing through the night.
  await receivePush(db, uid, { source: 'myboard', posts: [] }, at('21', '20:58'));
  sent = [];
  expect(await checkFeeds(db, ctx, at('22', '03:00'))).toBe(0);
  expect(await feedTracking(db, at('22', '03:00'))).toEqual({
    on: false,
    until: null,
    resumeAt: '2026-10-22T09:00:00.000+09:00',
  });
  // After the start: silent only once the limit passed since the start, and said so.
  expect(await checkFeeds(db, ctx, at('22', '09:05'))).toBe(0);
  expect(await checkFeeds(db, ctx, at('22', '09:11'))).toBe(1);
  expect(sent.at(-1)).toContain('since tracking started at 10-22 09:00 (11 min');
  // An admin's hour at night: tracked once, then rest again.
  expect(await trackNow(db, 'hour', at('22', '12:00'))).toBeNull();
  const override = await trackNow(db, 'hour', at('22', '22:00'));
  expect(override?.until).toBe('2026-10-22T23:00:00.000+09:00');
  expect((await feedTracking(db, at('22', '22:30'))).on).toBe(true);
  expect((await feedTracking(db, at('22', '23:00'))).on).toBe(false);
  expect((await feedTracking(db, at('23', '22:30'))).on).toBe(false);
  await saveTrackingHours(db, null);
  expect((await feedTracking(db, at('23', '03:00'))).on).toBe(true);
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
  expect(await removeStore(db, plugin!.id)).toBeNull();
  expect(await removeStore(db, added.id)).toBe(added.name);
});

it('keeps each board apart: a board giving no posts while the feed runs is told once', async () => {
  await addDiscordChannel(db, uid, HOOK, SECRET, fakeFetch);
  await newFeedToken(db, uid);
  await setPreferences(db, uid, { storeFeed: { silentMinutes: 10, from: '00:00', to: '23:59' } });
  const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000);
  const visit = (board: string, posts: ReturnType<typeof post>[], minutes: number) =>
    receivePush(db, uid, { source: 'myboard', board, chain: board, posts }, at(minutes));
  await visit('megastore', [post('y1', 'KTA')], 0);
  await visit('arcade', [post('b1', '駅前')], 1);
  expect(Object.keys((await feedStatus(db, uid))!.boards).sort()).toEqual(['arcade', 'megastore']);
  // From then on アーケード reads nothing (an access check page) while メガストア goes on.
  for (const m of [3, 6, 9, 12]) {
    await visit('megastore', [post('y1', 'KTA')], m);
    await visit('arcade', [], m + 1);
  }
  sent = [];
  expect(await checkFeeds(db, ctx, at(13))).toBe(1);
  expect(sent.at(-1)).toContain('arcade');
  expect(await checkFeeds(db, ctx, at(15))).toBe(0);
  const back = await visit('arcade', [post('b2', '駅前')], 16);
  expect(back.boardBack).toBe('arcade');
  // The board back (feed status) and its post naming no store Tora knows: two kinds, two notices.
  expect(await sendFeedMessages(db, uid, back, ctx, at(16))).toBe(2);
});

it('says when the feed connects, with the boards it tracks, and when the list changes', async () => {
  await addDiscordChannel(db, uid, HOOK, SECRET, fakeFetch);
  await newFeedToken(db, uid);
  const push = (watching: string[], minutes = 0) =>
    receivePush(
      db,
      uid,
      { source: 'myboard', board: 'megastore', watching, posts: [] },
      new Date(now.getTime() + minutes * 60_000),
    );
  sent = [];
  const first = await push(['megastore', 'arcade']);
  expect(first.connected).toEqual({ source: 'myboard', boards: ['megastore', 'arcade'] });
  await sendFeedMessages(db, uid, first, ctx, now);
  expect(sent.at(-1)).toContain('megastore, arcade');
  expect((await push(['megastore', 'arcade'], 1)).connected).toBeNull();
  expect((await push(['megastore'], 2)).connected?.boards).toEqual(['megastore']);
  // The feed (re)started (a new tab, a new version): told again, same boards.
  const hello = await receivePush(
    db,
    uid,
    { source: 'myboard', board: 'megastore', watching: ['megastore'], hello: true, posts: [] },
    new Date(now.getTime() + 3 * 60_000),
  );
  expect(hello.connected?.boards).toEqual(['megastore']);
});

it("keeps the plug-ins' other codes and the admins' apart", async () => {
  await saveGlossary(db, 'test', [{ code: '□', meaning: 'none' }]);
  await addGlossary(db, { code: '■', meaning: 'a product' });
  await addGlossary(db, { code: '■', meaning: 'another product' });
  expect(await storeGlossary(db)).toEqual([
    { code: '□', meaning: 'none', byHand: false },
    { code: '■', meaning: 'another product', byHand: true },
  ]);
  await removeGlossary(db, '■');
  expect((await storeGlossary(db)).map((e) => e.code)).toEqual(['□']);
  // A plug-in's code an admin turned off: left out, listed with `withHidden`, back on.
  await hideGlossary(db, '□', true);
  expect(await storeGlossary(db)).toEqual([]);
  expect(await storeGlossary(db, true)).toEqual([
    { code: '□', meaning: 'none', byHand: false, hidden: true },
  ]);
  await hideGlossary(db, '□', false);
  expect((await storeGlossary(db)).map((e) => e.code)).toEqual(['□']);
});

it('drops posts older than a month', async () => {
  await newFeedToken(db, uid);
  await receivePush(
    db,
    uid,
    { source: 'myboard', posts: [post('old', 'x', 40 * 24 * 60), post('new', 'y')] },
    now,
  );
  expect(await pruneStorePosts(db, now)).toBe(1);
  expect((await recentPosts(db)).map((p) => p.externalId)).toEqual(['new']);
});

it('sends back the boards chosen in the app, among those the feed can read', async () => {
  await newFeedToken(db, uid);
  expect(await boardsToWatch(db, uid)).toBeNull();
  await receivePush(
    db,
    uid,
    { source: 'myboard', board: 'a', offered: ['a', 'b', 'c'], posts: [] },
    now,
  );
  await setPreferences(db, uid, { storeFeed: { boards: ['b', 'z'] } });
  expect(await boardsToWatch(db, uid)).toEqual(['b']);
});

it('takes what the feed says it saw: posts on the page and a page turned over', async () => {
  await newFeedToken(db, uid);
  await receivePush(
    db,
    uid,
    { source: 'myboard', board: 'b', chain: 'megastore', posts: [post('1', 'x')] },
    now,
  );
  // Only new posts sent (none), but the page showed 20: the board gave posts.
  await receivePush(
    db,
    uid,
    { source: 'myboard', board: 'b', chain: 'megastore', seen: 20, posts: [] },
    now,
  );
  expect((await feedStatus(db, uid))!.boards.b).toMatchObject({ posts: 20 });
  const turned = await receivePush(
    db,
    uid,
    {
      source: 'myboard',
      board: 'b',
      chain: 'megastore',
      seen: 20,
      gap: true,
      posts: [post('2', 'y')],
    },
    now,
  );
  expect(turned.gap).toEqual({ chain: 'megastore', posts: 1 });
});

it("lists lottery posts by their words, with each person's marks", async () => {
  await newFeedToken(db, uid);
  const posts = [
    post('l1', 'MID raffle today', 3),
    post('l2', 'nothing', 2),
    post('l3', '50%_raffle', 1),
  ];
  await receivePush(db, uid, { source: 'myboard', chain: 'megastore', posts }, now);
  const ids = (r: { posts: { externalId: string }[] }) => r.posts.map((p) => p.externalId);
  const words = ['raffle'];
  expect(ids(await postsPage(db, { offset: 0, limit: 10, words }))).toEqual(['l3', 'l1']);
  // LIKE's own characters in a word are plain text.
  expect(ids(await postsPage(db, { offset: 0, limit: 10, words: ['%_r'] }))).toEqual(['l3']);
  expect(ids(await postsPage(db, { offset: 0, limit: 10, words: [] }))).toEqual([]);
  // A lottery's own posts: no replies, none only mentioning one.
  await receivePush(
    db,
    uid,
    {
      source: 'myboard',
      chain: 'megastore',
      posts: [
        { ...post('l4', 'raffle too', 0), replyTo: 'l1' },
        post('l5', 'only the raffle queue', 0),
        post('l6', 'raffle？', 0),
      ],
    },
    now,
  );
  expect(ids(await postsPage(db, { offset: 0, limit: 10, words })).toSorted()).toEqual([
    'l1',
    'l3',
    'l4',
    'l5',
    'l6',
  ]);
  expect(
    ids(
      await postsPage(db, {
        offset: 0,
        limit: 10,
        words,
        notWords: ['raffle queue', '?'],
        replies: false,
      }),
    ),
  ).toEqual(['l3', 'l1']);
  const [l1] = (await postsPage(db, { offset: 0, limit: 10, words: ['MID'] })).posts;
  await setLotteryMark(db, uid, l1!.id, 'hidden');
  await setLotteryMark(db, uid, 'no-such-post', 'applied');
  expect([...(await lotteryMarksOf(db, uid))]).toEqual([[l1!.id, 'hidden']]);
  expect(
    ids(
      await postsPage(db, {
        offset: 0,
        limit: 10,
        words,
        notIds: [l1!.id],
        replies: false,
        notWords: ['queue', '?'],
      }),
    ),
  ).toEqual(['l3']);
  await setLotteryMark(db, uid, l1!.id, 'applied');
  expect([...(await lotteryMarksOf(db, uid))]).toEqual([[l1!.id, 'applied']]);
  await setLotteryMark(db, uid, l1!.id, null);
  expect((await lotteryMarksOf(db, uid)).size).toBe(0);
});

it('pages the posts, newest first, all or those of some stores', async () => {
  await newFeedToken(db, uid);
  const [chuo] = await listStores(db);
  const posts = Array.from({ length: 5 }, (_, i) =>
    post(`p${i}`, i % 2 ? 'MID 販売' : '何も', 10 - i),
  );
  await receivePush(db, uid, { source: 'myboard', chain: 'megastore', posts }, now);
  const first = await postsPage(db, { offset: 0, limit: 2 });
  expect([first.posts.map((p) => p.externalId), first.more]).toEqual([['p4', 'p3'], true]);
  const last = await postsPage(db, { offset: 4, limit: 2 });
  expect([last.posts.map((p) => p.externalId), last.more]).toEqual([['p0'], false]);
  // After the last one shown: right even when a post left the list meanwhile.
  const [, shown] = first.posts;
  const after = await postsPage(db, {
    offset: 0,
    limit: 2,
    before: shown!,
    notIds: [first.posts[0]!.id],
  });
  expect(after.posts.map((p) => p.externalId)).toEqual(['p2', 'p1']);
  const mine = await postsPage(db, { offset: 0, limit: 10, storeIds: [chuo!.id] });
  expect(mine.posts.map((p) => p.externalId)).toEqual(['p3', 'p1']);
  const named = await postsPage(db, { offset: 0, limit: 10, named: true });
  expect(named.posts.map((p) => p.externalId)).toEqual(['p3', 'p1']);
  const unnamed = await postsPage(db, { offset: 0, limit: 10, named: false });
  expect(unnamed.posts.map((p) => p.externalId)).toEqual(['p4', 'p2', 'p0']);
  const since = toLocalIso(new Date(now.getTime() - 8 * 60_000));
  const recent = await postsPage(db, { offset: 0, limit: 10, since });
  expect(recent.posts.map((p) => p.externalId)).toEqual(['p4', 'p3', 'p2']);
  const board = await postsPage(db, { offset: 0, limit: 10, chain: 'megastore' });
  expect(board.posts).toHaveLength(5);
  expect((await postsPage(db, { offset: 0, limit: 10, chain: null })).posts).toEqual([]);
});

describe('store notice choices (S29)', () => {
  const area = { home: { mode: 'distance' as const, point: { lat: 35.69, lon: 139.7 }, km: 10 } };
  const words = [
    { code: 'started', meaning: 'x', saleStart: true },
    { code: 'not started yet', meaning: 'x', notSaleStart: true },
    { code: 'raffle', meaning: 'x', lottery: true },
    { code: 'apply', meaning: 'x', lotteryCue: true },
  ];
  const by = (id: string, text: string, author: string, minutesAgo = 1, replyTo?: string) => ({
    ...post(id, text, minutesAgo),
    author,
    ...(replyTo ? { replyTo } : {}),
  });
  const push = (posts: ReturnType<typeof by>[], at = now) =>
    receivePush(db, uid, { source: 'myboard', chain: 'megastore', posts }, at);
  const start = async (mode?: 'all' | 'starts' | 'off') => {
    await addDiscordChannel(db, uid, HOOK, SECRET, fakeFetch);
    await setPreferences(db, uid, { storeArea: area, ...(mode ? { storeNoticeMode: mode } : {}) });
    await saveGlossary(db, 'test', words);
    await newFeedToken(db, uid);
    await push([by('0', 'first page', 'x', 300)], new Date(now.getTime() - 1000));
  };
  const send = async (posts: ReturnType<typeof by>[], at = now, c = ctx) =>
    sendStoreNotices(db, await push(posts, at), c, at);

  it("'all' explicitly is the same as no choice, message for message", async () => {
    const run = async (mode?: 'all') => {
      const dir = await mkdtemp(join(tmpdir(), 'tora-all-'));
      db = createDb({ url: `file:${join(dir, 'test.db')}` });
      await migrateDb(db);
      const creds = { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] };
      uid = (await createUser(db, 'a', creds)).user.id;
      await saveStores(db, 'test', [
        {
          key: 'kita',
          chain: 'megastore',
          name: 'メガストアKita',
          codes: ['KTA'],
          region: '東京都',
          lat: 35.699,
          lon: 139.774,
        },
      ]);
      await start(mode);
      sent = [];
      await send([by('1', 'KTA started', 'a'), by('2', 'KTA more', 'b')]);
      await send([by('3', 'still a line', 'c', 1, '1')]);
      await send([by('4', 'KTA later', 'd')]);
      await rm(dir, { recursive: true, force: true });
      return sent;
    };
    const unset = await run();
    expect(unset.length).toBe(2);
    expect(await run('all')).toEqual(unset);
  });

  it("'all' does not read the new word kinds as codes around products", async () => {
    await start();
    await saveGlossary(db, 'test', [{ code: '開けた', meaning: 'x', saleStart: true }]);
    await saveGlossary(db, 'feed:myboard', [{ code: '雪', meaning: 'Snow set', product: true }]);
    await send([by('1', 'KTA 雪開けた', 'a')]);
    // The word stays an ordinary word: a short code in that run is not taken for a product.
    expect(sent.at(-1)).not.toContain('Snow set');
  });

  it("'off' sends no store notices", async () => {
    await start('off');
    expect(await send([by('1', 'KTA started', 'a')])).toBe(0);
    expect(sent).toEqual([]);
  });

  it("'starts' sends for a start word, also in a reply, and not for other posts", async () => {
    await start('starts');
    expect(await send([by('1', 'KTA line forming', 'a')])).toBe(0);
    expect(await send([by('2', 'KTA not started yet', 'b')])).toBe(0);
    expect(await send([by('3', 'MID started', 'b')])).toBe(0); // out of the area
    expect(await send([by('4', 'it started', 'c', 1, '1')])).toBe(1);
    expect(sent.at(-1)).toContain('it started');
  });

  it("'starts' sends one short notice for ten people saying so, no thread, no pictures", async () => {
    await start('starts');
    const bodies: unknown[] = [];
    const counted = (async (u: string, init?: RequestInit) => {
      bodies.push(init?.body);
      return fakeFetch(u, init);
    }) as typeof fetch;
    const ten = Array.from({ length: 10 }, (_, i) => ({
      ...by(`t${i}`, `KTA started ${i}\nsecond line`, `p${i}`),
      pictures: [{ bytes: Buffer.from('x'), contentType: 'image/png', url: 'https://x.test/1' }],
    }));
    expect(await send(ten, now, { ...ctx, fetch: counted })).toBe(1);
    expect(bodies).toHaveLength(1);
    expect(typeof bodies[0]).toBe('string'); // no files
    expect(sent.at(-1)).toContain('KTA started');
    expect(sent.at(-1)).not.toContain('second line');
    expect(sent.at(-1)).not.toContain('example.com');
    // Still quiet for that store.
    expect(await send([by('after', 'KTA started again', 'q')])).toBe(0);
  });

  it("'starts' sends a burst: 3 different people within 15 minutes, from stored posts", async () => {
    await start('starts');
    expect(await send([by('1', 'KTA hm', 'a', 14)])).toBe(0);
    expect(await send([by('2', 'KTA hm', 'a', 5)])).toBe(0);
    expect(await send([by('3', 'KTA hm', 'b', 4)])).toBe(0);
    expect(await send([by('4', 'KTA hm', 'c', 1)])).toBe(1);
    expect(sent.at(-1)).toContain('3 people in 15 minutes');
  });

  it("'starts' sends again after a failed send, with the next post about the store", async () => {
    await start('starts');
    const refused = (async () => new Response('no', { status: 500 })) as unknown as typeof fetch;
    expect(await send([by('1', 'KTA started', 'a')], now, { ...ctx, fetch: refused })).toBe(0);
    expect(await send([by('2', 'KTA hm', 'b')])).toBe(1);
    expect(sent.at(-1)).toContain('KTA started');
  });

  it("'starts' never fires on a confirmed lottery's thread, nor counts it in a burst", async () => {
    await start('starts');
    expect(await send([by('l', 'KTA raffle, apply', 'a')])).toBe(0);
    expect(await send([by('l2', 'it started', 'b', 1, 'l')])).toBe(0);
    expect(await send([by('l3', 'yes', 'c', 1, 'l2')])).toBe(0);
    // Three lottery people and two others are not three others.
    expect(await send([by('n1', 'KTA hm', 'd')])).toBe(0);
    expect(await send([by('n2', 'KTA hm', 'e')])).toBe(0);
    expect(await send([by('n3', 'KTA hm', 'f')])).toBe(1);
  });

  it("is per person: another person's choice and area stay theirs", async () => {
    await start('starts');
    const creds = { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] };
    const other = (await createUser(db, 'b', creds)).user.id;
    await addDiscordChannel(db, other, 'https://discord.com/api/webhooks/2/def', SECRET, fakeFetch);
    await setPreferences(db, other, { storeArea: area });
    // A post with no start word: only the person with no choice, on everything.
    expect(await send([by('1', 'KTA hm', 'a')])).toBe(1);
    await setPreferences(db, other, { storeArea: { home: { mode: 'stores', storeIds: [] } } });
    // Out of the other's area now: only the person on 'starts'.
    expect(await send([by('2', 'KTA started', 'b')])).toBe(1);
  });

  it("'starts' keeps a reply's products from a first post of an earlier push", async () => {
    await start('starts');
    await saveGlossary(db, 'feed:myboard', [
      { code: 'X1', meaning: 'Snow set', product: true, byHand: true } as never,
    ]);
    await push([by('f', 'KTA X1', 'a')]);
    const refused = (async () => new Response('no', { status: 500 })) as unknown as typeof fetch;
    // The reply's notice fails, so it goes with a later push whose own threads do not name it.
    expect(await send([by('r', 'it started', 'b', 1, 'f')], now, { ...ctx, fetch: refused })).toBe(
      0,
    );
    expect(await send([by('n', 'KTA hm', 'c')])).toBe(1);
    expect(sent.at(-1)).toContain('it started');
    expect(sent.at(-1)).toContain('Snow set');
  });

  it("'starts' sends a start word that came in late, at its real time, on a later push", async () => {
    await start('starts');
    const r = await push([by('late', 'KTA started', 'a', 90)]);
    expect(r.fresh).toHaveLength(1);
    expect(await sendStoreNotices(db, r, ctx, now)).toBe(1);
    const moment = Math.floor(
      Date.parse(new Date(now.getTime() - 90 * 60_000).toISOString()) / 1000,
    );
    expect(sent.at(-1)).toContain(`<t:${moment}:t>`);
  });

  it("'all' and a first push still ignore a late post", async () => {
    await start('all');
    expect(await send([by('late', 'KTA started', 'a', 90)])).toBe(0);
    await saveGlossary(db, 'x', []);
    const first = await receivePush(
      db,
      uid,
      { source: 'other', chain: 'megastore', posts: [by('z', 'KTA started', 'a', 90)] },
      now,
    );
    expect(first.first).toBe(true);
    await setPreferences(db, uid, { storeNoticeMode: 'starts' });
    expect(await sendStoreNotices(db, first, ctx, now)).toBe(0);
  });

  it('sends the example to the person only, and says how many channels took it', async () => {
    await start('off');
    const [me] = await db.select().from(users).where(eq(users.id, uid));
    expect(await sendStartsExample(db, me!, ctx)).toBe(1);
    expect(sent.at(-1)).toContain('a test');
  });

  it('reads the newest feed across accounts, its time only, for an account with none', async () => {
    expect((await trackerState(db)).feed).toBeNull();
    await newFeedToken(db, uid);
    expect((await trackerState(db)).feed).toBeNull(); // a token that never sent
    await receivePush(db, uid, { source: 'myboard', chain: 'megastore', posts: [] }, now);
    const creds = { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] };
    const other = (await createUser(db, 'b', creds)).user.id;
    await newFeedToken(db, other);
    const older = new Date(now.getTime() - 3600_000);
    await receivePush(db, other, { source: 'myboard', chain: 'megastore', posts: [] }, older);
    expect((await trackerState(db)).feed).toEqual({ at: toLocalIso(now) });
  });

  it('finds a confirmed lottery from a reply whose first post is older than the list', async () => {
    await start();
    await push([by('l', 'KTA raffle, apply', 'a', 3000)]);
    const reply = await push([by('l2', 'I applied', 'b', 1, 'l')]);
    const plain = await push([by('n', 'KTA hm', 'c')]);
    const gone = await push([by('g', 'hello', 'd', 1, 'nobody')]);
    const posts = [...reply.fresh, ...plain.fresh, ...gone.fresh];
    const ids = await confirmedLotteryPosts(db, posts, await storeGlossary(db));
    expect(ids).toEqual(new Set([reply.fresh[0]!.id]));
    await saveGlossary(db, 'test', []);
    expect((await confirmedLotteryPosts(db, posts, await storeGlossary(db))).size).toBe(0);
  });

  it('replays what would be sent, the same as sending, and changes nothing', async () => {
    await start('starts');
    const later = (m: number) => new Date(now.getTime() + m * 60_000);
    const at = (m: number) => later(m).toISOString();
    const steps: [ReturnType<typeof by>[], Date][] = [
      [[by('1', 'KTA hm', 'a')], now],
      [[by('2', 'KTA started', 'b')], now],
      [[by('3', 'KTA started', 'c')], now],
      [[{ ...by('r', 'KTA raffle, apply', 'd'), postedAt: at(40) }], later(40)],
      [[{ ...by('4', 'KTA started', 'e'), postedAt: at(70) }], later(71)],
      [[{ ...by('5', 'it went', 'f', 1, '4'), postedAt: at(72) }], later(72)],
    ];
    let live = 0;
    for (const [posts, when] of steps) live += await send(posts, when);
    const before = {
      posts: await db.select().from(storePosts),
      user: await db.select().from(users),
      notices: await db.select().from(storeNotices),
    };
    sent = [];
    const day = localDate(now);
    const r = await replayNotices(db, { username: 'a', from: day, to: day });
    const totals = replayTotals(r);
    expect(live).toBe(2);
    expect(totals.starts).toBe(live);
    expect(totals.off).toBe(0);
    expect(totals.all).toBeGreaterThan(totals.starts);
    expect(r.starts.map((s) => s.why)).toEqual(['word', 'word']);
    expect(r.leavingNow).toMatchObject([{ replies: 0, line: 'KTA raffle, apply' }]);
    expect(r.notSent[0]!.threads.map((t) => t.line)).toContain('KTA hm');
    expect(replayMarkdown(r, 'T')).toContain('## Messages per day');
    // Sent nothing, wrote nothing.
    expect(sent).toEqual([]);
    expect(await db.select().from(storePosts)).toEqual(before.posts);
    expect(await db.select().from(users)).toEqual(before.user);
    expect(await db.select().from(storeNotices)).toEqual(before.notices);
    await expect(replayNotices(db, { username: 'nobody' })).rejects.toThrow('no user');
  });

  it('replays without looking ahead: a post received later makes no earlier burst', async () => {
    await start('starts');
    const later = new Date(now.getTime() + 60 * 60_000);
    await push([by('a', 'KTA hm', 'a', 2)]);
    await push([by('b', 'KTA hm', 'b', 1)]);
    await push([by('c', 'KTA hm', 'c', 3)], later);
    const day = localDate(now);
    const r = await replayNotices(db, { username: 'a', from: day, to: day });
    // The third came in an hour late: too old to make a notice, as in sendStoreNotices.
    expect(replayTotals(r).starts).toBe(0);
  });
});
