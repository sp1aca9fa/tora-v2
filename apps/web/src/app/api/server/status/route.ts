// The server's status for a helper (S10): `Authorization: Bearer <status token>` (made on
// Settings > Admin > Server). Read-only. `?lines=` per log (60, up to 1000), `?log=` one log.
import { getDb, statusTokenValid } from '@tora/db';
import { NextResponse } from 'next/server';
import { authConfigFromEnv } from '@/lib/auth/session';
import { serverStatus } from '@/lib/server-status';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const config = authConfigFromEnv();
  const db = getDb();
  if (
    !config ||
    !(await statusTokenValid(db, request.headers.get('authorization'), config.secret))
  ) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const url = new URL(request.url);
  const lines = Number(url.searchParams.get('lines')) || undefined;
  return NextResponse.json(await serverStatus(db, { lines, log: url.searchParams.get('log') }));
}
