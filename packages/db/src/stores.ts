// Store notices data (requirements S25): stores from store directory plug-ins, posts pushed by
// feeds, and the notices they make for the people whose area holds the store.
import {
  type CodeMeaning,
  DEFAULT_FEED_PREFS,
  PLACE,
  type StoreEntry,
  linesNotice,
  localDate,
  locationsOf,
  productsInPost,
  storeNotice,
  storeLabelIn,
  storeUnknownNotice,
  storesInArea,
  storesInPost,
  type TrackingHours,
  type TrackingOverride,
  type TrackingSettings,
  toLocalIso,
  trackingOverride,
  trackingState,
  withinHours,
} from '@tora/core';
import { and, desc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import {
  type AlertContext,
  type AlertTexts,
  appUrl,
  localeFor,
  sendToUser,
  textsFor,
} from './alerts';
import type { Db } from './client';
import { readSetting, saveSetting } from './registry';
import {
  type BoardState,
  type Store,
  type StorePost,
  feedTokens,
  storeNotices,
  storePostImages,
  storePosts,
  stores,
  users,
} from './schema';

/** The Now page's row of posts naming only areas (apps/web stores/page.tsx). */
const UNKNOWN_SHOP_ROW = 'unknown-shop';
/** Posts this old or older make no notice (a feed's first push brings a page of old ones). */
const FRESH_MINUTES = 30;
/** Posts about one store within this time after a notice make no new one. */
const QUIET_MINUTES = 30;
const POSTS_PER_PUSH = 200;
/** A push this long all new (one pinned post aside) counts as a page turned over. */
const GAP_MIN_POSTS = 10;
/** Pictures in a post kept (the first ones), their size at most, and for how long. */
const IMAGES_PER_POST = 4;
const IMAGE_MAX_BYTES = 8_000_000;
const IMAGE_DAYS = 7;
/** Pictures attached to one notice at most (Discord's and Telegram's limit). */
const IMAGES_PER_NOTICE = 10;

/** A store as a directory plug-in lists it: its key there and what it is. */
export interface ListedStore extends StoreEntry {
  key: string;
}

/**
 * Saves a directory plug-in's stores (the admin's code changes are kept); only the ones that
 * changed are written, since it runs with every collect. A chain whose codes changed has its posts
 * matched again. Returns how many were written.
 */
export async function saveStores(db: Db, source: string, list: ListedStore[]): Promise<number> {
  const saved = new Map(
    (await db.select().from(stores).where(eq(stores.source, source))).map((s) => [s.sourceKey, s]),
  );
  let written = 0;
  const rematch = new Set<string>();
  for (const { key, ...s } of list) {
    const values = {
      chain: s.chain,
      chainLabel: s.chainLabel ?? null,
      name: s.name,
      language: s.language ?? null,
      labels: s.labels && Object.keys(s.labels).length ? s.labels : null,
      codes: s.codes,
      region: s.region ?? null,
      lat: s.lat ?? null,
      lon: s.lon ?? null,
    };
    const had = saved.get(key);
    if (
      had &&
      (Object.keys(values) as (keyof typeof values)[]).every(
        (k) => JSON.stringify(had[k]) === JSON.stringify(values[k]),
      )
    )
      continue;
    written++;
    if (JSON.stringify(had?.codes) !== JSON.stringify(values.codes)) rematch.add(values.chain);
    forgetStores();
    await db
      .insert(stores)
      .values({ source, sourceKey: key, ...values })
      .onConflictDoUpdate({
        target: [stores.source, stores.sourceKey],
        set: { ...values, updatedAt: toLocalIso() },
      });
  }
  for (const chain of rematch) await rematchPosts(db, chain);
  return written;
}

/** Sorted here, not by the database (which would count every row twice for the sort). */
export async function listStores(db: Pick<Db, 'select'>): Promise<Store[]> {
  const list = await db.select().from(stores);
  return list.sort(
    (a, b) =>
      a.chain.localeCompare(b.chain) ||
      (a.region ?? '').localeCompare(b.region ?? '') ||
      a.name.localeCompare(b.name),
  );
}

/**
 * The stores, kept a few minutes in memory: a feed pushes every minute or so and the list rarely
 * changes (a hosted database bills every row read). Changes made here clear it.
 */
const STORES_CACHE_MS = 5 * 60_000;
let storesCache = new WeakMap<object, { at: number; list: Store[] }>();
const forgetStores = () => {
  storesCache = new WeakMap();
};
export async function cachedStores(db: Pick<Db, 'select'>, now = Date.now()): Promise<Store[]> {
  const had = storesCache.get(db);
  if (had && now - had.at <= STORES_CACHE_MS) return had.list;
  const list = await listStores(db);
  storesCache.set(db, { at: now, list });
  return list;
}

/** The codes a store is known by: its plug-in's (less those the admin removed) and the admin's. */
export const storeCodes = (s: Store) => [
  ...s.codes.filter((c) => !s.hiddenCodes?.includes(c)),
  ...(s.extraCodes ?? []),
];

const cleanCode = (c: string) => c.normalize('NFKC').trim();

/**
 * Sets every code of a store (admins): those not from its plug-in are kept as the admin's, the
 * plug-in's left out are removed (they stay removed when the plug-in lists them again). The
 * chain's posts are matched again. Returns the store's name (null: no such store).
 */
export async function setStoreCodes(
  db: Db,
  storeId: string,
  codes: string[],
): Promise<string | null> {
  const [store] = await db.select().from(stores).where(eq(stores.id, storeId));
  if (!store) return null;
  const clean = [...new Set(codes.map(cleanCode).filter(Boolean))];
  const own = new Set(store.codes.map(cleanCode));
  const extra = clean.filter((c) => !own.has(c));
  const hidden = store.codes.filter((c) => !clean.includes(cleanCode(c)));
  forgetStores();
  await db
    .update(stores)
    .set({
      extraCodes: extra.length ? extra : null,
      hiddenCodes: hidden.length ? hidden : null,
      updatedAt: toLocalIso(),
    })
    .where(eq(stores.id, storeId));
  await rematchPosts(db, store.chain);
  return store.name;
}

/**
 * Matches a chain's posts to the stores again, after its codes changed (a place's: every board's
 * posts). Replies naming no store keep taking their post's. Nobody is told again. Returns how many
 * posts moved.
 */
export async function rematchPosts(db: Db, chain: string): Promise<number> {
  const listed = (await listStores(db)).map((s) => ({ ...s, codes: storeCodes(s) }));
  const posts = await db
    .select({
      id: storePosts.id,
      source: storePosts.source,
      externalId: storePosts.externalId,
      chain: storePosts.chain,
      text: storePosts.text,
      author: storePosts.author,
      replyTo: storePosts.replyTo,
      storeIds: storePosts.storeIds,
    })
    .from(storePosts)
    .where(chain === PLACE ? undefined : eq(storePosts.chain, chain))
    .orderBy(storePosts.postedAt);
  const now = new Map<string, string[]>();
  let moved = 0;
  for (const p of posts) {
    const own = storesInPost(`${p.author ?? ''}\n${p.text}`, listed, p.chain).map((s) => s.id);
    const parent = p.replyTo ? now.get(`${p.source}|${p.replyTo}`) : undefined;
    const ids = own.length ? own : p.replyTo ? (parent ?? p.storeIds) : [];
    now.set(`${p.source}|${p.externalId}`, ids);
    if (JSON.stringify(ids) === JSON.stringify(p.storeIds)) continue;
    moved++;
    await db.update(storePosts).set({ storeIds: ids }).where(eq(storePosts.id, p.id));
  }
  return moved;
}

// ---- Feed tokens ----

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** A new feed token for a person (the old one stops working); shown once. */
export async function newFeedToken(db: Db, userId: string): Promise<string> {
  const token = `tora_feed_${randomBytes(24).toString('base64url')}`;
  const tokenHash = hashToken(token);
  await db
    .insert(feedTokens)
    .values({ userId, tokenHash })
    .onConflictDoUpdate({
      target: feedTokens.userId,
      set: { tokenHash, lastSeenAt: null, lastSource: null, updatedAt: toLocalIso() },
    });
  return token;
}

/** The person a token belongs to (an enabled account), or null. */
export async function feedTokenUser(db: Db, token: string): Promise<string | null> {
  if (!token.startsWith('tora_feed_')) return null;
  const [row] = await db
    .select({ userId: feedTokens.userId })
    .from(feedTokens)
    .innerJoin(users, eq(users.id, feedTokens.userId))
    .where(and(eq(feedTokens.tokenHash, hashToken(token)), isNull(users.disabledAt)));
  return row?.userId ?? null;
}

export async function feedStatus(db: Db, userId: string) {
  const [row] = await db
    .select({
      lastSeenAt: feedTokens.lastSeenAt,
      lastSource: feedTokens.lastSource,
      boards: feedTokens.boards,
      watching: feedTokens.watching,
      offered: feedTokens.offered,
    })
    .from(feedTokens)
    .where(eq(feedTokens.userId, userId));
  return row
    ? {
        lastSeenAt: row.lastSeenAt,
        lastSource: row.lastSource,
        boards: row.boards ?? {},
        watching: row.watching,
        offered: row.offered,
      }
    : null;
}

// ---- Posts ----

/** A post as a feed pushes it. */
export interface PushedPost {
  /** The post's id on its site (or any stable key). */
  id: string;
  text: string;
  /** The poster's name: some name their store in it. */
  author?: string | null;
  url?: string | null;
  /** ISO time, when the site shows one. */
  postedAt?: string | null;
  /** The board's chain, when it differs from the push's. */
  chain?: string | null;
  /** A reply (comment): the id of the post it answers. */
  replyTo?: string | null;
  /** Its pictures (JPEG, PNG, WebP or GIF), base64, with where they were found. */
  images?: { url?: string | null; data: string }[] | null;
}

/** A post's picture as read from a push. */
export interface PostImage {
  url: string | null;
  bytes: Buffer;
  contentType: string;
}

/** The picture's type from its first bytes (what it says it is does not count), or null. */
export function imageType(bytes: Buffer): string | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return 'image/png';
  if (bytes.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif';
  if (
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  )
    return 'image/webp';
  return null;
}

/** A post's pictures that are pictures and not too big (the others left out). */
function readImages(images: unknown): PostImage[] {
  if (!Array.isArray(images)) return [];
  const out: PostImage[] = [];
  for (const i of images.slice(0, IMAGES_PER_POST)) {
    if (!i || typeof i.data !== 'string' || i.data.length > (IMAGE_MAX_BYTES * 4) / 3 + 4) continue;
    const bytes = Buffer.from(i.data, 'base64');
    const contentType = imageType(bytes);
    if (!contentType || bytes.length > IMAGE_MAX_BYTES) continue;
    const url =
      typeof i.url === 'string' && /^https?:\/\//.test(i.url) ? i.url.slice(0, 500) : null;
    out.push({ url, bytes, contentType });
  }
  return out;
}

export interface Push {
  /** The feed's key ("myboard"). */
  source: string;
  /** The board (page) read, when the feed reads several ("store-a"). */
  board?: string | null;
  /** All the boards the feed watches, in turn (told to the person when it changes). */
  watching?: string[] | null;
  /** Every board the feed can read (chosen from in the app). */
  offered?: string[] | null;
  /**
   * Posts on the page read (the feed may send only the ones it did not send before); a board
   * whose page shows none for too long is told.
   */
  seen?: number | null;
  /** The feed saw a whole page of new posts at once (posts may have been missed). */
  gap?: boolean | null;
  /** The feed (re)started: a new tab or browser session, or a new version (told "connected"). */
  hello?: boolean | null;
  /** The board's chain ("megastore"), when the whole push is one chain's. */
  chain?: string | null;
  /**
   * The feed's own product codes (a board's list of what its codes stand for), named in notices
   * next to the store; saved when they change.
   */
  products?: { code: string; meaning: string }[] | null;
  /** When (an ISO time) and where (a board) the feed reads next: the Stores pages show it. */
  next?: { board?: string | null; at: string } | null;
  posts: (PushedPost & { pictures?: PostImage[] })[];
}

/** How far ahead a feed's next read may be said to be. */
const NEXT_MAX_MS = 6 * 3_600_000;

/** A list of board keys, or null. */
const keys = (v: unknown) =>
  Array.isArray(v)
    ? v
        .filter((w): w is string => typeof w === 'string' && /^[a-z0-9_-]{1,40}$/.test(w))
        .slice(0, 20)
    : null;

/** A push's next read, when it is a time within the next hours (else none). */
function readNext(v: unknown): Push['next'] {
  const n = v as { board?: unknown; at?: unknown } | null;
  if (!n || typeof n !== 'object' || typeof n.at !== 'string') return null;
  const at = Date.parse(n.at);
  if (Number.isNaN(at) || at > Date.now() + NEXT_MAX_MS) return null;
  const board = typeof n.board === 'string' && /^[a-z0-9_-]{1,40}$/.test(n.board) ? n.board : null;
  return { board, at: n.at };
}

/** Checks a pushed body: the push, or what is wrong with it. */
export function readPush(body: unknown): Push | string {
  const b = body as Partial<Push> | null;
  if (!b || typeof b !== 'object') return 'body must be a JSON object';
  if (typeof b.source !== 'string' || !/^[a-z0-9_-]{1,40}$/.test(b.source))
    return 'source: a short key (a-z, 0-9, - or _)';
  if (!Array.isArray(b.posts)) return 'posts: a list (empty for a heartbeat)';
  if (b.posts.length > POSTS_PER_PUSH) return `posts: at most ${POSTS_PER_PUSH} a push`;
  for (const p of b.posts) {
    if (!p || typeof p.id !== 'string' || !p.id || typeof p.text !== 'string')
      return 'each post needs an id and a text';
    if (p.postedAt != null && Number.isNaN(Date.parse(p.postedAt)))
      return `post ${p.id}: postedAt is not a time`;
  }
  return {
    source: b.source,
    board: typeof b.board === 'string' && /^[a-z0-9_-]{1,40}$/.test(b.board) ? b.board : null,
    watching: Array.isArray(b.watching)
      ? b.watching.filter((w) => typeof w === 'string' && /^[a-z0-9_-]{1,40}$/.test(w)).slice(0, 20)
      : null,
    offered: keys(b.offered),
    seen: typeof b.seen === 'number' && b.seen >= 0 ? Math.round(b.seen) : null,
    gap: typeof b.gap === 'boolean' ? b.gap : null,
    hello: b.hello === true ? true : null,
    chain: typeof b.chain === 'string' ? b.chain : null,
    products: Array.isArray(b.products)
      ? b.products
          .filter(
            (e) =>
              e &&
              typeof e.code === 'string' &&
              typeof e.meaning === 'string' &&
              e.code.trim() &&
              e.code.length <= 20 &&
              e.meaning.length <= 200,
          )
          .slice(0, 500)
          .map((e) => ({ code: e.code.trim(), meaning: e.meaning.trim() }))
      : null,
    next: readNext(b.next),
    posts: b.posts.map((p) => {
      const pictures = readImages(p.images);
      return {
        id: p.id.slice(0, 200),
        text: p.text.slice(0, 2000),
        author: typeof p.author === 'string' ? p.author.slice(0, 100) : null,
        url: typeof p.url === 'string' && /^https?:\/\//.test(p.url) ? p.url.slice(0, 500) : null,
        postedAt: p.postedAt ?? null,
        chain: typeof p.chain === 'string' ? p.chain : null,
        replyTo: typeof p.replyTo === 'string' && p.replyTo ? p.replyTo.slice(0, 200) : null,
        ...(pictures.length ? { pictures } : {}),
      };
    }),
  };
}

/**
 * Saves the posts not seen before (any feed may have sent them), each with the stores it names;
 * marks the person's feed as alive. Returns the new posts.
 */
export interface Received {
  fresh: StorePost[];
  /** The feed's very first push (only fills the list). */
  first: boolean;
  /** The feed had been told silent: it speaks again. */
  resumed: boolean;
  /** A whole page of new posts at once on a board seen before: posts may have been missed. */
  gap: { chain: string | null; posts: number } | null;
  /** The board had been told silent: it gives posts again. */
  boardBack?: string | null;
  /** The feed connected (first push, back after a silence, or other boards): what it watches. */
  connected?: { source: string; boards: string[] } | null;
  /** The boards chosen in the app for the feed to watch (null: the feed decides). */
  watch?: string[] | null;
  /** The feed's person, as read with the push (spares reading them again). */
  user?: typeof users.$inferSelect | null;
}

/** A push's board key: the board, else its chain, else the feed. */
const boardKey = (push: Pick<Push, 'board' | 'chain' | 'source'>) =>
  push.board ?? push.chain ?? push.source;

export async function receivePush(
  db: Db,
  userId: string,
  push: Push,
  now = new Date(),
): Promise<Received> {
  const at = toLocalIso(now);
  // The person and their feed in one read: the push's answer and messages need both.
  const [row] = await db
    .select({ user: users, token: feedTokens })
    .from(feedTokens)
    .innerJoin(users, eq(users.id, feedTokens.userId))
    .where(eq(feedTokens.userId, userId));
  const token = row?.token;
  const key = boardKey(push);
  const had = token?.boards?.[key];
  const seen = push.seen ?? push.posts.length;
  const read = seen > 0;
  const board: BoardState = {
    at,
    posts: seen,
    readAt: read ? at : (had?.readAt ?? null),
    alertedAt: read ? null : (had?.alertedAt ?? null),
  };
  await db
    .update(feedTokens)
    .set({
      lastSeenAt: at,
      lastSource: push.source,
      silenceAlertedAt: null,
      boards: { ...token?.boards, [key]: board },
      ...(push.watching ? { watching: push.watching } : {}),
      ...(push.offered ? { offered: push.offered } : {}),
      next: push.next
        ? { board: push.next.board ?? null, at: toLocalIso(new Date(push.next.at)) }
        : null,
    })
    .where(eq(feedTokens.userId, userId));
  const resumed = !!token?.silenceAlertedAt;
  const boardBack = read && had?.alertedAt ? key : null;
  const watching = push.watching ?? [key];
  const connected =
    !token?.lastSeenAt ||
    resumed ||
    push.hello ||
    (push.watching && push.watching.join() !== token?.watching?.join())
      ? { source: push.source, boards: watching }
      : null;
  const offered = push.offered ?? token?.offered ?? null;
  const chosen = row?.user.preferences?.storeFeed?.boards?.filter(
    (b) => !offered || offered.includes(b),
  );
  const watch = chosen?.length ? chosen : null;
  const base = { resumed, boardBack, connected, watch, user: row?.user ?? null };
  if (push.products?.length) {
    await saveGlossary(
      db,
      `feed:${push.source}`,
      push.products.map((e) => ({ ...e, product: true })),
    );
  }
  if (!push.posts.length) return { fresh: [], first: false, gap: null, ...base };
  // Whether the feed, and this board's chain, sent posts before: one row read each, not a count.
  const [known] = await db
    .select({ one: sql<number>`1` })
    .from(storePosts)
    .where(eq(storePosts.source, push.source))
    .limit(1);
  // A feed that tells whether it saw a whole new page spares this read.
  const [seenChain] =
    push.gap != null
      ? []
      : await db
          .select({ one: sql<number>`1` })
          .from(storePosts)
          .where(
            and(
              eq(storePosts.source, push.source),
              push.chain ? eq(storePosts.chain, push.chain) : isNull(storePosts.chain),
            ),
          )
          .limit(1);
  const all = await cachedStores(db);
  const listed = all.map((s) => ({ ...s, codes: storeCodes(s) }));
  const fresh: StorePost[] = [];
  // Replies take their thread and, naming no store, the stores of the post they answer: the
  // posts answered are read once (those of this push are saved first).
  const answered = [...new Set(push.posts.flatMap((p) => (p.replyTo ? [p.replyTo] : [])))];
  const parents = new Map(
    (answered.length
      ? await db
          .select()
          .from(storePosts)
          .where(and(eq(storePosts.source, push.source), inArray(storePosts.externalId, answered)))
      : []
    ).map((r) => [r.externalId, r]),
  );
  const ordered = [...push.posts.filter((p) => !p.replyTo), ...push.posts.filter((p) => p.replyTo)];
  for (const p of ordered) {
    const chain = p.chain ?? push.chain ?? null;
    const parent = p.replyTo ? parents.get(p.replyTo) : undefined;
    const own = storesInPost(`${p.author ?? ''}\n${p.text}`, listed, chain).map((s) => s.id);
    const [row] = await db
      .insert(storePosts)
      .values({
        source: push.source,
        externalId: p.id,
        chain,
        text: p.text,
        author: p.author ?? null,
        url: p.url ?? null,
        postedAt: p.postedAt ? toLocalIso(new Date(p.postedAt)) : at,
        receivedAt: at,
        storeIds: own.length ? own : (parent?.storeIds ?? []),
        replyTo: p.replyTo ?? null,
        thread: p.replyTo ? (parent?.thread ?? p.replyTo) : null,
        fedBy: userId,
      })
      .onConflictDoNothing()
      .returning();
    if (row) fresh.push(row);
    // A post may be answered within the same push.
    if (row) parents.set(p.id, row);
    if (row && p.pictures?.length) {
      await db.insert(storePostImages).values(
        p.pictures.map((img, position) => ({
          postId: row.id,
          position,
          bytes: img.bytes,
          contentType: img.contentType,
          sourceUrl: img.url,
          createdAt: at,
        })),
      );
    }
  }
  await dropOldImages(db, now);
  // A page shows a fixed number of posts (one may be pinned): all of them new means the page
  // turned over completely since the last visit.
  const gap = (
    push.gap != null
      ? push.gap
      : !!seenChain && push.posts.length >= GAP_MIN_POSTS && fresh.length >= push.posts.length - 1
  )
    ? { chain: push.chain ?? null, posts: fresh.length }
    : null;
  return { fresh, first: !known, gap, ...base };
}

const fill = (text: string, params: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? ''));

/**
 * What the feed's own person is told about a push (no silent failures): the feed speaks again
 * after a silence, posts that may have been missed, and recent posts naming no store or place
 * Tora knows (unless switched off).
 */
export async function sendFeedMessages(
  db: Db,
  userId: string,
  received: Received,
  ctx: AlertContext,
  now = new Date(),
): Promise<number> {
  const since = toLocalIso(new Date(now.getTime() - FRESH_MINUTES * 60_000));
  const unknownPosts = received.first
    ? []
    : received.fresh.filter((p) => !p.storeIds.length && !p.replyTo && p.postedAt >= since);
  // Most pushes have nothing to say: nothing else is read then.
  if (
    !received.connected &&
    !received.resumed &&
    !received.boardBack &&
    !received.gap &&
    !unknownPosts.length
  )
    return 0;
  const user =
    received.user ?? (await db.select().from(users).where(eq(users.id, userId)))[0] ?? null;
  if (!user) return 0;
  const prefs = { ...DEFAULT_FEED_PREFS, ...user.preferences?.storeFeed };
  const t = await textsFor(db, user, ctx);
  const base = await appUrl(db);
  const link = base ? `${base}/stores` : null;
  const status: { text: string; role: 'info' | 'warning' }[] = [];
  if (received.connected)
    status.push({
      text: fill(
        t.feedConnected ??
          'Tora: connected to the browser feed ({source}), tracking these boards: {boards}',
        { source: received.connected.source, boards: received.connected.boards.join(', ') },
      ),
      role: 'info',
    });
  else if (received.resumed)
    status.push({ text: t.feedBack ?? 'Tora: the store feed is sending again.', role: 'info' });
  if (received.boardBack)
    status.push({
      text: fill(t.boardBack ?? 'Tora: the {board} board gives posts again.', {
        board: received.boardBack,
      }),
      role: 'info',
    });
  if (received.gap)
    status.push({
      text: fill(
        t.feedGap ??
          'Tora: {posts} new posts at once on the {chain} board: some posts may have been missed between two visits.',
        { posts: received.gap.posts, chain: received.gap.chain ?? '-' },
      ),
      role: 'warning',
    });
  let sent = 0;
  if (status.length) {
    sent += await sendToUser(db, userId, linesNotice('feed', null, status, link, t.storeLink), ctx);
  }
  // Any board: with places, every post naming an area is placed; the rest may be a code Tora
  // does not know yet (or no sighting at all: questions, chat).
  if (prefs.unknown && unknownPosts.length) {
    sent += await sendToUser(
      db,
      userId,
      storeUnknownNotice(
        t,
        unknownPosts.map((p) => ({
          author: p.author,
          text: p.text,
          when: p.postedAt.slice(5, 16).replace('T', ' '),
          url: p.url,
        })),
        link,
      ),
      ctx,
    );
  }
  return sent;
}

/** Drops posts older than a month. */
export async function pruneStorePosts(db: Db, now = new Date()): Promise<number> {
  const gone = await db
    .delete(storePosts)
    .where(
      lt(storePosts.postedAt, toLocalIso(new Date(now.getTime() - KEEP_POSTS_DAYS * 86_400_000))),
    )
    .returning({ id: storePosts.id });
  return gone.length;
}

/** While a feed or a board stays silent, it is told again this often (within the person's hours). */
const REMIND_HOURS = 2;

/** The local "MM-DD HH:mm" of a time. */
const shortAt = (iso: string) => toLocalIso(new Date(iso)).slice(5, 16).replace('T', ' ');

/**
 * Boards of a running feed that gave no posts for longer than the limit (counted from the app's
 * start when that is later: time the server was off is no board's silence), each told once and
 * again every 2 hours while it lasts.
 */
async function checkBoards(
  db: Db,
  ctx: AlertContext,
  user: typeof users.$inferSelect,
  boards: Record<string, BoardState>,
  silentMinutes: number,
  now: Date,
  startedAt: number,
): Promise<number> {
  const limit = now.getTime() - silentMinutes * 60_000;
  const remind = now.getTime() - REMIND_HOURS * 3_600_000;
  const quiet = Object.entries(boards).filter(
    ([, b]) =>
      Math.max(Date.parse(b.readAt ?? b.at), startedAt) < limit &&
      (!b.alertedAt || Date.parse(b.alertedAt) < remind),
  );
  if (!quiet.length) return 0;
  const t = await textsFor(db, user, ctx);
  const base = await appUrl(db);
  const lines = quiet.map(([key, b]) =>
    fill(
      t.boardSilent ??
        'Tora: the {board} board has given no posts since {since} (last visit {at}, {posts} posts read), while the feed runs: no notices from it until it does.',
      {
        board: key,
        since: b.readAt ? shortAt(b.readAt) : '-',
        at: shortAt(b.at),
        posts: b.posts,
      },
    ),
  );
  const at = toLocalIso(now);
  const next = { ...boards };
  for (const [key, b] of quiet) next[key] = { ...b, alertedAt: at };
  await db.update(feedTokens).set({ boards: next }).where(eq(feedTokens.userId, user.id));
  await sendToUser(
    db,
    user.id,
    linesNotice(
      'feed',
      null,
      lines.map((text) => ({ text, role: 'warning' as const })),
      base ? `${base}/stores` : null,
      t.storeLink,
    ),
    ctx,
  );
  return quiet.length;
}

/**
 * The silence check, run every few minutes by the app (no silent failures): a feed quiet for
 * longer than its person's limit, within their hours, is told, and again every 2 hours while it
 * lasts; the next push clears it. Silence counts from the app's start (`startedAt`, a long-lived
 * server) when that is later than the feed's last push: after a night with the server off, the
 * feed is only told once it stayed silent with the server on, and the message says since when.
 */
export async function checkFeeds(
  db: Db,
  ctx: AlertContext,
  now = new Date(),
  opts: { startedAt?: Date } = {},
): Promise<number> {
  const rows = await db
    .select({ token: feedTokens, user: users })
    .from(feedTokens)
    .innerJoin(users, eq(users.id, feedTokens.userId))
    .where(isNull(users.disabledAt));
  if (now.getTime() - prunedAt > PRUNE_EVERY_MS) {
    prunedAt = now.getTime();
    await pruneStorePosts(db, now);
  }
  const time = toLocalIso(now).slice(11, 16);
  // Outside the tracking hours feeds rest: no silence then, and none counted from before the start.
  const tracking = trackingState(await readTracking(db), now);
  if (!tracking.on) return 0;
  const startedAt = Math.max(
    opts.startedAt?.getTime() ?? 0,
    tracking.since ? Date.parse(tracking.since) : 0,
  );
  let told = 0;
  for (const { token, user } of rows) {
    if (!token.lastSeenAt) continue;
    const prefs = { ...DEFAULT_FEED_PREFS, ...user.preferences?.storeFeed };
    if (!withinHours(time, prefs.from, prefs.to)) continue;
    const lastSeen = Date.parse(token.lastSeenAt);
    const since = Math.max(lastSeen, startedAt);
    const minutes = Math.floor((now.getTime() - since) / 60_000);
    if (minutes < prefs.silentMinutes) {
      // The feed runs, but a board may give nothing (an access check, a changed page) or no
      // longer be visited.
      told += await checkBoards(
        db,
        ctx,
        user,
        token.boards ?? {},
        prefs.silentMinutes,
        now,
        startedAt,
      );
      continue;
    }
    const alerted = token.silenceAlertedAt ? Date.parse(token.silenceAlertedAt) : null;
    if (alerted !== null && now.getTime() - alerted < REMIND_HOURS * 3_600_000) continue;
    const t = await textsFor(db, user, ctx);
    const base = await appUrl(db);
    const sinceText = shortAt(new Date(since).toISOString());
    const text =
      alerted !== null
        ? fill(
            t.feedStillSilent ??
              'Tora: the store feed is still silent: nothing since {since} ({hours} h). Check the feed (for a userscript: its browser tab).',
            { since: sinceText, hours: Math.floor(minutes / 60) },
          )
        : startedAt > lastSeen && tracking.since && Date.parse(tracking.since) === startedAt
          ? fill(
              t.feedSilentTracking ??
                'Tora: the store feed has sent nothing since tracking started at {started} ({minutes} min; its last push: {last}). No store notices until it sends. Check the feed (for a userscript: its browser tab).',
              { started: sinceText, minutes, last: shortAt(token.lastSeenAt) },
            )
          : startedAt > lastSeen
            ? fill(
                t.feedSilentStart ??
                  'Tora: the store feed has sent nothing since the server started at {started} ({minutes} min; its last push: {last}). No store notices until it sends. Check the feed (for a userscript: its browser tab).',
                { started: sinceText, minutes, last: shortAt(token.lastSeenAt) },
              )
            : fill(
                t.feedSilent ??
                  'Tora: the store feed ({source}) has been silent since {since} ({minutes} min): no store notices until it sends again. Check the feed (for a userscript: its browser tab).',
                { source: token.lastSource ?? '-', since: sinceText, minutes },
              );
    await db
      .update(feedTokens)
      .set({ silenceAlertedAt: toLocalIso(now) })
      .where(eq(feedTokens.userId, user.id));
    await sendToUser(
      db,
      user.id,
      linesNotice(
        'feed',
        null,
        [{ text, role: 'warning' }],
        base ? `${base}/stores` : null,
        t.storeLink,
      ),
      ctx,
    );
    told++;
  }
  return told;
}

/** Forgets a board the feed no longer reads (its state and its silence alerts). */
export async function forgetBoard(db: Db, userId: string, key: string) {
  const [token] = await db
    .select({ boards: feedTokens.boards })
    .from(feedTokens)
    .where(eq(feedTokens.userId, userId));
  if (!token?.boards?.[key]) return;
  const { [key]: _, ...rest } = token.boards;
  await db.update(feedTokens).set({ boards: rest }).where(eq(feedTokens.userId, userId));
}

/** Posts are kept this long (the page shows the latest; a post seen again later is new). */
const KEEP_POSTS_DAYS = 30;
const PRUNE_EVERY_MS = 60 * 60_000;
let prunedAt = 0;

/**
 * The store as people read it in a notice: its label in their language ("Megastore Ekimae"), else
 * the chain and name as written; a place: "駅前 area".
 */
function storeLabel(store: Store, t: AlertTexts, locale: string): string {
  const label = storeLabelIn(store, locale);
  return store.chain === PLACE
    ? fill(t.storeArea ?? '{name} area', { name: label ?? store.name })
    : (label ?? [store.chainLabel, store.name].filter(Boolean).join(' '));
}

/**
 * Notices of new posts and replies naming a store of a person's area (posts of the last 30 minutes,
 * none for a feed's first push). A post: one per store every 30 minutes. A reply (a comment on a
 * post, e.g. "still a line", "sold out"): every one at once, marked as a comment to its post. Each
 * names the time, the store and the products its codes stand for, then the post as written.
 */
export async function sendStoreNotices(
  db: Db,
  received: Received,
  ctx: AlertContext,
  now = new Date(),
): Promise<number> {
  if (received.first) return 0;
  const since = toLocalIso(new Date(now.getTime() - FRESH_MINUTES * 60_000));
  const posts = received.fresh.filter((p) => p.storeIds.length && p.postedAt >= since);
  if (!posts.length) return 0;
  const all = await cachedStores(db);
  const byId = new Map(all.map((s) => [s.id, s]));
  const locationOf = locationsOf(all);
  const people = (await db.select().from(users).where(isNull(users.disabledAt))).filter(
    (u) => u.preferences?.storeArea,
  );
  const today = localDate(now);
  const quiet = toLocalIso(new Date(now.getTime() - QUIET_MINUTES * 60_000));
  const base = await appUrl(db);
  // Products by their codes; other codes (stores, states) only help read the runs around them.
  const glossary = await storeGlossary(db);
  const others = [
    ...all.flatMap((s) => [s.name, ...storeCodes(s)]),
    ...glossary.filter((g) => !g.product).map((g) => g.code),
  ];
  const named = (text: string) => productsInPost(text, glossary, others).map((g) => g.meaning);
  // A reply naming no product takes its thread's (the first post's).
  const threads = [...new Set(posts.flatMap((p) => (p.thread ? [p.thread] : [])))];
  const firsts = new Map(
    (threads.length
      ? await db
          .select({ id: storePosts.externalId, text: storePosts.text })
          .from(storePosts)
          .where(
            and(eq(storePosts.source, posts[0]!.source), inArray(storePosts.externalId, threads)),
          )
      : []
    ).map((r) => [r.id, r.text]),
  );
  // The posts' pictures, attached to the notices that carry them.
  const pictures = await imagesOf(
    db,
    posts.map((p) => p.id),
  );
  let sent = 0;
  for (const user of people) {
    const area = storesInArea(user.preferences!.storeArea, all, today);
    const mine = posts.filter((p) => p.storeIds.some((id) => area.has(id)));
    if (!mine.length) continue;
    const storeIds = [...new Set(mine.filter((p) => !p.replyTo).flatMap((p) => p.storeIds))].filter(
      (id) => area.has(id),
    );
    const last = new Map(
      (storeIds.length
        ? await db
            .select()
            .from(storeNotices)
            .where(and(eq(storeNotices.userId, user.id), inArray(storeNotices.storeId, storeIds)))
        : []
      ).map((n) => [n.storeId, n.sentAt]),
    );
    const [t, locale] = await Promise.all([textsFor(db, user, ctx), localeFor(db, user)]);
    // New posts: the latest per store not told within the quiet time; replies: all of them.
    const told = new Set<string>();
    const chosen: StorePost[] = [];
    for (const id of storeIds) {
      if ((last.get(id) ?? '') > quiet) continue;
      const post = mine.filter((p) => !p.replyTo && p.storeIds.includes(id)).at(-1)!;
      told.add(id);
      if (!chosen.includes(post)) chosen.push(post);
    }
    chosen.push(...mine.filter((p) => p.replyTo));
    if (!chosen.length) continue;
    chosen.sort((a, b) => a.postedAt.localeCompare(b.postedAt));
    // A card per location (the Now page's rows), a section per store; posts naming only areas
    // open the page's "area known" row.
    const title = (s: Store) =>
      s.chain === PLACE ? (storeLabelIn(s, locale) ?? s.name) : storeLabel(s, t, locale);
    const message = storeNotice(
      t,
      chosen.flatMap((p) => {
        const ids = p.storeIds.filter((id) => area.has(id));
        const areasOnly = ids.every((id) => byId.get(id)?.chain === PLACE);
        let products = named(p.text);
        if (!products.length && p.thread) products = named(firsts.get(p.thread) ?? '');
        return ids.map((id) => {
          const at = byId.get(locationOf.get(id) ?? id) ?? byId.get(id)!;
          const row = areasOnly ? UNKNOWN_SHOP_ROW : at.id;
          return {
            key: `${p.source}:${p.externalId}`,
            thread: p.thread ? `${p.source}:${p.thread}` : null,
            location: {
              id: at.id,
              title: title(at),
              url: base ? `${base}/stores?open=${encodeURIComponent(row)}` : null,
            },
            store: storeLabel(byId.get(id)!, t, locale),
            products,
            text: p.text,
            // "18:00", as the Now page shows it.
            when: p.postedAt.slice(11, 16),
            at: p.postedAt,
            url: p.url,
            comment: !!p.replyTo,
            threadText: p.thread ? (firsts.get(p.thread) ?? null) : null,
          };
        });
      }),
      base ? `${base}/stores` : null,
    );
    const images = chosen
      .flatMap((p) =>
        (pictures.get(p.id) ?? []).map((img, i) => ({
          name: `${p.externalId}-${i + 1}.${img.contentType.split('/')[1]}`,
          contentType: img.contentType,
          bytes: img.bytes,
        })),
      )
      .slice(0, IMAGES_PER_NOTICE);
    if (images.length) message.images = images;
    for (const id of told) {
      await db
        .insert(storeNotices)
        .values({ userId: user.id, storeId: id, sentAt: toLocalIso(now) })
        .onConflictDoUpdate({
          target: [storeNotices.userId, storeNotices.storeId],
          set: { sentAt: toLocalIso(now) },
        });
    }
    if (await sendToUser(db, user.id, message, ctx)) sent++;
  }
  return sent;
}

/** The pictures of these posts (by post id), in their order. */
async function imagesOf(
  db: Db,
  postIds: string[],
): Promise<Map<string, (typeof storePostImages.$inferSelect)[]>> {
  const map = new Map<string, (typeof storePostImages.$inferSelect)[]>();
  if (!postIds.length) return map;
  const rows = await db
    .select()
    .from(storePostImages)
    .where(inArray(storePostImages.postId, postIds))
    .orderBy(storePostImages.position);
  for (const r of rows) map.set(r.postId, [...(map.get(r.postId) ?? []), r]);
  return map;
}

/** The ids of these posts' pictures (by post id), in their order, without the bytes. */
export async function postImageIds(db: Db, postIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (!postIds.length) return map;
  const rows = await db
    .select({ id: storePostImages.id, postId: storePostImages.postId })
    .from(storePostImages)
    .where(inArray(storePostImages.postId, postIds))
    .orderBy(storePostImages.position);
  for (const r of rows) map.set(r.postId, [...(map.get(r.postId) ?? []), r.id]);
  return map;
}

export async function getPostImage(db: Db, id: string) {
  const [row] = await db.select().from(storePostImages).where(eq(storePostImages.id, id));
  return row ?? null;
}

let droppedAt = 0;

/** Deletes pictures older than a week (at most once an hour); the posts stay. */
export async function dropOldImages(db: Db, now = new Date()): Promise<void> {
  if (now.getTime() - droppedAt < 3_600_000) return;
  droppedAt = now.getTime();
  await db
    .delete(storePostImages)
    .where(
      lt(storePostImages.createdAt, toLocalIso(new Date(now.getTime() - IMAGE_DAYS * 86_400_000))),
    );
}

/** The latest posts, newest first. */
export async function recentPosts(db: Db, limit = 50): Promise<StorePost[]> {
  return db.select().from(storePosts).orderBy(desc(storePosts.postedAt)).limit(limit);
}

/** The source of stores and places an admin adds by hand. */
export const ADMIN_STORES = 'admin';

/** A store or place an admin adds by hand (chain `place` for a place). */
export async function addStore(db: Db, entry: StoreEntry): Promise<Store> {
  forgetStores();
  const [row] = await db
    .insert(stores)
    .values({
      source: ADMIN_STORES,
      sourceKey: randomBytes(8).toString('hex'),
      chain: entry.chain,
      chainLabel: entry.chainLabel ?? null,
      name: entry.name,
      codes: entry.codes,
      region: entry.region ?? null,
      lat: entry.lat ?? null,
      lon: entry.lon ?? null,
    })
    .returning();
  return row!;
}

/** Removes a store an admin added (plug-in stores come back with their plug-in). */
export async function removeStore(db: Db, storeId: string): Promise<string | null> {
  forgetStores();
  const [gone] = await db
    .delete(stores)
    .where(and(eq(stores.id, storeId), eq(stores.source, ADMIN_STORES)))
    .returning({ name: stores.name });
  return gone?.name ?? null;
}

// ---- Codes that are no store ----

/** Each store list plug-in's other codes (by its key), and the ones admins add. */
const GLOSSARY_KEY = 'storeGlossary';
const ADMIN_GLOSSARY_KEY = 'storeGlossaryAdmin';

/** Saves a store list plug-in's other codes (only when they changed: it runs with every collect). */
export async function saveGlossary(db: Db, key: string, entries: CodeMeaning[]): Promise<void> {
  const all = (await readSetting<Record<string, CodeMeaning[]>>(db, GLOSSARY_KEY)) ?? {};
  if (JSON.stringify(all[key] ?? []) === JSON.stringify(entries)) return;
  await saveSetting(db, GLOSSARY_KEY, { ...all, [key]: entries });
}

/** The other codes: the plug-ins' and the admins' (marked by hand). */
export async function storeGlossary(
  db: Pick<Db, 'select'>,
): Promise<(CodeMeaning & { byHand: boolean })[]> {
  const [lists, own] = await Promise.all([
    readSetting<Record<string, CodeMeaning[]>>(db, GLOSSARY_KEY),
    readSetting<CodeMeaning[]>(db, ADMIN_GLOSSARY_KEY),
  ]);
  return [
    ...Object.values(lists ?? {})
      .flat()
      .map((e) => ({ ...e, byHand: false })),
    ...(own ?? []).map((e) => ({ ...e, byHand: true })),
  ];
}

/** An other code an admin adds (a code given again replaces its meaning). */
export async function addGlossary(db: Db, entry: CodeMeaning): Promise<void> {
  const own = (await readSetting<CodeMeaning[]>(db, ADMIN_GLOSSARY_KEY)) ?? [];
  await saveSetting(db, ADMIN_GLOSSARY_KEY, [...own.filter((e) => e.code !== entry.code), entry]);
}

export async function removeGlossary(db: Db, code: string): Promise<void> {
  const own = (await readSetting<CodeMeaning[]>(db, ADMIN_GLOSSARY_KEY)) ?? [];
  await saveSetting(
    db,
    ADMIN_GLOSSARY_KEY,
    own.filter((e) => e.code !== code),
  );
}

/**
 * The boards the person chose in the app for their feed to watch (those it can read), sent back in
 * the answer to every push so the feed follows; null when the feed decides.
 */
export async function boardsToWatch(db: Db, userId: string): Promise<string[] | null> {
  const [row] = await db
    .select({ preferences: users.preferences, offered: feedTokens.offered })
    .from(users)
    .leftJoin(feedTokens, eq(feedTokens.userId, users.id))
    .where(eq(users.id, userId));
  const chosen = row?.preferences?.storeFeed?.boards;
  if (!chosen?.length) return null;
  const offered = row?.offered;
  const boards = offered ? chosen.filter((b) => offered.includes(b)) : chosen;
  return boards.length ? boards : null;
}

// ---- The board tracker's working hours ----

const TRACKING_KEY = 'boardTracking';

/** The tracking hours an admin set (none: around the clock) and an admin's tracking outside them. */
export async function readTracking(db: Pick<Db, 'select'>): Promise<TrackingSettings> {
  return (await readSetting<TrackingSettings>(db, TRACKING_KEY)) ?? { hours: null };
}

/** New tracking hours (null: around the clock); tracking an admin asked for goes on. */
export async function saveTrackingHours(db: Db, hours: TrackingHours | null): Promise<void> {
  await saveSetting(db, TRACKING_KEY, { ...(await readTracking(db)), hours });
}

/**
 * Tracks outside the hours once, as an admin asked (for an hour, or until the next start); null
 * while the feed already tracks.
 */
export async function trackNow(
  db: Db,
  kind: TrackingOverride['kind'],
  now = new Date(),
): Promise<TrackingOverride | null> {
  const settings = await readTracking(db);
  const override = trackingOverride(settings, kind, now);
  if (override) await saveSetting(db, TRACKING_KEY, { ...settings, override });
  return override;
}

/** What a feed is told: whether to read now, until when, or when to start again. */
export async function feedTracking(db: Pick<Db, 'select'>, now = new Date()) {
  const { on, until, resumeAt } = trackingState(await readTracking(db), now);
  return { on, until, resumeAt };
}

/**
 * What changes the Stores pages (S25): the newest post and the person's feed's last push, two
 * rows read, so an open page asks this and reloads only when something changed. With them, the
 * tracking hours and whether the feed tracks now.
 */
export async function storesState(db: Db, userId: string) {
  const [[post], [token], tracking] = await Promise.all([
    // When the last post arrived (a push's time to the millisecond): posts carry only the minute
    // they were posted, so a second post in the same minute would go unnoticed.
    db
      .select({ at: storePosts.receivedAt })
      .from(storePosts)
      .orderBy(desc(storePosts.receivedAt))
      .limit(1),
    db
      .select({
        at: feedTokens.lastSeenAt,
        source: feedTokens.lastSource,
        boards: feedTokens.boards,
        watching: feedTokens.watching,
        next: feedTokens.next,
      })
      .from(feedTokens)
      .where(eq(feedTokens.userId, userId)),
    readTracking(db),
  ]);
  // The feed at a glance (the Stores pages' status): its last push, the board it read last, its
  // next read, and the boards it watches with when each last gave posts.
  const boards = Object.entries(token?.boards ?? {});
  const [lastBoard, last] = boards.sort(([, a], [, b]) => b.at.localeCompare(a.at))[0] ?? [];
  return {
    post: post?.at ?? null,
    feed: token?.at ?? null,
    tracking: {
      ...trackingState(tracking),
      hours: tracking.hours ? { from: tracking.hours.from, to: tracking.hours.to } : null,
    },
    status: token?.at
      ? {
          at: token.at,
          source: token.source,
          board: lastBoard ?? null,
          posts: last?.posts ?? 0,
          next: token.next ?? null,
          watched: (token.watching ?? boards.map(([key]) => key)).map((key) => ({
            key,
            readAt: token.boards?.[key]?.readAt ?? null,
          })),
        }
      : null,
  };
}

/**
 * A page of posts, newest first: only those naming one of `storeIds` when given, any store
 * (`named`; false: those naming none), posted since a time (`since`), on a chain's board (`chain`; null: boards mixing
 * chains). One more than asked is read, to know whether an older
 * page follows (no count of every post).
 */
export async function postsPage(
  db: Db,
  opts: {
    offset: number;
    limit: number;
    storeIds?: string[];
    named?: boolean;
    since?: string;
    chain?: string | null;
  },
): Promise<{ posts: StorePost[]; more: boolean }> {
  const ids = opts.storeIds;
  if (ids && !ids.length) return { posts: [], more: false };
  const rows = await db
    .select()
    .from(storePosts)
    .where(
      and(
        ids
          ? sql`exists (select 1 from json_each(${storePosts.storeIds}) where value in (${sql.join(
              ids.map((id) => sql`${id}`),
              sql`, `,
            )}))`
          : undefined,
        opts.named === undefined
          ? undefined
          : opts.named
            ? sql`${storePosts.storeIds} <> '[]'`
            : sql`${storePosts.storeIds} = '[]'`,
        opts.since ? gte(storePosts.postedAt, opts.since) : undefined,
        opts.chain === undefined
          ? undefined
          : opts.chain === null
            ? isNull(storePosts.chain)
            : eq(storePosts.chain, opts.chain),
      ),
    )
    .orderBy(desc(storePosts.postedAt))
    .limit(opts.limit + 1)
    .offset(opts.offset);
  return { posts: rows.slice(0, opts.limit), more: rows.length > opts.limit };
}
