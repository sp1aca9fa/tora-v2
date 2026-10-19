// The store feed silence check (requirements S25) for a hosted app, where nothing runs between
// requests: an outside scheduler (cron-job.org, a GitHub Actions schedule...) calls it every few
// minutes with `Authorization: Bearer $CRON_SECRET`. The app running on the home PC checks by
// itself (instrumentation.ts).
import { checkFeeds, getDb, loadTimeZone } from '@tora/db';
import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { alertContext } from '@/lib/alerts';

export const dynamic = 'force-dynamic';

function authorized(header: string | null): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  if (!authorized(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const ctx = alertContext();
  if (!ctx) return NextResponse.json({ error: 'AUTH_SECRET is not set' }, { status: 500 });
  const db = getDb();
  await loadTimeZone(db);
  return NextResponse.json({ told: await checkFeeds(db, ctx) });
}
