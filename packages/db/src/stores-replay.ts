// Replays stored posts through the rules store notices use (S29), so a person can see what each
// choice would have sent before picking it. Reads only: it sends nothing and writes nothing.
import {
  type CodeMeaning,
  PLACE,
  type SaleStart,
  STORE_NOTICE_MODES,
  type StoreArea,
  type StoreNoticeMode,
  firstLineOf,
  hasSaleStart,
  isWordOnly,
  localDate,
  lotteryPostIds,
  noticeablePosts,
  postRef,
  postsToTell,
  productsInPost,
  salesStarting,
  startsPosts,
  startsReadSince,
  storesInArea,
  toLocalIso,
} from '@tora/core';
import { asc, eq } from 'drizzle-orm';
import type { Db } from './client';
import { type Store, type StorePost, storePosts, users } from './schema';
import { listStores, storeCodes, storeGlossary } from './stores';

/** A first post and what came under it on one store, as the person would have seen it. */
export interface ReplayThread {
  at: string;
  line: string;
  replies: number;
  products: string[];
  /** A post in it has a start word yet made no notice (a quiet time, or it came in too late). */
  startWordUntold: boolean;
}

export interface ReplayResult {
  from: string;
  to: string;
  days: string[];
  /** Per mode, messages per day. */
  notices: Record<StoreNoticeMode, Record<string, number>>;
  /** Each store told under 'starts'. */
  starts: {
    at: string;
    store: string;
    why: 'word' | 'burst';
    people: number | null;
    line: string;
  }[];
  /** Under 'starts': posts of the area that make no notice (the people's posts stay on Now). */
  postsNotSent: number;
  notSent: { store: string; threads: ReplayThread[] }[];
  /** Threads that would leave Now with the lottery choice on. */
  leavingNow: { at: string; line: string; replies: number; where: string }[];
  leavingPosts: number;
  areaPosts: number;
  /** Of them, those the feed brought over 30 minutes late: only a start word under 2 hours counts. */
  cameLate: number;
}

export const replayTotals = (r: ReplayResult) => ({
  all: Object.values(r.notices.all).reduce((a, b) => a + b, 0),
  starts: Object.values(r.notices.starts).reduce((a, b) => a + b, 0),
  off: Object.values(r.notices.off).reduce((a, b) => a + b, 0),
  storesToldByWord: r.starts.filter((s) => s.why === 'word').length,
  storesToldByBurst: r.starts.filter((s) => s.why === 'burst').length,
  areaPosts: r.areaPosts,
  cameLate: r.cameLate,
  postsNotSent: r.postsNotSent,
  lotteryThreadsLeavingNow: r.leavingNow.length,
  lotteryPostsLeavingNow: r.leavingPosts,
});

const storeName = (s: Store | undefined) =>
  !s
    ? '?'
    : s.chain === PLACE
      ? `${s.name} area`
      : [s.chainLabel, s.name].filter(Boolean).join(' ');

/**
 * The stretch of `days` days holding the most posts about the area, its first and last day; a tie:
 * the latest. Null when no post is about it.
 */
function busiestSpan(posts: StorePost[], stores: Store[], area: StoreArea, days: number) {
  const perDay = new Map<string, number>();
  for (const p of posts) {
    const day = localDate(new Date(p.postedAt));
    const inArea = storesInArea(area, stores, day);
    if (p.storeIds.some((id) => inArea.has(id))) perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }
  const shift = (day: string, by: number) =>
    new Date(Date.parse(`${day}T00:00:00Z`) + by * 86_400_000).toISOString().slice(0, 10);
  let best: { from: string; to: string; posts: number } | null = null;
  for (const to of [...perDay.keys()].sort()) {
    let n = 0;
    for (let i = 0; i < days; i++) n += perDay.get(shift(to, -i)) ?? 0;
    if (!best || n >= best.posts) best = { from: shift(to, 1 - days), to, posts: n };
  }
  return best;
}

/**
 * Stored posts, by the push they came in (board and moment), through the same functions the notices
 * use, one person's area and quiet times kept per choice. A push sees only what was received by
 * then. No send fails here. Throws when the person is unknown or has no area.
 */
export async function replayNotices(
  db: Db,
  opts: {
    username: string;
    /** Days (the install's time zone), or the busiest stretch of this many days. */
    from?: string;
    to?: string;
    busiest?: number;
    /** Words to try besides the saved ones (a store list's not yet saved by a collect). */
    words?: CodeMeaning[];
  },
): Promise<ReplayResult> {
  const [user] = await db.select().from(users).where(eq(users.username, opts.username));
  if (!user) throw new Error(`no user named ${opts.username}`);
  const area = user.preferences?.storeArea;
  if (!area) throw new Error(`${opts.username} has no area set`);
  const glossary = [...(await storeGlossary(db)), ...(opts.words ?? [])];
  const stores = await listStores(db);
  const byId = new Map(stores.map((s) => [s.id, s]));
  const others = [
    ...stores.flatMap((s) => [s.name, ...storeCodes(s)]),
    ...glossary.filter((g) => !g.product && !isWordOnly(g)).map((g) => g.code),
  ];
  const places = new Set(stores.filter((s) => s.chain === PLACE).map((s) => s.id));
  const productsOf = (text: string) => productsInPost(text, glossary, others).map((g) => g.meaning);
  const posts = await db
    .select()
    .from(storePosts)
    .orderBy(asc(storePosts.receivedAt), asc(storePosts.id));
  const span =
    opts.from && opts.to
      ? { from: opts.from, to: opts.to }
      : busiestSpan(posts, stores, area, opts.busiest ?? 7);
  if (!span) throw new Error('no posts about this area');
  const { from, to } = span;
  const counted = (day: string) => day >= from && day <= to;

  const days: string[] = [];
  for (
    let d = Date.parse(`${from}T00:00:00Z`);
    d <= Date.parse(`${to}T00:00:00Z`);
    d += 86_400_000
  ) {
    days.push(new Date(d).toISOString().slice(0, 10));
  }
  const notices = Object.fromEntries(
    STORE_NOTICE_MODES.map((m) => [m, Object.fromEntries(days.map((d) => [d, 0]))]),
  ) as ReplayResult['notices'];
  const lastAll = new Map<string, string>();
  const lastStarts = new Map<string, string>();
  const known = new Map<string, StorePost>();
  const received: StorePost[] = [];
  const sources = new Set<string>();
  const told: (SaleStart<StorePost> & { day: string })[] = [];
  const firedPosts = new Set<string>();

  for (let i = 0; i < posts.length;) {
    const head = posts[i]!;
    const push: StorePost[] = [];
    while (
      i < posts.length &&
      posts[i]!.source === head.source &&
      posts[i]!.receivedAt === head.receivedAt
    ) {
      push.push(posts[i++]!);
    }
    const now = new Date(head.receivedAt);
    const day = localDate(now);
    for (const p of push) {
      known.set(postRef(p), p);
      received.push(p);
    }
    // The feed's first push only fills the list, as in sendStoreNotices.
    const first = !sources.has(head.source);
    sources.add(head.source);
    if (first) continue;
    const inArea = storesInArea(area, stores, day);
    const named = (p: StorePost) => p.storeIds.some((id) => inArea.has(id));
    const mine = noticeablePosts(push, now).filter(named);
    const fromPush = startsPosts(push, now).filter(named);
    if (!fromPush.length) continue;

    const all = postsToTell(mine, inArea, lastAll, now);
    if (all.chosen.length) {
      if (counted(day)) notices.all[day]! += 1;
      for (const id of all.told) lastAll.set(id, toLocalIso(now));
    }

    const since = startsReadSince(now);
    const recent = received.filter((p) => p.postedAt >= since && p.storeIds.length);
    const starts = salesStarting({
      fresh: fromPush,
      recent,
      area: inArea,
      places,
      lottery: lotteryPostIds(recent, known, glossary),
      last: lastStarts,
      glossary,
      now,
    });
    if (starts.length) {
      if (counted(day)) {
        notices.starts[day]! += 1;
        told.push(...starts.map((s) => ({ ...s, day })));
      }
      for (const s of starts) {
        lastStarts.set(s.storeId, toLocalIso(now));
        firedPosts.add(`${s.post.id}|${s.storeId}`);
      }
    }
  }

  // What the person would not be sent, and what would leave Now. These read the whole list.
  const lottery = lotteryPostIds(posts, known, glossary);
  const rootOf = (p: StorePost) =>
    p.replyTo ? `${p.source}|${p.thread ?? p.replyTo}` : postRef(p);
  const inPeriod = posts.filter((p) => counted(localDate(new Date(p.postedAt))));
  const onStore = new Map<string, Map<string, StorePost[]>>();
  let areaPosts = 0;
  let cameLate = 0;
  let postsNotSent = 0;
  for (const p of inPeriod) {
    const inArea = storesInArea(area, stores, localDate(new Date(p.postedAt)));
    const ids = p.storeIds.filter((id) => inArea.has(id));
    if (!ids.length) continue;
    areaPosts++;
    if (!noticeablePosts([p], new Date(p.receivedAt)).length) cameLate++;
    if (lottery.has(p.id)) continue;
    if (!ids.some((id) => firedPosts.has(`${p.id}|${id}`))) postsNotSent++;
    for (const id of ids) {
      const threads = onStore.get(id) ?? new Map<string, StorePost[]>();
      onStore.set(id, threads);
      const root = rootOf(p);
      threads.set(root, [...(threads.get(root) ?? []), p]);
    }
  }
  const notSent = [...onStore]
    .map(([id, threads]) => ({
      store: storeName(byId.get(id)),
      threads: [...threads.entries()]
        // A thread that made a notice for this store was told.
        .filter(([, list]) => !list.some((p) => firedPosts.has(`${p.id}|${id}`)))
        .map(([root, list]): ReplayThread => {
          const opening = known.get(root) ?? list[0]!;
          return {
            at: list[0]!.postedAt,
            line: firstLineOf(opening.text),
            replies: list.filter((p) => p.replyTo).length,
            products: [...new Set([opening, ...list].flatMap((p) => productsOf(p.text)))],
            startWordUntold: list.some((p) => hasSaleStart(p.text, glossary)),
          };
        })
        // Those that look important first: several replies, a product named.
        .sort(
          (a, b) =>
            b.replies + (b.products.length ? 2 : 0) - (a.replies + (a.products.length ? 2 : 0)) ||
            b.at.localeCompare(a.at),
        ),
    }))
    .filter((s) => s.threads.length)
    .sort((a, b) => a.store.localeCompare(b.store));

  // Now shows the area's posts and those naming no store.
  const leaving = new Map<string, StorePost[]>();
  for (const p of inPeriod) {
    if (!lottery.has(p.id)) continue;
    const inArea = storesInArea(area, stores, localDate(new Date(p.postedAt)));
    if (p.storeIds.length && !p.storeIds.some((id) => inArea.has(id))) continue;
    leaving.set(rootOf(p), [...(leaving.get(rootOf(p)) ?? []), p]);
  }

  return {
    from,
    to,
    days,
    notices,
    starts: told
      .map((s) => ({
        at: s.post.postedAt,
        store: storeName(byId.get(s.storeId)),
        why: s.why,
        people: s.people,
        line: s.line,
      }))
      .sort((a, b) => a.at.localeCompare(b.at)),
    postsNotSent,
    notSent,
    leavingNow: [...leaving.entries()]
      .map(([root, list]) => {
        const opening = known.get(root) ?? list[0]!;
        return {
          at: opening.postedAt,
          line: firstLineOf(opening.text),
          replies: list.filter((p) => p.replyTo).length,
          where:
            opening.storeIds.map((id) => storeName(byId.get(id))).join(', ') || 'no store named',
        };
      })
      .sort((a, b) => a.at.localeCompare(b.at)),
    leavingPosts: [...leaving.values()].flat().length,
    areaPosts,
    cameLate,
  };
}

const when = (at: string) => at.slice(5, 16).replace('T', ' ');

/** The replay as a page to read and mark. */
export function replayMarkdown(r: ReplayResult, title: string): string {
  const totals = replayTotals(r);
  const lines = [
    `# ${title}`,
    '',
    `${r.from} to ${r.to}. ${r.areaPosts} posts and replies about this area; ${r.cameLate} of them reached Tora over 30 minutes late: for those only a start word under 2 hours old can still make a message, at its real time. A message may name several stores.`,
    '',
    '## Messages per day',
    '',
    `| Day | ${STORE_NOTICE_MODES.join(' | ')} |`,
    `| --- |${STORE_NOTICE_MODES.map(() => ' --- |').join('')}`,
    ...r.days.map(
      (d) => `| ${d} | ${STORE_NOTICE_MODES.map((m) => r.notices[m][d] ?? 0).join(' | ')} |`,
    ),
    `| Total | ${totals.all} | ${totals.starts} | ${totals.off} |`,
    '',
    `## What "starts" would send (${r.starts.length} stores: ${totals.storesToldByWord} by a word, ${totals.storesToldByBurst} by a burst)`,
    '',
    ...r.starts.map(
      (s) =>
        `- ${when(s.at)} · ${s.store} · ${s.why === 'word' ? 'word' : `burst, ${s.people} people`} · ${s.line}`,
    ),
    '',
    `## What "starts" would not send (${r.postsNotSent} posts; tick what you would have missed)`,
    '',
    'Per store, the threads that look important first: several replies, a product named.',
    ...r.notSent.flatMap((s) => [
      '',
      `### ${s.store}`,
      '',
      ...s.threads.map((t) =>
        [
          `- [ ] ${when(t.at)}`,
          ...(t.replies ? [`${t.replies} replies`] : []),
          ...(t.products.length ? [t.products.join(', ')] : []),
          ...(t.startWordUntold ? ['start word, untold: quiet time or came in late'] : []),
          t.line || '(no text)',
        ].join(' · '),
      ),
    ]),
    '',
    `## Threads that would leave Now (${r.leavingNow.length} threads, ${r.leavingPosts} posts; tick any that should stay)`,
    '',
    ...r.leavingNow.map(
      (t) =>
        `- [ ] ${when(t.at)} · ${t.where}${t.replies ? ` · ${t.replies} replies` : ''} · ${t.line}`,
    ),
    '',
  ];
  return lines.join('\n');
}
