// Database round trips so far and the costliest statements, for `pnpm perf` (S14): only when the
// server runs with TORA_PERF set, for a signed-in person. `?reset=1` starts the statements afresh.
import { dbTimings, resetDbStatements } from '@tora/db';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  if (!process.env.TORA_PERF) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const timings = dbTimings();
  if (new URL(request.url).searchParams.has('reset')) resetDbStatements();
  return NextResponse.json(timings);
}
