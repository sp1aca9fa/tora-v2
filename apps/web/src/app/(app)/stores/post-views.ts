import 'server-only';
import {
  type CodeMeaning,
  PLACE,
  type StoreArea,
  codesInPost,
  localDate,
  productsInPost,
  storeLabelIn,
  storesInArea,
} from '@tora/core';
import {
  type Db,
  type Store,
  cachedStores,
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
}

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
}

/** A batch of posts, newest first, ready to show. */
export async function postViews(
  db: Db,
  area: StoreArea | null,
  opts: { offset: number; filter: PostsFilter },
): Promise<{ posts: PostView[]; more: boolean }> {
  const { show, chain, storeIds } = opts.filter;
  const inArea = storesInArea(area, await cachedStores(db), localDate());
  const { posts, more } = await postsPage(db, {
    offset: opts.offset,
    limit: POSTS_BATCH,
    storeIds: storeIds ?? (show === 'area' ? [...inArea] : undefined),
    named: show === 'named',
    chain,
  });
  return { posts: await toViews(db, area, posts), more };
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
    ...glossary.filter((g) => !g.product).map((g) => g.code),
  ];
  const inArea = storesInArea(area, all, localDate());
  const byId = new Map(all.map((s) => [s.id, s]));
  const otherCodes = glossary.filter((g) => !g.product);
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
  return posts.map((p) => ({
    id: p.id,
    ref: `${p.source}|${p.externalId}`,
    parent: p.replyTo ? `${p.source}|${p.replyTo}` : null,
    storeIds: p.storeIds,
    at: p.postedAt.slice(5, 16).replace('T', ' '),
    postedAt: p.postedAt,
    author: p.author,
    names: p.storeIds.flatMap((id) => {
      const s = byId.get(id);
      return s ? [storeLabel(t, locale, s)] : [];
    }),
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
