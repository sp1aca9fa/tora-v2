import { localDate, toLocalIso } from '@tora/core';
import { postsPage } from '@tora/db';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { authed } from '@/lib/auth/guard';
import { cn } from '@/lib/utils';
import { areaLocations } from './locations';
import { type PostView, storeLabel, toViews } from './post-views';
import { PostItem } from './posts-list';
import { Since } from './since';
import { AutoRefresh } from './stores-nav';
import { threads } from './threads';

/** A day of posts starts at this hour (a late night's posts belong to the day before). */
const DAY_STARTS = '05:00';
/** Posts read at most (two busy days stay well under). */
const MAX_POSTS = 1000;

type Thread = ReturnType<typeof threads>[number];

/**
 * Store notices, the main sub page (S25): what is going on now, one closed row per location
 * (an area and the stores in it), the newest first, each with its time, how long ago and its
 * latest post; opened, the posts of each of its stores. Today's (from 5:00); yesterday's folded.
 * The area's stores, or every store. Before an area is set, the Area page comes first.
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
  // Today from 5:00 in the app's time zone (before 5:00, still yesterday's day).
  const now = new Date();
  const offset = toLocalIso(now).slice(-6);
  const startOf = (date: string) => toLocalIso(new Date(`${date}T${DAY_STARTS}:00${offset}`));
  let today = startOf(localDate(now));
  if (toLocalIso(now) < today) today = startOf(localDate(new Date(now.getTime() - 86_400_000)));
  const since = toLocalIso(new Date(Date.parse(today) - 86_400_000));
  const { posts } = await postsPage(db, {
    offset: 0,
    limit: MAX_POSTS,
    since,
    storeIds: every ? undefined : [...inArea],
    named: every,
  });
  const views = await toViews(db, area, posts);

  /** Threads by location, then by store, the newest first. */
  const group = (list: Thread[]) => {
    const out = new Map<string, Map<string, Thread[]>>();
    for (const thread of list) {
      for (const id of thread.post.storeIds) {
        if (!every && !inArea.has(id)) continue;
        const at = locationOf.get(id);
        if (!at) continue;
        const stores = out.get(at) ?? new Map<string, Thread[]>();
        out.set(at, stores);
        const had = stores.get(id) ?? [];
        if (!had.includes(thread)) stores.set(id, [...had, thread]);
      }
    }
    return [...out].map(([id, stores]) => {
      const all = [...new Set([...stores.values()].flat())].sort((a, b) =>
        b.post.postedAt.localeCompare(a.post.postedAt),
      );
      return {
        location: locations.get(id)!,
        stores: [...stores],
        latest: all[0]!.post,
        n: all.length,
      };
    });
  };
  const all = threads(views);
  const todays = group(all.filter((th) => th.post.postedAt >= today));
  const earlier = group(all.filter((th) => th.post.postedAt < today));

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
    stores.find(([, list]) => list.some((th) => th.post === latest))?.[0] ?? '';
  const row = ({ location, stores, latest, n }: (typeof todays)[number]) => (
    <details key={location.id} className="group rounded-xl border bg-card">
      <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <div className="min-w-0 flex-1 space-y-0.5">
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
            <span className="text-muted-foreground"> · {t('postCount', { n })}</span>
          </p>
          <p className="truncate text-sm text-muted-foreground">
            {latest.text}
            {latestStore(stores, latest) !== location.id &&
              ` · ${storeName(latestStore(stores, latest))}`}
          </p>
        </div>
        <span className="pt-1 text-xs text-muted-foreground group-open:rotate-90" aria-hidden>
          ▸
        </span>
      </summary>
      <div className="space-y-3 border-t px-4 pt-2 pb-3">
        {stores
          .sort(([, a], [, b]) => b[0]!.post.postedAt.localeCompare(a[0]!.post.postedAt))
          .map(([id, list]) => (
            <section key={id}>
              <h3 className="text-sm font-medium">{storeName(id)}</h3>
              <ul className="divide-y border-l pl-3">
                {list.map(({ post, replies }) => (
                  <PostItem key={post.id} post={post} replies={replies} stores={false} />
                ))}
              </ul>
            </section>
          ))}
      </div>
    </details>
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
