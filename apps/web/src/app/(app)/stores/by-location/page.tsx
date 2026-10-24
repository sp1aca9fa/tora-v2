import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { authed } from '@/lib/auth/guard';
import { cn } from '@/lib/utils';
import { areaLocations } from '../locations';
import { postViews } from '../post-views';
import { PostsList } from '../posts-list';
import { AutoRefresh } from '../stores-nav';

/**
 * A location's posts in time order (S25): a button per location of the person's area (an area
 * and the stores near it), nearest first; every store's posts there, newest first.
 */
export default async function ByLocationPage({
  searchParams,
}: {
  searchParams: Promise<{ at?: string }>;
}) {
  const { db, user } = await authed();
  const area = user.preferences?.storeArea ?? null;
  if (!area) redirect('/stores/area');
  const [t, { mine }, asked] = await Promise.all([
    getTranslations('stores'),
    areaLocations(db, area),
    searchParams,
  ]);
  const location = mine.find((l) => l.id === asked.at) ?? mine[0] ?? null;
  const filter = { storeIds: location?.storeIds ?? [] };
  const first = await postViews(db, area, { offset: 0, filter });
  const chip = (active: boolean) =>
    cn(
      'rounded-full border px-2.5 py-1 text-xs',
      active ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground',
    );

  return (
    <section className="space-y-3">
      <AutoRefresh on="post" />
      <p className="text-sm text-muted-foreground">{t('byLocationInfo')}</p>
      <div className="flex flex-wrap gap-1.5">
        {mine.map((l) => (
          <Link
            key={l.id}
            href={`/stores/by-location?at=${l.id}`}
            className={chip(l.id === location?.id)}
          >
            {l.label}
            {l.km !== null && ` ${t('km', { km: l.km.toFixed(1) })}`}
          </Link>
        ))}
      </div>
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
