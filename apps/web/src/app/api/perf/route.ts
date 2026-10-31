// Database round trips so far and the costliest statements, for `pnpm perf` (S14): only when the
// server runs with TORA_PERF set, for a signed-in admin (the proxy checks only the cookie's
// signature). `?reset=1` starts the statements afresh.
import { dbTimings, resetDbStatements } from '@tora/db';
import { NextResponse } from 'next/server';
import { currentSession } from '@/lib/auth/guard';

export const dynamic = 'force-dynamic';

/**
 * The round trips of this route's own sign-in checks: left out of the totals, since `pnpm perf`
 * reads them before and after each page and counts the difference as the page's.
 */
const own = { calls: 0, ms: 0 };

export async function GET(request: Request) {
  if (!process.env.TORA_PERF) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const start = dbTimings(0);
  const session = await currentSession();
  const end = dbTimings(0);
  own.calls += end.calls - start.calls;
  own.ms += end.ms - start.ms;
  if (!session) return new Response(null, { status: 401 });
  // Not listed for anyone else, as the admin pages.
  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  const timings = dbTimings();
  if (new URL(request.url).searchParams.has('reset')) resetDbStatements();
  return NextResponse.json({
    ...timings,
    calls: timings.calls - own.calls,
    ms: timings.ms - own.ms,
  });
}
