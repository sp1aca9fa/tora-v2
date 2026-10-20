// Account tasks done in the app by an admin (requirements S21): one-time setup links with which
// a person sets their own password and/or authenticator, for a new account or a reset.
import { toLocalIso } from '@tora/core';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import QRCode from 'qrcode';
import type { Db } from './client';
import {
  type AccountSetup,
  type AccountSetupKind,
  type User,
  accountSetups,
  userDevices,
  users,
} from './schema';

/** How long a setup link works. */
export const SETUP_LINK_HOURS = 24;
const PREFIX = 'tora_setup_';

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** An account nobody can sign in to until its person opens the setup link. */
export async function createPendingUser(
  db: Db,
  username: string,
  role: User['role'],
): Promise<User> {
  const [user] = await db
    .insert(users)
    .values({ username, role, passwordHash: null, totpSecretEnc: null, backupCodeHashes: [] })
    .returning();
  return user!;
}

/**
 * A new setup link for a person (an older unused one stops working). Returns the token, shown
 * once: only its hash is kept.
 */
export async function makeSetupLink(
  db: Db,
  userId: string,
  kind: AccountSetupKind,
  createdBy: string | null,
  now = new Date(),
): Promise<{ token: string; expiresAt: string }> {
  const token = `${PREFIX}${randomBytes(24).toString('base64url')}`;
  const expiresAt = toLocalIso(new Date(now.getTime() + SETUP_LINK_HOURS * 3_600_000));
  await db.transaction(async (tx) => {
    await tx
      .delete(accountSetups)
      .where(and(eq(accountSetups.userId, userId), isNull(accountSetups.usedAt)));
    await tx
      .insert(accountSetups)
      .values({ userId, kind, tokenHash: hashToken(token), createdBy, expiresAt });
  });
  return { token, expiresAt };
}

/** The setup a link opens, while unused and in time, with its person (an enabled account). */
export async function setupByToken(
  db: Db,
  token: string,
  now = new Date(),
): Promise<{ setup: AccountSetup; user: User } | null> {
  if (!token.startsWith(PREFIX)) return null;
  const [row] = await db
    .select({ setup: accountSetups, user: users })
    .from(accountSetups)
    .innerJoin(users, eq(users.id, accountSetups.userId))
    .where(
      and(
        eq(accountSetups.tokenHash, hashToken(token)),
        isNull(accountSetups.usedAt),
        gt(accountSetups.expiresAt, toLocalIso(now)),
      ),
    );
  return row && !row.user.disabledAt ? row : null;
}

/** Keeps the authenticator secret the page offers, so a reload shows the same QR code. */
export async function offerSetupSecret(db: Db, setupId: string, totpSecretEnc: string) {
  await db
    .update(accountSetups)
    .set({ totpSecretEnc, updatedAt: toLocalIso() })
    .where(and(eq(accountSetups.id, setupId), isNull(accountSetups.totpSecretEnc)));
}

/**
 * Saves what the person set and closes the link; every device signs out (as with any change of
 * credentials). False when the link was used meanwhile.
 */
export async function completeSetup(
  db: Db,
  setupId: string,
  patch: { passwordHash?: string; totpSecretEnc?: string; backupCodeHashes?: string[] },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const at = toLocalIso();
    const [setup] = await tx
      .update(accountSetups)
      .set({ usedAt: at, updatedAt: at })
      .where(and(eq(accountSetups.id, setupId), isNull(accountSetups.usedAt)))
      .returning();
    if (!setup) return false;
    await tx
      .update(users)
      .set({ ...patch, ...(patch.totpSecretEnc ? { totpLastStep: null } : {}), updatedAt: at })
      .where(eq(users.id, setup.userId));
    await tx
      .update(userDevices)
      .set({ revokedAt: at })
      .where(and(eq(userDevices.userId, setup.userId), isNull(userDevices.revokedAt)));
    return true;
  });
}

/** Each person's link waiting to be used (by user id). */
export async function pendingSetups(
  db: Db,
  now = new Date(),
): Promise<Map<string, Pick<AccountSetup, 'kind' | 'expiresAt' | 'createdAt'>>> {
  const rows = await db
    .select({
      userId: accountSetups.userId,
      kind: accountSetups.kind,
      expiresAt: accountSetups.expiresAt,
      createdAt: accountSetups.createdAt,
    })
    .from(accountSetups)
    .where(and(isNull(accountSetups.usedAt), gt(accountSetups.expiresAt, toLocalIso(now))));
  return new Map(rows.map(({ userId, ...rest }) => [userId, rest]));
}

/** Stops a person's waiting link. */
export async function cancelSetup(db: Db, userId: string) {
  await db
    .delete(accountSetups)
    .where(and(eq(accountSetups.userId, userId), isNull(accountSetups.usedAt)));
}

/** The authenticator QR code of an otpauth:// address, as SVG (shown on the setup page). */
export async function otpauthQrSvg(uri: string): Promise<string> {
  return QRCode.toString(uri, { type: 'svg', margin: 1 });
}
