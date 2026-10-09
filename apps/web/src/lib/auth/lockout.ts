import { toTokyoIso } from '@tora/core';
import type { Db } from '@tora/db';
import { schema } from '@tora/db';
import { and, count, eq, gte, lt } from 'drizzle-orm';

const { loginAttempts } = schema;

/** Failed attempts (password or code) allowed per IP within the window. */
export const MAX_FAILURES_PER_IP = 5;
export const IP_WINDOW_MS = 15 * 60 * 1000;
/** Failed attempts allowed per username per hour, from any IP. */
export const MAX_FAILURES_PER_USERNAME = 10;
/** Failed attempts allowed across everything per hour (slows distributed guessing). */
export const MAX_FAILURES_GLOBAL = 50;
export const HOUR_MS = 60 * 60 * 1000;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const since = (now: Date, ms: number) => toTokyoIso(new Date(now.getTime() - ms));

async function failures(db: Db, now: Date, windowMs: number, where?: ReturnType<typeof eq>) {
  const [row] = await db
    .select({ n: count() })
    .from(loginAttempts)
    .where(
      and(
        where,
        eq(loginAttempts.success, false),
        gte(loginAttempts.attemptedAt, since(now, windowMs)),
      ),
    );
  return row?.n ?? 0;
}

/** IP and username are stored only as keyed hashes. */
export async function isLockedOut(
  db: Db,
  key: { ipHash: string; usernameHash?: string | null },
  now = new Date(),
): Promise<boolean> {
  if (
    (await failures(db, now, IP_WINDOW_MS, eq(loginAttempts.ipHash, key.ipHash))) >=
    MAX_FAILURES_PER_IP
  ) {
    return true;
  }
  if (
    key.usernameHash &&
    (await failures(db, now, HOUR_MS, eq(loginAttempts.usernameHash, key.usernameHash))) >=
      MAX_FAILURES_PER_USERNAME
  ) {
    return true;
  }
  return (await failures(db, now, HOUR_MS)) >= MAX_FAILURES_GLOBAL;
}

export async function recordAttempt(
  db: Db,
  key: { ipHash: string; usernameHash?: string | null },
  success: boolean,
  now = new Date(),
): Promise<void> {
  await db.insert(loginAttempts).values({
    ipHash: key.ipHash,
    usernameHash: key.usernameHash ?? null,
    success,
    attemptedAt: toTokyoIso(now),
  });
  await db.delete(loginAttempts).where(lt(loginAttempts.attemptedAt, since(now, RETENTION_MS)));
}
