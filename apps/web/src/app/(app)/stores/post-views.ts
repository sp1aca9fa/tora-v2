import 'server-only';
import {
  PLACE,
  type StoreArea,
  localDate,
  productsInPost,
  storeLabelIn,
  storesInArea,
} from '@tora/core';
import {
  type Db,
  cachedStores,
  postImageIds,
  postsPage,
  storeCodes,
  storeGlossary,
} from '@tora/db';
import { getLocale, getTranslations } from 'next-intl/server';

/** Posts loaded at a time; more as the list is scrolled. */
export const POSTS_BATCH = 20;

export interface PostView {
  id: string;
  /** "MM-DD HH:mm". */
  at: string;
  author: string | null;
  /** The stores and places it names, as people read them. */
  names: string[];
  /** It names a store of the person's area. */
  mine: boolean;
  /** The products its codes name. */
  products: string[];
  /** A reply (comment) to a post: its stores are the post's when it names none. */
  reply: boolean;
  text: string;
  url: string | null;
  /** Its pictures (the app's addresses), for a week. */
  images: string[];
}

/** A batch of posts, newest first (only the area's when asked), ready to show. */
export async function postViews(
  db: Db,
  area: StoreArea | null,
  opts: { offset: number; onlyArea: boolean },
): Promise<{ posts: PostView[]; more: boolean }> {
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
  const { posts, more } = await postsPage(db, {
    offset: opts.offset,
    limit: POSTS_BATCH,
    storeIds: opts.onlyArea ? [...inArea] : undefined,
  });
  const byId = new Map(all.map((s) => [s.id, s]));
  const images = await postImageIds(
    db,
    posts.map((p) => p.id),
  );
  return {
    more,
    posts: posts.map((p) => ({
      id: p.id,
      at: p.postedAt.slice(5, 16).replace('T', ' '),
      author: p.author,
      names: p.storeIds.flatMap((id) => {
        const s = byId.get(id);
        if (!s) return [];
        // The label in the reader's language, else the name as written.
        const label = storeLabelIn(s, locale);
        return [
          s.chain === PLACE
            ? t('areaOf', { name: label ?? s.name })
            : (label ?? [s.chainLabel, s.name].filter(Boolean).join(' ')),
        ];
      }),
      mine: p.storeIds.some((id) => inArea.has(id)),
      products: productsInPost(p.text, glossary, others).map((g) => g.meaning),
      reply: !!p.replyTo,
      text: p.text,
      url: p.url,
      images: (images.get(p.id) ?? []).map((id) => `/img/posts/${id}`),
    })),
  };
}
