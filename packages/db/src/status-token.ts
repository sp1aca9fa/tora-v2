// The read-only status token (S10, 2026-10-24): lets a helper read the server's status
// (`/api/status`) without an account. Shown once when made; only its keyed hash is kept.
import { keyedHash } from '@tora/auth';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from './client';
import { readSetting, saveSetting } from './registry';
import { appSettings } from './schema';

const KEY = 'statusToken';

interface Stored {
  hash: string;
  createdAt: string;
}

/** A new token (the old one stops working); the only time it can be seen. */
export async function createStatusToken(db: Db, secret: string): Promise<string> {
  const token = `tora_status_${randomBytes(24).toString('base64url')}`;
  await saveSetting(db, KEY, {
    hash: keyedHash(token, secret),
    createdAt: new Date().toISOString(),
  });
  return token;
}

export async function removeStatusToken(db: Db): Promise<void> {
  await db.delete(appSettings).where(eq(appSettings.key, KEY));
}

/** When the current token was made, or null without one. */
export async function statusTokenCreatedAt(db: Db): Promise<string | null> {
  return (await readSetting<Stored>(db, KEY))?.createdAt ?? null;
}

/** Whether a request's `Authorization: Bearer <token>` holds the current token. */
export async function statusTokenValid(
  db: Db,
  header: string | null,
  secret: string,
): Promise<boolean> {
  const stored = await readSetting<Stored>(db, KEY);
  const token = header?.match(/^Bearer (\S+)$/)?.[1];
  if (!stored || !token) return false;
  const a = Buffer.from(keyedHash(token, secret));
  const b = Buffer.from(stored.hash);
  return a.length === b.length && timingSafeEqual(a, b);
}
