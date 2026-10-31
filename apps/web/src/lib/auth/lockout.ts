import { toLocalIso } from '@tora/core';
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

const since = (now: Date, ms: number) => toLocalIso(new Date(now.getTime() - ms));

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

type AttemptKey = { ipHash: string; usernameHash?: string | null };

/** `own`: the caller's own attempt already counted as a failure (see `beginAttempt`). */
async function overLimit(db: Db, key: AttemptKey, now: Date, own: 0 | 1): Promise<boolean> {
  if (
    (await failures(db, now, IP_WINDOW_MS, eq(loginAttempts.ipHash, key.ipHash))) >=
    MAX_FAILURES_PER_IP + own
  ) {
    return true;
  }
  if (
    key.usernameHash &&
    (await failures(db, now, HOUR_MS, eq(loginAttempts.usernameHash, key.usernameHash))) >=
      MAX_FAILURES_PER_USERNAME + own
  ) {
    return true;
  }
  return (await failures(db, now, HOUR_MS)) >= MAX_FAILURES_GLOBAL + own;
}

/** IP and username are stored only as keyed hashes. */
export async function isLockedOut(db: Db, key: AttemptKey, now = new Date()): Promise<boolean> {
  return overLimit(db, key, now, 0);
}

export async function recordAttempt(
  db: Db,
  key: AttemptKey,
  success: boolean,
  now = new Date(),
): Promise<void> {
  await db.insert(loginAttempts).values({
    ipHash: key.ipHash,
    usernameHash: key.usernameHash ?? null,
    success,
    attemptedAt: toLocalIso(now),
  });
  await prune(db, now);
}

async function prune(db: Db, now: Date) {
  await db.delete(loginAttempts).where(lt(loginAttempts.attemptedAt, since(now, RETENTION_MS)));
}

export interface Attempt {
  /** Saves how the check went. */
  settle(success: boolean): Promise<void>;
  /** Forgets the attempt: it guessed nothing (a form error before any check). */
  drop(): Promise<void>;
}

/**
 * Starts a password or code check, or null when locked out. The attempt is saved as failed
 * before the check and the limits are counted with it, so parallel requests cannot all pass
 * the lockout before any failure is saved: at most the limit's worth are checked at once. A
 * locked-out attempt is forgotten, as before (it checked nothing). Requirements section 3,
 * Auth: failed attempts counted per IP and per username, with temporary lockout.
 */
export async function beginAttempt(
  db: Db,
  key: AttemptKey,
  now = new Date(),
): Promise<Attempt | null> {
  const [row] = await db
    .insert(loginAttempts)
    .values({
      ipHash: key.ipHash,
      usernameHash: key.usernameHash ?? null,
      success: false,
      attemptedAt: toLocalIso(now),
    })
    .returning({ id: loginAttempts.id });
  const id = row!.id;
  const drop = async () => {
    await db.delete(loginAttempts).where(eq(loginAttempts.id, id));
  };
  if (await overLimit(db, key, now, 1)) {
    await drop();
    return null;
  }
  return {
    async settle(success) {
      if (success) {
        await db.update(loginAttempts).set({ success }).where(eq(loginAttempts.id, id));
      }
      await prune(db, now);
    },
    drop,
  };
}
