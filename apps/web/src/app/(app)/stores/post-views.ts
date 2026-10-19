import 'server-only';
import { PLACE, type StoreArea, localDate, storesInArea } from '@tora/core';
import { type Db, cachedStores, postsPage } from '@tora/db';
import { getTranslations } from 'next-intl/server';

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
  text: string;
  url: string | null;
}

/** A batch of posts, newest first (only the area's when asked), ready to show. */
export async function postViews(
  db: Db,
  area: StoreArea | null,
  opts: { offset: number; onlyArea: boolean },
): Promise<{ posts: PostView[]; more: boolean }> {
  const [t, all] = await Promise.all([getTranslations('stores'), cachedStores(db)]);
  const inArea = storesInArea(area, all, localDate());
  const { posts, more } = await postsPage(db, {
    offset: opts.offset,
    limit: POSTS_BATCH,
    storeIds: opts.onlyArea ? [...inArea] : undefined,
  });
  const byId = new Map(all.map((s) => [s.id, s]));
  return {
    more,
    posts: posts.map((p) => ({
      id: p.id,
      at: p.postedAt.slice(5, 16).replace('T', ' '),
      author: p.author,
      names: p.storeIds.flatMap((id) => {
        const s = byId.get(id);
        if (!s) return [];
        return [
          s.chain === PLACE
            ? t('areaOf', { name: s.name })
            : [s.chainLabel, s.name].filter(Boolean).join(' '),
        ];
      }),
      mine: p.storeIds.some((id) => inArea.has(id)),
      text: p.text,
      url: p.url,
    })),
  };
}
