// The app's morning check (requirements S17), run once a day by Vercel's cron (vercel.json):
// "nothing ran" alerts when the home PC recorded no collect or backup for over a day, then each
// person's daily summary. Vercel sends `Authorization: Bearer $CRON_SECRET`.
import { checkMissedRuns, getDb, loadTimeZone, sendSummaries } from '@tora/db';
import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { alertContext } from '@/lib/alerts';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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
  const missed = await checkMissedRuns(db, ctx);
  const summaries = await sendSummaries(db, ctx);
  return NextResponse.json({ missed, summaries });
}
