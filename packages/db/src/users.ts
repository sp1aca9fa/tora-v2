// Accounts and login devices (requirements section 3, Auth).
import { toTokyoIso } from '@tora/core';
import { and, asc, count, eq, isNull, lt, ne, or } from 'drizzle-orm';
import type { Db } from './client';
import { holdings, type User, type UserDevice, userDevices, users } from './schema';

/** Each user may have at most this many active (non-revoked) devices. */
export const MAX_ACTIVE_DEVICES = 2;

export const PLACEHOLDER_USER_ID = '00000000000000000000000000';

export async function getUserByUsername(db: Db, username: string): Promise<User | null> {
  const [user] = await db.select().from(users).where(eq(users.username, username));
  return user ?? null;
}

export async function getUserById(db: Db, id: string): Promise<User | null> {
  const [user] = await db.select().from(users).where(eq(users.id, id));
  return user ?? null;
}

export async function listUsers(db: Db): Promise<User[]> {
  return db.select().from(users).orderBy(asc(users.createdAt));
}

export interface Credentials {
  passwordHash: string;
  totpSecretEnc: string;
  backupCodeHashes: string[];
}

/**
 * Creates an account. If the placeholder account from the multi-user migration still exists
 * (no password) and no real account exists yet, it is claimed instead, keeping its data.
 */
export async function createUser(
  db: Db,
  username: string,
  credentials: Credentials,
  role: User['role'] = 'member',
): Promise<{ user: User; claimedHoldings: number }> {
  return db.transaction(async (tx) => {
    const [placeholder] = await tx.select().from(users).where(eq(users.id, PLACEHOLDER_USER_ID));
    const [real] = await tx
      .select({ n: count() })
      .from(users)
      .where(ne(users.id, PLACEHOLDER_USER_ID));
    const values = { username, ...credentials, totpLastStep: null };

    if (placeholder && !placeholder.passwordHash && (real?.n ?? 0) === 0) {
      const [user] = await tx
        .update(users)
        .set({ ...values, role: 'admin' })
        .where(eq(users.id, PLACEHOLDER_USER_ID))
        .returning();
      const [owned] = await tx
        .select({ n: count() })
        .from(holdings)
        .where(eq(holdings.userId, PLACEHOLDER_USER_ID));
      return { user: user!, claimedHoldings: owned?.n ?? 0 };
    }
    const [user] = await tx
      .insert(users)
      .values({ ...values, role: (real?.n ?? 0) === 0 ? 'admin' : role })
      .returning();
    return { user: user!, claimedHoldings: 0 };
  });
}

/** New password and/or 2FA. Always ends every session (devices are revoked). */
export async function updateCredentials(
  db: Db,
  userId: string,
  patch: Partial<Credentials>,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ ...patch, ...(patch.totpSecretEnc ? { totpLastStep: null } : {}) })
      .where(eq(users.id, userId));
    await tx
      .update(userDevices)
      .set({ revokedAt: toTokyoIso() })
      .where(and(eq(userDevices.userId, userId), isNull(userDevices.revokedAt)));
  });
}

export async function setUserDisabled(db: Db, userId: string, disabled: boolean): Promise<void> {
  await db
    .update(users)
    .set({ disabledAt: disabled ? toTokyoIso() : null })
    .where(eq(users.id, userId));
  if (disabled) await revokeAllDevices(db, userId);
}

/** Records the accepted TOTP step atomically; false if that step (or a later one) was used. */
export async function markTotpStepUsed(db: Db, userId: string, step: number): Promise<boolean> {
  const rows = await db
    .update(users)
    .set({ totpLastStep: step })
    .where(and(eq(users.id, userId), or(isNull(users.totpLastStep), lt(users.totpLastStep, step))))
    .returning({ id: users.id });
  return rows.length > 0;
}

export async function consumeBackupCode(db: Db, userId: string, index: number): Promise<void> {
  const user = await getUserById(db, userId);
  if (!user) return;
  const remaining = user.backupCodeHashes.filter((_, i) => i !== index);
  await db.update(users).set({ backupCodeHashes: remaining }).where(eq(users.id, userId));
}

export async function listDevices(
  db: Db,
  userId: string,
  options: { includeRevoked?: boolean } = {},
): Promise<UserDevice[]> {
  return db
    .select()
    .from(userDevices)
    .where(
      and(
        eq(userDevices.userId, userId),
        options.includeRevoked ? undefined : isNull(userDevices.revokedAt),
      ),
    )
    .orderBy(asc(userDevices.createdAt));
}

/** Registers a device for a completed login, or returns null when both slots are taken. */
export async function registerDevice(
  db: Db,
  userId: string,
  label: string | null,
): Promise<UserDevice | null> {
  return db.transaction(async (tx) => {
    const [active] = await tx
      .select({ n: count() })
      .from(userDevices)
      .where(and(eq(userDevices.userId, userId), isNull(userDevices.revokedAt)));
    if ((active?.n ?? 0) >= MAX_ACTIVE_DEVICES) return null;
    const [device] = await tx
      .insert(userDevices)
      .values({ userId, label, lastSeenAt: toTokyoIso() })
      .returning();
    return device!;
  });
}

export async function getActiveDevice(
  db: Db,
  userId: string,
  deviceId: string,
): Promise<UserDevice | null> {
  const [device] = await db
    .select()
    .from(userDevices)
    .where(
      and(
        eq(userDevices.id, deviceId),
        eq(userDevices.userId, userId),
        isNull(userDevices.revokedAt),
      ),
    );
  return device ?? null;
}

export async function touchDevice(db: Db, deviceId: string): Promise<void> {
  await db
    .update(userDevices)
    .set({ lastSeenAt: toTokyoIso() })
    .where(eq(userDevices.id, deviceId));
}

/** Revokes one of the user's devices. Returns false if it was not theirs or already revoked. */
export async function revokeDevice(db: Db, userId: string, deviceId: string): Promise<boolean> {
  const rows = await db
    .update(userDevices)
    .set({ revokedAt: toTokyoIso() })
    .where(
      and(
        eq(userDevices.id, deviceId),
        eq(userDevices.userId, userId),
        isNull(userDevices.revokedAt),
      ),
    )
    .returning({ id: userDevices.id });
  return rows.length > 0;
}

export async function revokeAllDevices(db: Db, userId: string): Promise<number> {
  const rows = await db
    .update(userDevices)
    .set({ revokedAt: toTokyoIso() })
    .where(and(eq(userDevices.userId, userId), isNull(userDevices.revokedAt)))
    .returning({ id: userDevices.id });
  return rows.length;
}
