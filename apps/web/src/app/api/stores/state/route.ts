// What changes the Stores pages (S25): an open page asks every 20 s and reloads only when the
// newest post or the feed's last push changed (a few rows read instead of the whole page).
import { storesState } from '@tora/db';
import { NextResponse } from 'next/server';
import { currentSession } from '@/lib/auth/guard';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json(await storesState(session.db, session.user.id));
}
