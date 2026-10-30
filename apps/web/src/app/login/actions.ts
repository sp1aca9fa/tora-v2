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
  type LoginFailureReason,
  MAX_ACTIVE_DEVICES,
  alertLoginFailure,
  consumeBackupCode,
  getDb,
  getUserById,
  getUserByUsername,
  listDevices,
  loadTimeZone,
  markTotpStepUsed,
  registerDevice,
} from '@tora/db';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { alertContext } from '@/lib/alert-context';
import { clientIp } from '@/lib/auth/admin-code';
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

/** The page only says a sign-in failed; why goes to the account's channels (2026-10-30). */
export type LoginState = {
  error?: 'failed' | 'notConfigured';
  /** Which step failed (marks its field). */
  step?: 'password' | 'code';
};

/**
 * Tells why a sign-in failed, after the answer is sent: the same answer and timing whatever the
 * reason, so a wrong guess learns nothing from either.
 */
async function failed(
  reason: LoginFailureReason,
  who: { userId: string | null; username: string; devices?: string[] },
  step: LoginState['step'],
): Promise<LoginState> {
  const [ip, h] = await Promise.all([clientIp(), headers()]);
  const device = deviceLabel(h.get('user-agent'));
  const ctx = alertContext();
  if (ctx) {
    after(() =>
      alertLoginFailure(getDb(), ctx, { reason, ...who, ip, device }).catch((error) =>
        console.error('Login alert failed', error),
      ),
    );
  }
  return { error: 'failed', step };
}

/** Verifying a fixed hash for unknown usernames keeps the response time the same. */
let dummyHash: Promise<string> | undefined;

/**
 * Step 1: username + password. On success, a short-lived cookie unlocks step 2. A wrong
 * username or password, an account already on its 2 devices and one not set up yet get the
 * same answer after the same work, so a wrong guess never learns which it was; the account's
 * channels are told which.
 */
export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const config = authConfigFromEnv();
  if (!config) return { error: 'notConfigured' };
  const db = getDb();
  await loadTimeZone(db);
  const username = normalizeUsername(String(formData.get('username') ?? '')) ?? '';
  const key = {
    ipHash: keyedHash(await clientIp(), config.secret),
    usernameHash: username ? keyedHash(username, config.secret) : null,
  };
  const user = username ? await getUserByUsername(db, username) : null;
  const who = { userId: user?.id ?? null, username };
  if (await isLockedOut(db, key)) return failed('locked', who, 'password');

  const password = String(formData.get('password') ?? '');
  const usable = user?.passwordHash && !user.disabledAt ? user : null;
  dummyHash ??= hashPassword('unused-dummy-password');
  const ok = await verifyPassword(password, usable?.passwordHash ?? (await dummyHash));
  const devices = await listDevices(db, usable?.id ?? '');
  await recordAttempt(db, key, ok && Boolean(usable));
  if (!user) return failed('unknownUser', who, 'password');
  if (!usable) return failed(user.disabledAt ? 'disabled' : 'notSetUp', who, 'password');
  if (!ok) return failed('password', who, 'password');
  if (!usable.totpSecretEnc) return failed('notSetUp', who, 'password');
  if (devices.length >= MAX_ACTIVE_DEVICES) {
    return failed('devices', { ...who, devices: devices.map((d) => d.label ?? '-') }, 'password');
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
  await loadTimeZone(db);
  const jar = await cookies();
  const userId = await verifyMfaToken(jar.get(MFA_COOKIE)?.value, config);
  const user = userId ? await getUserById(db, userId) : null;
  // The step 1 cookie ran out (or the account changed meanwhile): start over, nothing to tell.
  if (!user?.totpSecretEnc || user.disabledAt) return { error: 'failed', step: 'code' };
  const who = { userId: user.id, username: user.username };

  const key = {
    ipHash: keyedHash(await clientIp(), config.secret),
    usernameHash: keyedHash(user.username, config.secret),
  };
  if (await isLockedOut(db, key)) return failed('locked', who, 'code');

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
  if (!ok) return failed('code', who, 'code');

  const device = await registerDevice(
    db,
    user.id,
    deviceLabel((await headers()).get('user-agent')),
  );
  if (!device) {
    const devices = await listDevices(db, user.id);
    return failed('devices', { ...who, devices: devices.map((d) => d.label ?? '-') }, 'code');
  }
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
