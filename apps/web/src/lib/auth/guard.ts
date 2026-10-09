import 'server-only';
import { getDb } from '@tora/db';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, authConfigFromEnv, verifySessionToken } from './session';

/**
 * Second line of defense behind the proxy: pages and server actions call this before
 * touching data, so a matcher mistake in proxy.ts cannot expose anything.
 */
export async function requireSession(): Promise<void> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!(await verifySessionToken(token, authConfigFromEnv()))) redirect('/login');
}

/** The DB, only after the session check. Use this in pages and actions. */
export async function authedDb() {
  await requireSession();
  return getDb();
}
