import { postsPage } from '@tora/db';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { authed } from '@/lib/auth/guard';
import { cn } from '@/lib/utils';
import { type Location, areaLocations, postDays } from '../locations';
import { postViews } from '../post-views';
import { PostsList } from '../posts-list';
import { AutoRefresh } from '../stores-nav';

/**
 * A location's posts in time order (S25): a button per location of the person's area (an area
 * and the stores near it) with posts since yesterday, nearest first, the others folded; every
 * store's posts there, newest first.
 */
export default async function ByLocationPage({
  searchParams,
}: {
  searchParams: Promise<{ at?: string }>;
}) {
  const { db, user } = await authed();
  const area = user.preferences?.storeArea ?? null;
  if (!area) redirect('/stores/area');
  const [t, { mine, inArea, locationOf }, asked] = await Promise.all([
    getTranslations('stores'),
    areaLocations(db, area),
    searchParams,
  ]);
  // Posts per location since yesterday (5:00).
  const { posts } = await postsPage(db, {
    offset: 0,
    limit: 1000,
    since: postDays().yesterday,
    storeIds: [...inArea],
  });
  const recent = new Map<string, number>();
  for (const p of posts) {
    for (const at of new Set(p.storeIds.map((id) => locationOf.get(id)))) {
      if (at) recent.set(at, (recent.get(at) ?? 0) + 1);
    }
  }
  const active = mine.filter((l) => recent.has(l.id));
  const quiet = mine.filter((l) => !recent.has(l.id));
  const location = mine.find((l) => l.id === asked.at) ?? active[0] ?? mine[0] ?? null;
  const filter = { storeIds: location?.storeIds ?? [] };
  const first = await postViews(db, area, { offset: 0, filter });
  const chip = (active: boolean) =>
    cn(
      'rounded-full border px-2.5 py-1 text-xs',
      active ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground',
    );

  const link = (l: Location) => (
    <Link
      key={l.id}
      href={`/stores/by-location?at=${l.id}`}
      className={chip(l.id === location?.id)}
    >
      {l.label}
      <span className="opacity-70">
        {l.km !== null && ` ${t('km', { km: l.km.toFixed(1) })}`}
        {recent.has(l.id) && ` · ${recent.get(l.id)}`}
      </span>
    </Link>
  );

  return (
    <section className="space-y-3">
      <AutoRefresh on="post" />
      <p className="text-sm text-muted-foreground">{t('byLocationInfo')}</p>
      <div className="flex flex-wrap gap-1.5">{active.map(link)}</div>
      {quiet.length > 0 && (
        <details open={!!location && !recent.has(location.id)}>
          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
            {t('quietLocations', { n: quiet.length })}
          </summary>
          <div className="flex flex-wrap gap-1.5 pt-2">{quiet.map(link)}</div>
        </details>
      )}
      <div className="rounded-xl border bg-card px-4">
        <PostsList
          key={`${location?.id ?? ''}|${first.posts[0]?.id ?? ''}`}
          initial={first.posts}
          more={first.more}
          filter={filter}
        />
      </div>
    </section>
  );
}
