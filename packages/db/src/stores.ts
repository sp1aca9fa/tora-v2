// Store notices data (requirements S25): stores from store directory plug-ins, posts pushed by
// feeds, and the notices they make for the people whose area holds the store.
import { type StoreEntry, localDate, storesInArea, storesInPost, toLocalIso } from '@tora/core';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { type AlertContext, appUrl, sendToUser, textsFor } from './alerts';
import type { Db } from './client';
import {
  type Store,
  type StorePost,
  feedTokens,
  storeNotices,
  storePosts,
  stores,
  users,
} from './schema';

/** Posts this old or older make no notice (a feed's first push brings a page of old ones). */
const FRESH_MINUTES = 30;
/** Posts about one store within this time after a notice make no new one. */
const QUIET_MINUTES = 30;
const POSTS_PER_PUSH = 200;

/** A store as a directory plug-in lists it: its key there and what it is. */
export interface ListedStore extends StoreEntry {
  key: string;
}

/**
 * Saves a directory plug-in's stores (codes the admin added are kept); only the ones that changed
 * are written, since it runs with every collect. Returns how many were written.
 */
export async function saveStores(db: Db, source: string, list: ListedStore[]): Promise<number> {
  const saved = new Map(
    (await db.select().from(stores).where(eq(stores.source, source))).map((s) => [s.sourceKey, s]),
  );
  let written = 0;
  for (const { key, ...s } of list) {
    const values = {
      chain: s.chain,
      chainLabel: s.chainLabel ?? null,
      name: s.name,
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
    await db
      .insert(stores)
      .values({ source, sourceKey: key, ...values })
      .onConflictDoUpdate({
        target: [stores.source, stores.sourceKey],
        set: { ...values, updatedAt: toLocalIso() },
      });
  }
  return written;
}

export async function listStores(db: Pick<Db, 'select'>): Promise<Store[]> {
  return db.select().from(stores).orderBy(stores.chain, stores.region, stores.name);
}

/** The codes a store is known by: its plug-in's and the admin's. */
export const storeCodes = (s: Store) => [...s.codes, ...(s.extraCodes ?? [])];

/** Codes the admin adds to a store (posters' nicknames the plug-in does not know). */
export async function setStoreCodes(db: Db, storeId: string, codes: string[]) {
  const clean = [...new Set(codes.map((c) => c.normalize('NFKC').trim()).filter(Boolean))];
  await db
    .update(stores)
    .set({ extraCodes: clean.length ? clean : null })
    .where(eq(stores.id, storeId));
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
    .select({ lastSeenAt: feedTokens.lastSeenAt, lastSource: feedTokens.lastSource })
    .from(feedTokens)
    .where(eq(feedTokens.userId, userId));
  return row ? { lastSeenAt: row.lastSeenAt, lastSource: row.lastSource } : null;
}

// ---- Posts ----

/** A post as a feed pushes it. */
export interface PushedPost {
  /** The post's id on its site (or any stable key). */
  id: string;
  text: string;
  url?: string | null;
  /** ISO time, when the site shows one. */
  postedAt?: string | null;
  /** The board's chain, when it differs from the push's. */
  chain?: string | null;
}

export interface Push {
  /** The feed's key ("gamenv"). */
  source: string;
  /** The board's chain ("yodobashi"), when the whole push is one chain's. */
  chain?: string | null;
  posts: PushedPost[];
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
    chain: typeof b.chain === 'string' ? b.chain : null,
    posts: b.posts.map((p) => ({
      id: p.id.slice(0, 200),
      text: p.text.slice(0, 2000),
      url: typeof p.url === 'string' && /^https?:\/\//.test(p.url) ? p.url.slice(0, 500) : null,
      postedAt: p.postedAt ?? null,
      chain: typeof p.chain === 'string' ? p.chain : null,
    })),
  };
}

/**
 * Saves the posts not seen before (any feed may have sent them), each with the stores it names;
 * marks the person's feed as alive. Returns the new posts.
 */
export async function receivePush(
  db: Db,
  userId: string,
  push: Push,
  now = new Date(),
): Promise<{ fresh: StorePost[]; first: boolean }> {
  const at = toLocalIso(now);
  await db
    .update(feedTokens)
    .set({ lastSeenAt: at, lastSource: push.source })
    .where(eq(feedTokens.userId, userId));
  if (!push.posts.length) return { fresh: [], first: false };
  const [known] = await db
    .select({ n: sql<number>`count(*)` })
    .from(storePosts)
    .where(eq(storePosts.source, push.source));
  const all = await listStores(db);
  const listed = all.map((s) => ({ ...s, codes: storeCodes(s) }));
  const fresh: StorePost[] = [];
  for (const p of push.posts) {
    const chain = p.chain ?? push.chain ?? null;
    const [row] = await db
      .insert(storePosts)
      .values({
        source: push.source,
        externalId: p.id,
        chain,
        text: p.text,
        url: p.url ?? null,
        postedAt: p.postedAt ? toLocalIso(new Date(p.postedAt)) : at,
        receivedAt: at,
        storeIds: storesInPost(p.text, listed, chain).map((s) => s.id),
        fedBy: userId,
      })
      .onConflictDoNothing()
      .returning();
    if (row) fresh.push(row);
  }
  return { fresh, first: !known?.n };
}

/**
 * Sends the notices new posts make: to each person whose area holds a post's store (muted stores
 * aside), when the post is recent, and not again for a store within a while of the last notice.
 * A feed's first push only fills the list.
 */
export async function sendStoreNotices(
  db: Db,
  received: { fresh: StorePost[]; first: boolean },
  ctx: AlertContext,
  now = new Date(),
): Promise<number> {
  if (received.first) return 0;
  const since = toLocalIso(new Date(now.getTime() - FRESH_MINUTES * 60_000));
  const posts = received.fresh.filter((p) => p.storeIds.length && p.postedAt >= since);
  if (!posts.length) return 0;
  const all = await listStores(db);
  const byId = new Map(all.map((s) => [s.id, s]));
  const people = (await db.select().from(users).where(isNull(users.disabledAt))).filter(
    (u) => u.preferences?.storeArea,
  );
  const today = localDate(now);
  const quiet = toLocalIso(new Date(now.getTime() - QUIET_MINUTES * 60_000));
  const base = await appUrl(db);
  let sent = 0;
  for (const user of people) {
    const area = storesInArea(user.preferences!.storeArea, all, today);
    const storeIds = [...new Set(posts.flatMap((p) => p.storeIds))].filter((id) => area.has(id));
    if (!storeIds.length) continue;
    const last = new Map(
      (
        await db
          .select()
          .from(storeNotices)
          .where(and(eq(storeNotices.userId, user.id), inArray(storeNotices.storeId, storeIds)))
      ).map((n) => [n.storeId, n.sentAt]),
    );
    const t = await textsFor(db, user, ctx);
    const lines: string[] = [];
    for (const id of storeIds) {
      if ((last.get(id) ?? '') > quiet) continue;
      const store = byId.get(id)!;
      const post = posts.filter((p) => p.storeIds.includes(id)).at(-1)!;
      const text = post.text.replace(/\s+/g, ' ').trim();
      lines.push(
        `${store.name}: ${text.length > 140 ? `${text.slice(0, 140)}…` : text}${post.url ? `\n${post.url}` : ''}`,
      );
      await db
        .insert(storeNotices)
        .values({ userId: user.id, storeId: id, sentAt: toLocalIso(now) })
        .onConflictDoUpdate({
          target: [storeNotices.userId, storeNotices.storeId],
          set: { sentAt: toLocalIso(now) },
        });
    }
    if (!lines.length) continue;
    const head = t.storePosts ?? 'Tora: cards on sale in your area';
    const link = base ? `\n${base}/stores` : '';
    if (await sendToUser(db, user.id, `${head}\n${lines.join('\n')}${link}`, ctx)) sent++;
  }
  return sent;
}

/** The latest posts, newest first. */
export async function recentPosts(db: Db, limit = 50): Promise<StorePost[]> {
  return db.select().from(storePosts).orderBy(desc(storePosts.postedAt)).limit(limit);
}
