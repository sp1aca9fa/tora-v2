'use server';

import {
  decryptSecret,
  generateBackupCodes,
  hashPassword,
  keyedHash,
  looksLikeBackupCode,
  matchBackupCode,
  verifyPassword,
  verifyTotp,
} from '@tora/auth';
import {
  completeSetup,
  getDb,
  loadTimeZone,
  markTotpStepUsed,
  recordAdminChange,
  setupByToken,
} from '@tora/db';
import { clientIp } from '@/lib/auth/admin-code';
import { isLockedOut, recordAttempt } from '@/lib/auth/lockout';
import { authConfigFromEnv } from '@/lib/auth/session';

/** As `pnpm user` asks (the page says so too). */
const MIN_PASSWORD = 12;

export interface SetupState {
  error?: 'expired' | 'locked' | 'notConfigured' | 'short' | 'mismatch' | 'invalid' | 'newCode';
  /** Done: the backup codes when a new authenticator was set (shown once). */
  done?: boolean;
  backupCodes?: string[];
}

/**
 * A setup link's form (S21): a new password and/or authenticator. A reset of one asks for the
 * other (the current authenticator code for a new password, the current password for a new
 * authenticator), so a link reaching someone else is not enough.
 */
export async function completeSetupAction(_prev: SetupState, form: FormData): Promise<SetupState> {
  const config = authConfigFromEnv();
  if (!config) return { error: 'notConfigured' };
  const db = getDb();
  await loadTimeZone(db);
  const found = await setupByToken(db, String(form.get('token') ?? ''));
  if (!found) return { error: 'expired' };
  const { setup, user } = found;
  const key = {
    ipHash: keyedHash(await clientIp(), config.secret),
    usernameHash: keyedHash(user.username, config.secret),
  };
  if (await isLockedOut(db, key)) return { error: 'locked' };

  const newPassword = setup.kind !== '2fa';
  const newAuthenticator = setup.kind !== 'password';
  const password = String(form.get('password') ?? '');
  if (newPassword) {
    if (password.length < MIN_PASSWORD) return { error: 'short' };
    if (password !== String(form.get('repeat') ?? '')) return { error: 'mismatch' };
  }

  // The factor kept proves it is the person.
  const current = String(form.get('current') ?? '');
  let backupIndex = -1;
  if (setup.kind === 'password') {
    let ok = false;
    if (looksLikeBackupCode(current)) {
      backupIndex = matchBackupCode(current.trim(), user.backupCodeHashes);
      ok = backupIndex >= 0;
    } else if (user.totpSecretEnc) {
      const step = verifyTotp(decryptSecret(user.totpSecretEnc, config.secret), current.trim(), {
        lastUsedStep: user.totpLastStep,
      });
      ok = step !== null && (await markTotpStepUsed(db, user.id, step));
    }
    if (!ok) {
      await recordAttempt(db, key, false);
      return { error: 'invalid' };
    }
  }
  if (
    setup.kind === '2fa' &&
    !(user.passwordHash && (await verifyPassword(current, user.passwordHash)))
  ) {
    await recordAttempt(db, key, false);
    return { error: 'invalid' };
  }
  if (newAuthenticator) {
    const offered = setup.totpSecretEnc;
    if (
      !offered ||
      verifyTotp(decryptSecret(offered, config.secret), String(form.get('code') ?? '')) === null
    ) {
      await recordAttempt(db, key, false);
      return { error: 'newCode' };
    }
  }

  const backup = newAuthenticator ? generateBackupCodes() : null;
  const done = await completeSetup(db, setup.id, {
    ...(newPassword ? { passwordHash: await hashPassword(password) } : {}),
    ...(newAuthenticator ? { totpSecretEnc: setup.totpSecretEnc! } : {}),
    ...(backup
      ? { backupCodeHashes: backup.hashes }
      : backupIndex >= 0
        ? { backupCodeHashes: user.backupCodeHashes.filter((_, i) => i !== backupIndex) }
        : {}),
  });
  if (!done) return { error: 'expired' };
  await recordAttempt(db, key, true);
  await recordAdminChange(db, user.id, 'userSetupDone', { user: user.username, setup: setup.kind });
  return { done: true, backupCodes: backup?.codes };
}
