import { localDate, storesInArea } from '@tora/core';
import { channelsOf, feedStatus, listStores } from '@tora/db';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { authed } from '@/lib/auth/guard';
import { cn } from '@/lib/utils';
import { BoardsToWatch, FeedAlerts, FeedToken, ForgetBoard } from '../store-area';
import { AutoRefresh } from '../stores-nav';

/** Minutes after which a silent feed or board shows as stopped. */
const FEED_ALIVE_MINUTES = 10;
const minutesSince = (at: string) => Math.round((Date.now() - Date.parse(at)) / 60_000);

/**
 * The feed (S25): whether it runs, each board it reads, which boards it should watch, the alerts
 * about it and its token.
 */
export default async function StoreFeedPage() {
  const { db, user } = await authed();
  const [t, all, feed, channels] = await Promise.all([
    getTranslations('stores'),
    listStores(db),
    feedStatus(db, user.id),
    channelsOf(db, user.id),
  ]);
  const inArea = storesInArea(user.preferences?.storeArea, all, localDate());
  const minutesAgo = feed?.lastSeenAt ? minutesSince(feed.lastSeenAt) : null;
  const alive = minutesAgo !== null && minutesAgo <= FEED_ALIVE_MINUTES;
  const boards = Object.entries(feed?.boards ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const known = [...new Set([...(feed?.offered ?? []), ...boards.map(([key]) => key)])].sort();

  return (
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,30rem)] 2xl:grid-cols-[minmax(0,1fr)_minmax(26rem,36rem)]">
      <AutoRefresh />
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
        <CardContent className="space-y-4">
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
          {boards.length > 0 && (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 pr-2 font-normal">{t('board')}</th>
                  <th className="py-1 pr-2 font-normal">{t('lastVisit')}</th>
                  <th className="py-1 pr-2 font-normal">{t('lastRead')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {boards.map(([key, b]) => {
                  const quiet = !b.readAt || minutesSince(b.readAt) > FEED_ALIVE_MINUTES;
                  const watched = feed?.watching?.includes(key);
                  return (
                    <tr key={key} className="border-t">
                      <td className="py-1.5 pr-2 font-mono text-xs">
                        {key}
                        {watched && <span className="ml-1 text-muted-foreground">✓</span>}
                      </td>
                      <td className="py-1.5 pr-2 text-xs">
                        {t('ago', { minutes: minutesSince(b.at) })} ·{' '}
                        {t('postsRead', { n: b.posts })}
                      </td>
                      <td
                        className={cn(
                          'py-1.5 pr-2 text-xs',
                          quiet && 'font-semibold text-destructive',
                        )}
                      >
                        {b.readAt ? t('ago', { minutes: minutesSince(b.readAt) }) : t('never')}
                      </td>
                      <td className="py-1.5 text-right">
                        {!watched && <ForgetBoard board={key} />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {known.length > 0 && (
            <BoardsToWatch
              known={known}
              chosen={user.preferences?.storeFeed?.boards ?? null}
              watching={feed?.watching ?? []}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('feedSettings')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <FeedAlerts prefs={user.preferences?.storeFeed ?? null} />
          <FeedToken hasToken={!!feed} />
        </CardContent>
      </Card>
    </div>
  );
}
