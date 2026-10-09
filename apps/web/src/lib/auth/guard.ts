import 'server-only';
import {
  type Db,
  type User,
  type UserDevice,
  getActiveDevice,
  getDb,
  getUserById,
  touchDevice,
} from '@tora/db';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import {
  SESSION_COOKIE,
  authConfigFromEnv,
  credentialFingerprint,
  verifySessionToken,
} from './session';

const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

export interface Session {
  db: Db;
  user: User;
  device: UserDevice;
}

/**
 * The full session check (the proxy only verifies the signature): the device must still be
 * active, the account enabled, and the credentials unchanged since login. Cached per request.
 */
export const currentSession = cache(async (): Promise<Session | null> => {
  const claims = await verifySessionToken(
    (await cookies()).get(SESSION_COOKIE)?.value,
    authConfigFromEnv(),
  );
  if (!claims) return null;
  const db = getDb();
  const user = await getUserById(db, claims.userId);
  if (!user || user.disabledAt || !user.passwordHash) return null;
  if (credentialFingerprint(user) !== claims.fingerprint) return null;
  const device = await getActiveDevice(db, user.id, claims.deviceId);
  if (!device) return null;
  if (Date.now() - Date.parse(device.lastSeenAt) > TOUCH_INTERVAL_MS) {
    await touchDevice(db, device.id);
  }
  return { db, user, device };
});

/**
 * Use in every page and server action before touching data: second line of defense behind the
 * proxy, and the source of the user id that scopes all queries.
 */
export async function authed(): Promise<Session> {
  const session = await currentSession();
  if (!session) redirect('/login');
  return session;
}
