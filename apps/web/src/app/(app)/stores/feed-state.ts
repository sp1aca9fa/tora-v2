/** The feed as /api/stores/state reports it (null: it never sent anything). */
export interface FeedState {
  at: string;
  source: string | null;
  board: string | null;
  posts: number;
  next: { board: string | null; at: string } | null;
  watched: { key: string; readAt: string | null }[];
}

/** Whether the board tracker reads now (its working hours), as /api/stores/state reports it. */
export interface Tracking {
  on: boolean;
  why: 'always' | 'hours' | 'hour' | 'untilStart' | 'outside';
  until: string | null;
  resumeAt: string | null;
  since: string | null;
  hours: { from: string; to: string } | null;
}

/** A feed or a watched board silent this long is stopped (as on the Feed page). */
export const SILENT_MS = 10 * 60_000;

export const clock = (at: string) => at.slice(11, 16);

/**
 * Whether the tracker is down: stopped (out of its hours, with or without a feed) or silent (only
 * with a feed: none at all has nothing to be silent about). Silence counts from the start of the
 * tracking hours: the feed rested before.
 */
export function feedDown(
  feed: Pick<FeedState, 'at'> | null,
  tracking: Tracking | null,
  now = Date.now(),
) {
  const stopped = !!tracking && !tracking.on;
  const since = tracking?.on && tracking.since ? Date.parse(tracking.since) : 0;
  const heard = feed ? Math.max(Date.parse(feed.at), since) : 0;
  const silent = !stopped && !!feed && now - heard > SILENT_MS;
  return { stopped, silent, since, down: stopped || silent };
}

/**
 * When Now's "Nothing received since" counts from: the feed's last push, only while the tracker is
 * down. With no feed there is no such time, so the page says no posts instead.
 */
export function nothingSince(feed: Pick<FeedState, 'at'> | null, tracking: Tracking | null) {
  return feed && feedDown(feed, tracking).down ? feed.at : null;
}
