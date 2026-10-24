// Database round trips so far, for `pnpm perf` (S14): only when the server runs with TORA_PERF
// set, for a signed-in person. Numbers only.
import { dbTimings } from '@tora/db';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export function GET() {
  if (!process.env.TORA_PERF) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(dbTimings());
}
