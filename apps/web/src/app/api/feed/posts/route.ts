// Store notice feeds (requirements S25): a feed (e.g. a userscript in the person's own browser)
// pushes posts about stores here with the person's feed token (`Authorization: Bearer <token>`,
// made on the Stores page). New posts naming a store make notices at once. An empty `posts` list
// is a heartbeat: the Stores page shows whether the feed is alive. Format: docs/store-feeds.md.
import {
  feedTokenUser,
  getDb,
  loadTimeZone,
  readPush,
  receivePush,
  sendFeedMessages,
  sendStoreNotices,
} from '@tora/db';
import { NextResponse } from 'next/server';
import { alertContext } from '@/lib/alerts';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const token = request.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/)?.[1];
  const db = getDb();
  const userId = token ? await feedTokenUser(db, token) : null;
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'body must be JSON' }, { status: 400 });
  }
  const push = readPush(body);
  if (typeof push === 'string') return NextResponse.json({ error: push }, { status: 400 });
  await loadTimeZone(db);
  const received = await receivePush(db, userId, push);
  const ctx = alertContext();
  const notices = ctx ? await sendStoreNotices(db, received, ctx) : 0;
  // The feed's own person: posts it could not place, posts maybe missed, back after a silence.
  if (ctx) await sendFeedMessages(db, userId, received, ctx);
  return NextResponse.json({
    received: push.posts.length,
    new: received.fresh.length,
    matched: received.fresh.filter((p) => p.storeIds.length).length,
    notices,
    gap: !!received.gap,
    // The boards chosen in the app: the feed follows them (null: its own choice).
    watch: received.watch ?? null,
  });
}
