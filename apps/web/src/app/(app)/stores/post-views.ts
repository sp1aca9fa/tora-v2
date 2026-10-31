import 'server-only';
import {
  type CodeMeaning,
  PLACE,
  type StoreArea,
  chainsInPost,
  codesInPost,
  localDate,
  productsInPost,
  storeLabelIn,
  storesInArea,
} from '@tora/core';
import {
  type Db,
  type LotteryMark,
  type Store,
  cachedStores,
  lotteryMarksOf,
  postImageIds,
  postsPage,
  storeCodes,
  type StorePost,
  storeGlossary,
} from '@tora/db';
import { getLocale, getTranslations } from 'next-intl/server';

type StoresT = Awaited<ReturnType<typeof getTranslations<'stores'>>>;

/** A store or place as people read it: the label in their language, else the name as written. */
export function storeLabel(t: StoresT, locale: string, s: Store): string {
  const label = storeLabelIn(s, locale);
  return s.chain === PLACE
    ? t('areaOf', { name: label ?? s.name })
    : (label ?? [s.chainLabel, s.name].filter(Boolean).join(' '));
}

/** Posts loaded at a time; more as the list is scrolled. */
export const POSTS_BATCH = 20;

export interface PostView {
  id: string;
  /** The post's key on its board, and the one it answers (a reply). */
  ref: string;
  parent: string | null;
  /** The stores and places it names. */
  storeIds: string[];
  /** The chain whose board it came from (null: a board mixing chains). */
  chain: string | null;
  /** "MM-DD HH:mm", and the time itself. */
  at: string;
  postedAt: string;
  author: string | null;
  /** The stores and places it names, as people read them. */
  names: string[];
  /** It names a store of the person's area. */
  mine: boolean;
  /** Its codes spelled out, in the order written: its stores', other codes', its products'. */
  decoded: CodeMeaning[];
  /** A reply (comment) to a post: its stores are the post's when it names none. */
  reply: boolean;
  text: string;
  url: string | null;
  /** Its pictures (the app's addresses), for a week. */
  images: string[];
  /** On the Lotteries list: the person's mark (null: none yet). */
  lottery?: { mark: LotteryMark | null };
}

/** The Lotteries list's choices: open ones (not hidden), those marked so, or the hidden. */
export const LOTTERY_SHOWN = ['open', 'interested', 'applied', 'hidden'] as const;
export type LotteryShown = (typeof LOTTERY_SHOWN)[number];

/** Which posts the All posts list shows: the area's, those naming any store, or every one. */
export type PostsShown = 'area' | 'named' | 'all';

/**
 * Which posts a list shows: All posts' choice, a board's (`chain`; null: boards mixing chains),
 * some stores' (a location's, or one store).
 */
export interface PostsFilter {
  show?: PostsShown;
  chain?: string | null;
  storeIds?: string[];
  /** The Lotteries list (posts using a lottery word), by the person's marks. */
  lottery?: LotteryShown;
}

/** A batch of posts, newest first, ready to show. */
export async function postViews(
  db: Db,
  area: StoreArea | null,
  opts: {
    offset: number;
    filter: PostsFilter;
    userId?: string;
    before?: { postedAt: string; id: string };
  },
): Promise<{ posts: PostView[]; more: boolean }> {
  const { show, chain, storeIds, lottery } = opts.filter;
  const inArea = storesInArea(area, await cachedStores(db), localDate());
  // Lotteries: the posts using a lottery word, by the person's marks.
  const marks = lottery && opts.userId ? await lotteryMarksOf(db, opts.userId) : null;
  const glossary = lottery ? await storeGlossary(db) : null;
  const words = glossary?.filter((g) => g.lottery).map((g) => g.code) ?? null;
  const marked = (m: LotteryMark) => [...(marks ?? [])].flatMap(([id, x]) => (x === m ? [id] : []));
  const { posts, more } = await postsPage(db, {
    offset: opts.offset,
    before: opts.before,
    limit: POSTS_BATCH,
    storeIds: storeIds ?? (show === 'area' ? [...inArea] : undefined),
    named: show === 'named' || undefined,
    chain,
    ...(lottery && words
      ? {
          words,
          // A lottery's own announcement (2026-10-31): replies and posts that only mention one
          // ("nothing but the lottery") are chatter.
          notWords: glossary!.filter((g) => g.notLottery).map((g) => g.code),
          replies: false,
          ...(lottery === 'open' ? { notIds: marked('hidden') } : { postIds: marked(lottery) }),
        }
      : {}),
  });
  const views = await toViews(db, area, posts);
  return {
    // Every post here uses a lottery word: spelling it out again says nothing.
    posts: words
      ? views.map((v) => ({
          ...v,
          decoded: v.decoded.filter((d) => !words.includes(d.code)),
          lottery: { mark: marks?.get(v.id) ?? null },
        }))
      : views,
    more,
  };
}

/** Posts ready to show: the stores they name, their products and pictures. */
export async function toViews(
  db: Db,
  area: StoreArea | null,
  posts: StorePost[],
): Promise<PostView[]> {
  const [t, locale, all, glossary] = await Promise.all([
    getTranslations('stores'),
    getLocale(),
    cachedStores(db),
    storeGlossary(db),
  ]);
  const others = [
    ...all.flatMap((s) => [s.name, ...storeCodes(s)]),
    ...glossary.filter((g) => !g.product && !g.notLottery).map((g) => g.code),
  ];
  const inArea = storesInArea(area, all, localDate());
  const byId = new Map(all.map((s) => [s.id, s]));
  const otherCodes = glossary.filter((g) => !g.product && !g.notLottery);
  // A post's stores' codes (not the ones that are just their name), with the store they name.
  const storeCodesOf = (ids: string[]): CodeMeaning[] =>
    ids.flatMap((id) => {
      const s = byId.get(id);
      if (!s) return [];
      const name = s.name.normalize('NFKC').toLowerCase();
      const meaning = storeLabel(t, locale, s);
      return storeCodes(s)
        .filter((c) => !name.includes(c.normalize('NFKC').toLowerCase()))
        .map((code) => ({ code, meaning }));
    });
  const images = await postImageIds(
    db,
    posts.map((p) => p.id),
  );
  /**
   * The stores a post names; a chain it names with only areas is its branch there ("Arcade ·
   * Harbor"), with no store at all a branch not named.
   */
  const postNames = (p: StorePost) => {
    const named = p.storeIds.flatMap((id) => byId.get(id) ?? []);
    const chains = chainsInPost(p.text, glossary);
    if (!chains.length || named.some((s) => s.chain !== PLACE)) {
      return named.map((s) => storeLabel(t, locale, s));
    }
    if (!named.length) return chains.map((chain) => t('chainNoBranch', { chain }));
    return named.flatMap((s) =>
      chains.map((chain) => t('chainAt', { chain, place: storeLabelIn(s, locale) ?? s.name })),
    );
  };
  return posts.map((p) => ({
    id: p.id,
    ref: `${p.source}|${p.externalId}`,
    parent: p.replyTo ? `${p.source}|${p.replyTo}` : null,
    storeIds: p.storeIds,
    chain: p.chain,
    at: p.postedAt.slice(5, 16).replace('T', ' '),
    postedAt: p.postedAt,
    author: p.author,
    names: postNames(p),
    mine: p.storeIds.some((id) => inArea.has(id)),
    decoded: [
      ...codesInPost(p.text, [...storeCodesOf(p.storeIds), ...otherCodes]),
      ...productsInPost(p.text, glossary, others),
    ],
    reply: !!p.replyTo,
    text: p.text,
    url: p.url,
    images: (images.get(p.id) ?? []).map((id) => `/img/posts/${id}`),
  }));
}
