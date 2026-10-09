'use server';

import {
  decryptSecret,
  hashPassword,
  keyedHash,
  looksLikeBackupCode,
  matchBackupCode,
  normalizeUsername,
  verifyPassword,
  verifyTotp,
} from '@tora/auth';
import {
  MAX_ACTIVE_DEVICES,
  consumeBackupCode,
  getDb,
  getUserById,
  getUserByUsername,
  listDevices,
  markTotpStepUsed,
  registerDevice,
} from '@tora/db';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { isLockedOut, recordAttempt } from '@/lib/auth/lockout';
import {
  MFA_COOKIE,
  MFA_MAX_AGE_SECONDS,
  SESSION_COOKIE,
  authConfigFromEnv,
  createMfaToken,
  createSessionToken,
  credentialFingerprint,
  deviceLabel,
  safeNextPath,
  sessionCookieOptions,
  verifyMfaToken,
} from '@/lib/auth/session';

export type LoginState = {
  error?: 'invalid' | 'locked' | 'notConfigured' | 'deviceLimit' | 'notEnrolled' | 'expired';
};

async function clientIp(): Promise<string> {
  const h = await headers();
  // On Vercel, x-real-ip / x-forwarded-for are set by the platform edge.
  return h.get('x-real-ip') ?? h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

/** Verifying a fixed hash for unknown usernames keeps the response time the same. */
let dummyHash: Promise<string> | undefined;

/** Step 1: username + password. On success, a short-lived cookie unlocks step 2. */
export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const config = authConfigFromEnv();
  if (!config) return { error: 'notConfigured' };
  const db = getDb();
  const username = normalizeUsername(String(formData.get('username') ?? '')) ?? '';
  const key = {
    ipHash: keyedHash(await clientIp(), config.secret),
    usernameHash: username ? keyedHash(username, config.secret) : null,
  };
  if (await isLockedOut(db, key)) return { error: 'locked' };

  const password = String(formData.get('password') ?? '');
  const user = username ? await getUserByUsername(db, username) : null;
  const usable = user?.passwordHash && !user.disabledAt ? user : null;
  dummyHash ??= hashPassword('unused-dummy-password');
  const ok = await verifyPassword(password, usable?.passwordHash ?? (await dummyHash));
  await recordAttempt(db, key, ok && Boolean(usable));
  if (!ok || !usable) return { error: 'invalid' };
  if (!usable.totpSecretEnc) return { error: 'notEnrolled' };
  if ((await listDevices(db, usable.id)).length >= MAX_ACTIVE_DEVICES) {
    return { error: 'deviceLimit' };
  }

  (await cookies()).set(MFA_COOKIE, await createMfaToken(config, usable.id), {
    ...sessionCookieOptions(MFA_MAX_AGE_SECONDS),
    path: '/login',
  });
  const next = safeNextPath(formData.get('next'));
  redirect(`/login/verify${next === '/' ? '' : `?next=${encodeURIComponent(next)}`}`);
}

/** Step 2: authenticator code or backup code; registers this device and starts the session. */
export async function verifyAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const config = authConfigFromEnv();
  if (!config) return { error: 'notConfigured' };
  const db = getDb();
  const jar = await cookies();
  const userId = await verifyMfaToken(jar.get(MFA_COOKIE)?.value, config);
  const user = userId ? await getUserById(db, userId) : null;
  if (!user?.totpSecretEnc || user.disabledAt) return { error: 'expired' };

  const key = {
    ipHash: keyedHash(await clientIp(), config.secret),
    usernameHash: keyedHash(user.username, config.secret),
  };
  if (await isLockedOut(db, key)) return { error: 'locked' };

  const code = String(formData.get('code') ?? '').trim();
  let backupIndex = -1;
  let ok = false;
  if (looksLikeBackupCode(code)) {
    backupIndex = matchBackupCode(code, user.backupCodeHashes);
    ok = backupIndex >= 0;
  } else {
    const step = verifyTotp(decryptSecret(user.totpSecretEnc, config.secret), code, {
      lastUsedStep: user.totpLastStep,
    });
    ok = step !== null && (await markTotpStepUsed(db, user.id, step));
  }
  await recordAttempt(db, key, ok);
  if (!ok) return { error: 'invalid' };

  const device = await registerDevice(
    db,
    user.id,
    deviceLabel((await headers()).get('user-agent')),
  );
  if (!device) return { error: 'deviceLimit' };
  if (backupIndex >= 0) await consumeBackupCode(db, user.id, backupIndex);

  jar.set(
    SESSION_COOKIE,
    await createSessionToken(config, {
      userId: user.id,
      deviceId: device.id,
      fingerprint: credentialFingerprint(user),
    }),
    sessionCookieOptions(),
  );
  jar.delete({ name: MFA_COOKIE, path: '/login' });
  redirect(safeNextPath(formData.get('next')));
}
