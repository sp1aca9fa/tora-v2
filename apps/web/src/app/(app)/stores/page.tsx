import { PLACE, localDate, storesInArea } from '@tora/core';
import { ADMIN_STORES, channelsOf, feedStatus, listStores, recentPosts } from '@tora/db';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { authed } from '@/lib/auth/guard';
import { cn } from '@/lib/utils';
import { AddStoreForm, FeedAlerts, FeedToken, type StoreView, StoreAreaForm } from './store-area';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('stores'))('title') };
}

/** Minutes after which a silent feed shows as stopped. */
const FEED_ALIVE_MINUTES = 10;
const minutesSince = (at: string) => Math.round((Date.now() - Date.parse(at)) / 60_000);

/**
 * Store notices (S25): the person's area (picked stores or a distance, travel mode), each store
 * on or off, the feed's state, and the latest posts, the area's first.
 */
export default async function StoresPage() {
  const { db, user } = await authed();
  const [t, all, feed, posts, channels] = await Promise.all([
    getTranslations('stores'),
    listStores(db),
    feedStatus(db, user.id),
    recentPosts(db, 60),
    channelsOf(db, user.id),
  ]);
  const area = user.preferences?.storeArea ?? null;
  const today = localDate();
  const inArea = storesInArea(area, all, today);
  const byId = new Map(all.map((s) => [s.id, s]));
  const views: StoreView[] = all.map((s) => ({
    id: s.id,
    chainKey: s.chain,
    chain: s.chain === PLACE ? t('places') : (s.chainLabel ?? s.chain),
    name: s.name,
    codes: s.codes,
    extra: s.extraCodes ?? [],
    byHand: s.source === ADMIN_STORES,
    region: s.region,
    lat: s.lat,
    lon: s.lon,
  }));
  const minutesAgo = feed?.lastSeenAt ? minutesSince(feed.lastSeenAt) : null;
  const alive = minutesAgo !== null && minutesAgo <= FEED_ALIVE_MINUTES;
  const sorted = [...posts].sort(
    (a, b) =>
      Number(b.storeIds.some((id) => inArea.has(id))) -
        Number(a.storeIds.some((id) => inArea.has(id))) || b.postedAt.localeCompare(a.postedAt),
  );

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">{t('intro')}</p>
      </header>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,30rem)] 2xl:grid-cols-[minmax(0,1fr)_minmax(26rem,36rem)]">
        <div className="space-y-5">
          <StoreAreaForm stores={views} area={area} today={today} admin={user.role === 'admin'} />
          {user.role === 'admin' && (
            <Card>
              <CardHeader>
                <CardTitle>{t('addTitle')}</CardTitle>
                <CardDescription>{t('addInfo')}</CardDescription>
              </CardHeader>
              <CardContent>
                <AddStoreForm
                  chains={[
                    ...new Map(all.map((s) => [s.chain, s.chainLabel ?? s.chain])).entries(),
                  ].map(([chain, label]) => ({ chain, label }))}
                />
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>{t('feed')}</CardTitle>
              <CardDescription>
                {minutesAgo === null
                  ? t('feedNever')
                  : t(alive ? 'feedAlive' : 'feedStopped', {
                      minutes: minutesAgo,
                      source: feed?.lastSource ?? '-',
                    })}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm">
                {channels.length
                  ? t('noticesTo', {
                      stores: inArea.size,
                      channels: channels.map((c) => c.label ?? c.kind).join(', '),
                    })
                  : t('noChannel')}{' '}
                <Link href="/settings/alerts" className="underline">
                  {t('alertsLink')}
                </Link>
              </p>
              <FeedAlerts prefs={user.preferences?.storeFeed ?? null} />
              <FeedToken hasToken={!!feed} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('posts')}</CardTitle>
              <CardDescription>{t('postsInfo')}</CardDescription>
            </CardHeader>
            <CardContent>
              {sorted.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('noPosts')}</p>
              ) : (
                <ul className="divide-y text-sm">
                  {sorted.slice(0, 40).map((p) => {
                    const mine = p.storeIds.some((id) => inArea.has(id));
                    const names = p.storeIds.map((id) => byId.get(id)?.name).filter(Boolean);
                    return (
                      <li key={p.id} className={cn('space-y-0.5 py-2', !mine && 'opacity-70')}>
                        <p className="text-xs text-muted-foreground">
                          {p.postedAt.slice(5, 16).replace('T', ' ')}
                          {p.author ? ` · ${p.author}` : ''} ·{' '}
                          <span className={cn(mine && 'font-semibold text-foreground')}>
                            {names.length ? names.join(', ') : t('unknownStore')}
                          </span>
                        </p>
                        <p className="break-words">
                          {p.url ? (
                            <a
                              href={p.url}
                              target="_blank"
                              rel="noreferrer"
                              className="hover:underline"
                            >
                              {p.text}
                            </a>
                          ) : (
                            p.text
                          )}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
