// The board tracker's working hours (S25): a feed asks here, with its feed token, whether to read
// its boards now. Outside the hours it reads nothing and asks again every minute or so; this
// reads one setting and records nothing (no heartbeat). Format: docs/store-feeds.md.
import { feedTokenUser, feedTracking, getDb, loadTimeZone } from '@tora/db';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const token = request.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/)?.[1];
  const db = getDb();
  const userId = token ? await feedTokenUser(db, token) : null;
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  await loadTimeZone(db);
  return NextResponse.json({ tracking: await feedTracking(db) });
}
