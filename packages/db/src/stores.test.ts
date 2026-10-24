import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toLocalIso } from '@tora/core';
import { beforeEach, expect, it } from 'vitest';
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
  listStores,
  newFeedToken,
  postsPage,
  postImageIds,
  pruneStorePosts,
  readPush,
  receivePush,
  recentPosts,
  removeGlossary,
  removeStore,
  saveGlossary,
  saveStores,
  sendFeedMessages,
  sendStoreNotices,
  setStoreCodes,
  rematchPosts,
  storeCodes,
  storeGlossary,
} from './stores';
import { storePosts } from './schema';
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
    posts: [
      { id: '1', text: 'x', author: null, url: null, postedAt: null, chain: null, replyTo: null },
    ],
  });
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
  expect(sent.at(-1)).toContain('メガストアKita\n> KTA 30th 販売');
  expect(sent.at(-1)).not.toContain('MID');
  // Another post about the same store soon after: no second notice.
  const again = await push([post('5', 'KTA まだある')]);
  expect(await sendStoreNotices(db, again, ctx, now)).toBe(0);
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
  expect(text).toContain('メガストアKita\n*Snow set*\n> KTA 雪(1)');
  expect(text).toContain('Comment to メガストアKita\n*Snow set*\n> まだ列あり');
  // The date and time of each post.
  expect(text).toContain(`\n${r.fresh[0]!.postedAt.slice(5, 16).replace('T', ' ')}`);
  // The post's own text shows as written.
  expect(text).toContain('> まだ列あり \\*長い\\*');
  // Later replies come at once, also within the store's quiet time; a reply to a reply keeps the
  // thread.
  const more = await push([{ ...post('12', '完売'), replyTo: '11' }]);
  expect(more.fresh[0]).toMatchObject({ replyTo: '11', thread: '10' });
  expect(await sendStoreNotices(db, more, ctx, now)).toBe(1);
  expect(sent.at(-1)).toContain('Comment to メガストアKita\n*Snow set*');
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
  expect(sent.at(-1)).toContain('Comment to Megastore Kita');
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
