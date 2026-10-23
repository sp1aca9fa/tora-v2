import 'server-only';
import { decryptSecret, keyedHash, verifyTotp } from '@tora/auth';
import { markTotpStepUsed } from '@tora/db';
import { headers } from 'next/headers';
import type { Session } from './guard';
import { isLockedOut, recordAttempt } from './lockout';
import { authConfigFromEnv } from './session';

/** The client's IP as the platform gives it (a hosting platform's edge or the server's proxy sets these headers). */
export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get('x-real-ip') ?? h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

export type CodeCheck = 'ok' | 'invalid' | 'locked' | 'notConfigured';

/**
 * The admin's own authenticator code, asked before a risky account task (S21): a session left
 * open on a device is not enough. Failures count toward the login lockout.
 */
export async function checkAdminCode({ db, user }: Session, code: string): Promise<CodeCheck> {
  const config = authConfigFromEnv();
  if (!config || !user.totpSecretEnc) return 'notConfigured';
  const key = {
    ipHash: keyedHash(await clientIp(), config.secret),
    usernameHash: keyedHash(user.username, config.secret),
  };
  if (await isLockedOut(db, key)) return 'locked';
  const step = verifyTotp(decryptSecret(user.totpSecretEnc, config.secret), code.trim(), {
    lastUsedStep: user.totpLastStep,
  });
  const ok = step !== null && (await markTotpStepUsed(db, user.id, step));
  await recordAttempt(db, key, ok);
  return ok ? 'ok' : 'invalid';
}

/** The app's own address, for links shown to be sent on (setup links). */
export async function appOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto =
    h.get('x-forwarded-proto') ??
    (/^(localhost|127\.|192\.168\.|10\.)/.test(host) ? 'http' : 'https');
  return `${proto}://${host}`;
}
