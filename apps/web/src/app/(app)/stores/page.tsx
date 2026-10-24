import { PLACE, localDate, storeLabelIn, storesInArea, toLocalIso } from '@tora/core';
import { cachedStores, postsPage } from '@tora/db';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { authed } from '@/lib/auth/guard';
import { cn } from '@/lib/utils';
import { toViews } from './post-views';
import { PostItem } from './posts-list';
import { AutoRefresh } from './stores-nav';
import { threads } from './threads';

/** How far back the page looks. */
const WINDOW_HOURS = 48;
/** A store's posts shown before the rest fold away. */
const FIRST_POSTS = 3;
/** Posts read at most (a busy weekend stays well under). */
const MAX_POSTS = 500;

/**
 * Store notices, the main sub page (S25): the last two days' posts by store, the store with the
 * newest post first; replies folded under their post. The area's stores, or every store. Before
 * an area is set, the Area page comes first.
 */
export default async function ByStorePage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  const { db, user } = await authed();
  const area = user.preferences?.storeArea ?? null;
  if (!area) redirect('/stores/area');
  const every = (await searchParams).show === 'all';
  const [t, locale, all] = await Promise.all([
    getTranslations('stores'),
    getLocale(),
    cachedStores(db),
  ]);
  const inArea = storesInArea(area, all, localDate());
  const { posts } = await postsPage(db, {
    offset: 0,
    limit: MAX_POSTS,
    since: toLocalIso(new Date(Date.now() - WINDOW_HOURS * 3_600_000)),
    storeIds: every ? undefined : [...inArea],
    named: every,
  });
  const views = await toViews(db, area, posts);
  // Each store's threads, newest first (a post naming two stores is under both); the stores in
  // the order of their newest post.
  const byStore = new Map<string, ReturnType<typeof threads>>();
  for (const thread of threads(views)) {
    for (const id of thread.post.storeIds) {
      if (!every && !inArea.has(id)) continue;
      const list = byStore.get(id);
      if (list) list.push(thread);
      else byStore.set(id, [thread]);
    }
  }
  const stores = new Map(all.map((s) => [s.id, s]));
  const chip = (active: boolean) =>
    cn(
      'rounded-full border px-2.5 py-1 text-xs',
      active ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground',
    );

  return (
    <div className="space-y-4">
      <AutoRefresh on="post" />
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="text-sm text-muted-foreground">
          {t('byStoreInfo', { hours: WINDOW_HOURS })}{' '}
          <Link href="/stores/posts" className="underline">
            {t('tab.posts')}
          </Link>
        </p>
        <div className="flex gap-1.5">
          <Link href="/stores" className={chip(!every)}>
            {t('areaStores', { n: inArea.size })}
          </Link>
          <Link href="/stores?show=all" className={chip(every)}>
            {t('everyStore')}
          </Link>
        </div>
      </div>
      {byStore.size === 0 ? (
        <p className="rounded-xl border bg-card px-4 py-6 text-sm text-muted-foreground">
          {t('noRecent', { hours: WINDOW_HOURS })}
        </p>
      ) : (
        <div className="gap-4 lg:columns-2 2xl:columns-3">
          {[...byStore].map(([id, list]) => {
            const s = stores.get(id);
            if (!s) return null;
            const name = storeLabelIn(s, locale) ?? s.name;
            const chain = s.chain === PLACE ? t('places') : (s.chainLabel ?? s.chain);
            const latest = list[0]!.post;
            const shown = list.slice(0, FIRST_POSTS);
            const rest = list.slice(FIRST_POSTS);
            return (
              <section
                key={id}
                className={cn(
                  'mb-4 break-inside-avoid rounded-xl border bg-card px-4 pt-3 pb-1',
                  !inArea.has(id) && 'opacity-80',
                )}
              >
                <header className="flex items-baseline justify-between gap-3 border-b pb-2">
                  <h2 className="min-w-0 font-semibold">
                    {name}{' '}
                    <span className="text-xs font-normal text-muted-foreground">
                      {[chain, s.region].filter(Boolean).join(' · ')}
                    </span>
                  </h2>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {t('postCount', { n: list.length })} · {latest.at}
                  </span>
                </header>
                <ul className="divide-y">
                  {shown.map(({ post, replies }) => (
                    <PostItem key={post.id} post={post} replies={replies} stores={false} />
                  ))}
                </ul>
                {rest.length > 0 && (
                  <details className="border-t py-2">
                    <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                      {t('olderPosts', { n: rest.length })}
                    </summary>
                    <ul className="divide-y">
                      {rest.map(({ post, replies }) => (
                        <PostItem key={post.id} post={post} replies={replies} stores={false} />
                      ))}
                    </ul>
                  </details>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
