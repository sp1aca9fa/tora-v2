import { DEFAULT_FEED_PREFS, boardSilentMinutes, silentMs } from '@tora/core';

/** The feed as /api/stores/state reports it (null: it never sent anything). */
export interface FeedState {
  at: string;
  source: string | null;
  board: string | null;
  posts: number;
  next: { board: string | null; at: string } | null;
  watched: { key: string; readAt: string | null }[];
  /** The boards counted for each board's silence limit (watchedBoards). */
  count: number;
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

/**
 * A feed silent this long is stopped, where the person's own limit is not known (the default
 * limit; docs/store-feeds.md "Silence").
 */
export const SILENT_MS = DEFAULT_FEED_PREFS.silentMinutes * 60_000;

export const clock = (at: string) => at.slice(11, 16);

/**
 * Whether the tracker is down: stopped (out of its hours, with or without a feed) or silent (only
 * with a feed: none at all has nothing to be silent about) for longer than the limit (the
 * person's, else the default). Silence counts from the start of the tracking hours (the feed
 * rested before) and not during the wait its last push announced (`silentMs`).
 */
export function feedDown(
  feed: (Pick<FeedState, 'at'> & Partial<Pick<FeedState, 'next'>>) | null,
  tracking: Tracking | null,
  now = Date.now(),
  limitMs = SILENT_MS,
) {
  const stopped = !!tracking && !tracking.on;
  const since = tracking?.on && tracking.since ? Date.parse(tracking.since) : 0;
  const seen = feed ? Date.parse(feed.at) : 0;
  const silent =
    !stopped && !!feed && silentMs(Math.max(seen, since), seen, feed.next?.at, now) > limitMs;
  return { stopped, silent, since, down: stopped || silent };
}

/**
 * Whether a board gave no posts for longer than its limit (boardSilentMinutes of the person's and
 * the boards watched, as watchedBoards counts them), not counting the wait the feed's last push
 * announced.
 */
export function boardQuiet(
  readAt: string | null,
  feed: { at: string; next?: FeedState['next'] } | null,
  watched: number,
  silentMinutes: number,
  now = Date.now(),
) {
  if (!readAt) return true;
  const seen = feed ? Date.parse(feed.at) : Number.NaN;
  return (
    silentMs(Date.parse(readAt), seen, feed?.next?.at, now) >
    boardSilentMinutes(silentMinutes, watched) * 60_000
  );
}

/**
 * The end of the wait the feed's last push announced, while it lasts and is longer than the limit
 * (a step, a blocked board's retry): the Feed tab then says the feed waits until then, not that it
 * was last heard long ago. Null otherwise (no wait announced, unreadable, over, or short).
 */
export function waitingUntil(
  feed: { at: string; next?: { board?: string | null; at: string } | null } | null,
  limitMs: number,
  now = Date.now(),
) {
  const next = feed?.next?.at ? Date.parse(feed.next.at) : Number.NaN;
  const seen = feed ? Date.parse(feed.at) : Number.NaN;
  return next > now && next - seen > limitMs ? feed!.next!.at : null;
}

/**
 * When Now's "Nothing received since" counts from: the feed's last push, only while the tracker is
 * down. With no feed there is no such time, so the page says no posts instead.
 */
export function nothingSince(feed: Pick<FeedState, 'at'> | null, tracking: Tracking | null) {
  return feed && feedDown(feed, tracking).down ? feed.at : null;
}
