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
  consumeBackupCode,
  getDb,
  loadTimeZone,
  markTotpStepUsed,
  recordAdminChange,
  setupByToken,
} from '@tora/db';
import { clientIp } from '@/lib/auth/admin-code';
import { beginAttempt } from '@/lib/auth/lockout';
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
  const attempt = await beginAttempt(db, key);
  if (!attempt) return { error: 'locked' };

  const newPassword = setup.kind !== '2fa';
  const newAuthenticator = setup.kind !== 'password';
  const password = String(form.get('password') ?? '');
  if (newPassword) {
    // Form errors guess nothing: they do not count toward the lockout.
    const error =
      password.length < MIN_PASSWORD
        ? 'short'
        : password !== String(form.get('repeat') ?? '')
          ? 'mismatch'
          : null;
    if (error) {
      await attempt.drop();
      return { error };
    }
  }

  // The factor kept proves it is the person.
  const current = String(form.get('current') ?? '');
  if (setup.kind === 'password') {
    let ok = false;
    if (looksLikeBackupCode(current)) {
      // Used up here, atomically (as at sign-in): one code proves it once, even in parallel.
      const hash = matchBackupCode(current.trim(), user.backupCodeHashes, config.secret);
      ok = hash !== null && (await consumeBackupCode(db, user.id, hash));
    } else if (user.totpSecretEnc) {
      const step = verifyTotp(decryptSecret(user.totpSecretEnc, config.secret), current.trim(), {
        lastUsedStep: user.totpLastStep,
      });
      ok = step !== null && (await markTotpStepUsed(db, user.id, step));
    }
    if (!ok) {
      await attempt.settle(false);
      return { error: 'invalid' };
    }
  }
  if (
    setup.kind === '2fa' &&
    !(user.passwordHash && (await verifyPassword(current, user.passwordHash)))
  ) {
    await attempt.settle(false);
    return { error: 'invalid' };
  }
  if (newAuthenticator) {
    const offered = setup.totpSecretEnc;
    if (
      !offered ||
      verifyTotp(decryptSecret(offered, config.secret), String(form.get('code') ?? '')) === null
    ) {
      await attempt.settle(false);
      return { error: 'newCode' };
    }
  }

  const backup = newAuthenticator ? generateBackupCodes(config.secret) : null;
  const done = await completeSetup(db, setup.id, {
    ...(newPassword ? { passwordHash: await hashPassword(password) } : {}),
    ...(newAuthenticator ? { totpSecretEnc: setup.totpSecretEnc! } : {}),
    ...(backup ? { backupCodeHashes: backup.hashes } : {}),
  });
  if (!done) {
    // The link was used meanwhile: nothing saved, no failure counted (as before any check).
    await attempt.drop();
    return { error: 'expired' };
  }
  await attempt.settle(true);
  await recordAdminChange(db, user.id, 'userSetupDone', { user: user.username, setup: setup.kind });
  return { done: true, backupCodes: backup?.codes };
}
