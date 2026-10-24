import { postsPage } from '@tora/db';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { authed } from '@/lib/auth/guard';
import { cn } from '@/lib/utils';
import { areaLocations, postDays } from './locations';
import { type PostView, storeLabel, toViews } from './post-views';
import { PostItem } from './posts-list';
import { NowRow } from './now-row';
import { Since } from './since';
import { AutoRefresh } from './stores-nav';
import { threads } from './threads';

/** The row of the posts naming no store Tora knows. */
const UNKNOWN = 'unknown';
/** Posts read at most (two busy days stay well under). */
const MAX_POSTS = 1000;

type Thread = ReturnType<typeof threads>[number];

/**
 * Store notices, the main sub page (S25): what is going on now, one closed row per location
 * (an area and the stores in it), the newest first, each with its time, how long ago, its latest
 * post and how many came since it was last opened; opened, the posts of each of its stores.
 * Today's (from 5:00); yesterday's folded. The area's stores, or every store. Before an area is
 * set, the Area page comes first.
 */
export default async function NowPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  const { db, user } = await authed();
  const area = user.preferences?.storeArea ?? null;
  if (!area) redirect('/stores/area');
  const every = (await searchParams).show === 'all';
  const [t, locale, places] = await Promise.all([
    getTranslations('stores'),
    getLocale(),
    areaLocations(db, area),
  ]);
  const { byId, inArea, locationOf, locations } = places;
  const { today, yesterday: since } = postDays();
  // The stores' posts, and those naming no store Tora knows (one row of their own: none missed).
  const [named, unknown] = await Promise.all([
    postsPage(db, {
      offset: 0,
      limit: MAX_POSTS,
      since,
      storeIds: every ? undefined : [...inArea],
      named: every || undefined,
    }),
    postsPage(db, { offset: 0, limit: MAX_POSTS, since, named: false }),
  ]);
  const views = await toViews(
    db,
    area,
    [...named.posts, ...unknown.posts].sort((a, b) => b.postedAt.localeCompare(a.postedAt)),
  );
  const unknownRow = { id: UNKNOWN, label: t('unknownStoreTitle'), storeIds: [], km: null };

  /** When a store's threads last had a message, replies included. */
  const newest = (list: Thread[]) =>
    list
      .flatMap((th) => [th.post, ...th.replies])
      .reduce((at, p) => (p.postedAt > at ? p.postedAt : at), '');
  /** Threads by location, then by store, the newest first. */
  const group = (list: Thread[]) => {
    const out = new Map<string, Map<string, Thread[]>>();
    for (const thread of list) {
      const ids = thread.post.storeIds.length ? thread.post.storeIds : [UNKNOWN];
      for (const id of ids) {
        if (id !== UNKNOWN && !every && !inArea.has(id)) continue;
        const at = id === UNKNOWN ? UNKNOWN : locationOf.get(id);
        if (!at) continue;
        const stores = out.get(at) ?? new Map<string, Thread[]>();
        out.set(at, stores);
        const had = stores.get(id) ?? [];
        if (!had.includes(thread)) stores.set(id, [...had, thread]);
      }
    }
    // The latest message counts a reply too ("終了", "並び600" often come as comments).
    return [...out]
      .map(([id, stores]) => {
        const messages = [...new Set([...stores.values()].flat())]
          .flatMap((th) => [th.post, ...th.replies])
          .sort((a, b) => b.postedAt.localeCompare(a.postedAt));
        return {
          location: locations.get(id) ?? unknownRow,
          stores: [...stores].sort(([, a], [, b]) => newest(b).localeCompare(newest(a))),
          latest: messages[0]!,
          messages,
        };
      })
      .sort((a, b) => b.latest.postedAt.localeCompare(a.latest.postedAt));
  };
  const all = threads(views);
  // A thread is today's when its post or a reply is.
  const todays = group(all.filter((th) => newest([th]) >= today));
  const earlier = group(all.filter((th) => newest([th]) < today));

  const storeName = (id: string) => {
    const s = byId.get(id);
    return s ? storeLabel(t, locale, s) : '';
  };
  const chip = (active: boolean) =>
    cn(
      'rounded-full border px-2.5 py-1 text-xs',
      active ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground',
    );
  /** The store of a location's latest post. */
  const latestStore = (stores: [string, Thread[]][], latest: PostView) =>
    stores.find(([, list]) =>
      list.some((th) => th.post === latest || th.replies.includes(latest)),
    )?.[0] ?? '';
  const seen = user.preferences?.storesSeen ?? {};
  const row = ({ location, stores, latest, messages }: (typeof todays)[number]) => (
    <NowRow
      key={location.id}
      id={location.id}
      latest={latest.postedAt}
      seenAt={seen[location.id] ?? ''}
      unread={messages.filter((m) => m.postedAt > (seen[location.id] ?? '')).length}
      dashed={location.id === UNKNOWN}
      summary={
        <>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-semibold">{location.label}</h2>
            {location.km !== null && (
              <span className="shrink-0 text-xs text-muted-foreground">
                {t('km', { km: location.km.toFixed(1) })}
              </span>
            )}
          </div>
          <p className="text-xs">
            <Since at={latest.postedAt} time={latest.at.slice(6)} />
            <span className="text-muted-foreground">
              {' '}
              · {t('postCount', { n: messages.length })}
            </span>
          </p>
          <p className="truncate text-sm text-muted-foreground">
            {latest.text}
            {latestStore(stores, latest) !== location.id &&
              ` · ${storeName(latestStore(stores, latest))}`}
          </p>
        </>
      }
    >
      <div className="space-y-3 border-t px-4 pt-2 pb-3">
        {stores.map(([id, list]) => (
          <section key={id}>
            {storeName(id) && <h3 className="text-sm font-medium">{storeName(id)}</h3>}
            <ul className="divide-y border-l pl-3">
              {list.map(({ post, replies }) => (
                <PostItem key={post.id} post={post} replies={replies} stores={false} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </NowRow>
  );

  return (
    <div className="space-y-4">
      <AutoRefresh on="post" />
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="text-sm text-muted-foreground">{t('nowInfo')}</p>
        <div className="flex gap-1.5">
          <Link href="/stores" className={chip(!every)}>
            {t('areaStores', { n: inArea.size })}
          </Link>
          <Link href="/stores?show=all" className={chip(every)}>
            {t('everyStore')}
          </Link>
        </div>
      </div>
      {todays.length === 0 ? (
        <p className="rounded-xl border bg-card px-4 py-6 text-sm text-muted-foreground">
          {t('noToday')}
        </p>
      ) : (
        <div className="space-y-2">{todays.map(row)}</div>
      )}
      {earlier.length > 0 && (
        <details className="space-y-2">
          <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
            {t('earlier', { n: earlier.length })}
          </summary>
          <div className="space-y-2 pt-2">{earlier.map(row)}</div>
        </details>
      )}
    </div>
  );
}
