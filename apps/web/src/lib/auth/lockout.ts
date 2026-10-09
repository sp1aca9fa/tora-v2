import { toTokyoIso } from '@tora/core';
import type { Db } from '@tora/db';
import { schema } from '@tora/db';
import { and, count, eq, gte, lt } from 'drizzle-orm';
import { createHmac } from 'node:crypto';

const { loginAttempts } = schema;

/** Failed attempts allowed per IP within the window before lockout. */
export const MAX_FAILURES_PER_IP = 5;
export const IP_WINDOW_MS = 15 * 60 * 1000;
/** Failed attempts allowed across all IPs per hour (slows distributed guessing). */
export const MAX_FAILURES_GLOBAL = 50;
export const GLOBAL_WINDOW_MS = 60 * 60 * 1000;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** IPs are stored as keyed hashes, never in clear. */
export function hashIp(ip: string, secret: string): string {
  return createHmac('sha256', secret).update(ip).digest('base64url');
}

const since = (now: Date, ms: number) => toTokyoIso(new Date(now.getTime() - ms));

export async function isLockedOut(db: Db, ipHash: string, now = new Date()): Promise<boolean> {
  const [perIp] = await db
    .select({ n: count() })
    .from(loginAttempts)
    .where(
      and(
        eq(loginAttempts.ipHash, ipHash),
        eq(loginAttempts.success, false),
        gte(loginAttempts.attemptedAt, since(now, IP_WINDOW_MS)),
      ),
    );
  if ((perIp?.n ?? 0) >= MAX_FAILURES_PER_IP) return true;

  const [global] = await db
    .select({ n: count() })
    .from(loginAttempts)
    .where(
      and(
        eq(loginAttempts.success, false),
        gte(loginAttempts.attemptedAt, since(now, GLOBAL_WINDOW_MS)),
      ),
    );
  return (global?.n ?? 0) >= MAX_FAILURES_GLOBAL;
}

export async function recordAttempt(
  db: Db,
  ipHash: string,
  success: boolean,
  now = new Date(),
): Promise<void> {
  await db.insert(loginAttempts).values({ ipHash, success, attemptedAt: toTokyoIso(now) });
  await db.delete(loginAttempts).where(lt(loginAttempts.attemptedAt, since(now, RETENTION_MS)));
}
