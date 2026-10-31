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
import { isIP } from 'node:net';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { alertContext } from '@/lib/alert-context';
import { clientIp } from '@/lib/auth/admin-code';
import { beginAttempt } from '@/lib/auth/lockout';
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
  /** `expired`: step 1 must be done again (said plainly: only someone past it sees it). */
  error?: 'failed' | 'expired' | 'notConfigured';
  /** Which step failed (marks its field). */
  step?: 'password' | 'code';
};

/**
 * Tells why a sign-in failed, after the answer is sent: the same answer and timing whatever the
 * reason, so a wrong guess learns nothing from either.
 */
async function failed(
  reason: LoginFailureReason,
  who: { userId: string | null; username: string; devices?: string[]; passwordKnown: boolean },
  step: LoginState['step'],
): Promise<LoginState> {
  const [raw, h] = await Promise.all([clientIp(), headers()]);
  // Only an address goes into the message: the header may carry any text a client sent.
  const ip = isIP(raw) ? raw : 'unknown';
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
let dummy: Promise<{ hash: string; ms: number }> | undefined;
/**
 * How long the last checked sign-in took (hash, devices, attempt saved): a locked-out one waits
 * as long instead of hashing (2026-10-31), the dummy's own time before any was checked.
 */
let lastCheckMs: number | undefined;

async function makeDummy() {
  const start = performance.now();
  const hash = await hashPassword('unused-dummy-password');
  return { hash, ms: performance.now() - start };
}

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
  const password = String(formData.get('password') ?? '');
  const usable = user?.passwordHash && !user.disabledAt ? user : null;
  dummy ??= makeDummy();
  const attempt = await beginAttempt(db, key);
  if (!attempt) {
    // No hash while locked out, so a flood of guesses costs only timers; the wait keeps the
    // answer's timing like a checked password's. The password stays unknown.
    const ms = lastCheckMs ?? (await dummy).ms;
    await new Promise((resolve) => setTimeout(resolve, ms));
    return failed(
      'locked',
      { userId: user?.id ?? null, username, passwordKnown: false },
      'password',
    );
  }
  const stored = usable?.passwordHash ?? (await dummy).hash;
  const start = performance.now();
  const ok = await verifyPassword(password, stored);
  const devices = await listDevices(db, usable?.id ?? '');
  const who = { userId: user?.id ?? null, username, passwordKnown: ok && !!usable };
  await attempt.settle(ok && Boolean(usable));
  lastCheckMs = performance.now() - start;
  if (!user) return failed('unknownUser', who, 'password');
  if (!usable) return failed(user.disabledAt ? 'disabled' : 'notSetUp', who, 'password');
  if (!ok) return failed('password', who, 'password');
  if (!usable.totpSecretEnc) return failed('notSetUp', who, 'password');
  if (devices.length >= MAX_ACTIVE_DEVICES) {
    return failed('devices', { ...who, devices: devices.map((d) => d.label ?? '-') }, 'password');
  }

  const mfa = await createMfaToken(config, usable.id, credentialFingerprint(usable));
  (await cookies()).set(MFA_COOKIE, mfa, {
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
  const pending = await verifyMfaToken(jar.get(MFA_COOKIE)?.value, config);
  const user = pending ? await getUserById(db, pending.userId) : null;
  // The step 1 cookie ran out (or the account, its password or authenticator changed meanwhile):
  // start over, nothing to tell.
  if (
    !user?.totpSecretEnc ||
    user.disabledAt ||
    credentialFingerprint(user) !== pending?.fingerprint
  ) {
    return { error: 'expired', step: 'code' };
  }
  // Past step 1: the password was right.
  const who = { userId: user.id, username: user.username, passwordKnown: true };

  const key = {
    ipHash: keyedHash(await clientIp(), config.secret),
    usernameHash: keyedHash(user.username, config.secret),
  };
  const attempt = await beginAttempt(db, key);
  if (!attempt) return failed('locked', who, 'code');

  const code = String(formData.get('code') ?? '').trim();
  let ok = false;
  if (looksLikeBackupCode(code)) {
    // Used up before the device is registered: one code signs in once, even in parallel.
    const hash = matchBackupCode(code, user.backupCodeHashes, config.secret);
    ok = hash !== null && (await consumeBackupCode(db, user.id, hash));
  } else {
    const step = verifyTotp(decryptSecret(user.totpSecretEnc, config.secret), code, {
      lastUsedStep: user.totpLastStep,
    });
    ok = step !== null && (await markTotpStepUsed(db, user.id, step));
  }
  await attempt.settle(ok);
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
