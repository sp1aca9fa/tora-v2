// A locked-out sign-in does no password hash (2026-10-31) and answers like any other failure.
import {
  encryptSecret,
  generateBackupCodes,
  generateTotpSecret,
  hashPassword,
  keyedHash,
} from '@tora/auth';
import { type Db, type User, createUser, getDb, getUserById, listDevices } from '@tora/db';
import { migrateDb } from '@tora/db/migrate';
import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { MAX_FAILURES_PER_IP, recordAttempt } from '@/lib/auth/lockout';
import { createMfaToken, credentialFingerprint } from '@/lib/auth/session';

const env = await vi.hoisted(async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(`${tmpdir()}/tora-login-`);
  process.env.DATABASE_URL = `file:${dir}/test.db`;
  process.env.AUTH_SECRET = 'a'.repeat(32);
  return { ip: '203.0.113.1', mfa: '' };
});

const verifyPassword = vi.hoisted(() => vi.fn());
const verifyTotp = vi.hoisted(() => vi.fn());
vi.mock('@tora/auth', async (real) => {
  const auth = await real<typeof import('@tora/auth')>();
  verifyPassword.mockImplementation(auth.verifyPassword);
  verifyTotp.mockImplementation(auth.verifyTotp);
  return { ...auth, verifyPassword, verifyTotp };
});
const alertLoginFailure = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => 0));
vi.mock('@tora/db', async (real) => ({
  ...(await real<typeof import('@tora/db')>()),
  alertLoginFailure,
}));
vi.mock('next/server', () => ({ after: (fn: () => unknown) => fn() }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name === 'tora_mfa' && env.mfa ? { value: env.mfa } : undefined),
    set: () => {},
    delete: () => {},
  }),
  headers: async () => new Headers({ 'x-real-ip': env.ip }),
}));

const { loginAction, verifyAction } = await import('./actions');

let db: Db;
let coder: User;
const secret = process.env.AUTH_SECRET!;
const backup = generateBackupCodes(secret);

beforeAll(async () => {
  db = getDb();
  await migrateDb(db);
  await createUser(db, 'member', {
    passwordHash: await hashPassword('right password'),
    totpSecretEnc: 'y',
    backupCodeHashes: [],
  });
  coder = (
    await createUser(db, 'coder', {
      passwordHash: await hashPassword('right password'),
      totpSecretEnc: encryptSecret(generateTotpSecret(), secret),
      backupCodeHashes: backup.hashes,
    })
  ).user;
});

beforeEach(() => {
  verifyPassword.mockClear();
  verifyTotp.mockClear();
  alertLoginFailure.mockClear();
});

const form = (password: string) => {
  const data = new FormData();
  data.set('username', 'member');
  data.set('password', password);
  return data;
};

it('checks the password when not locked out', async () => {
  env.ip = '203.0.113.1';
  expect(await loginAction({}, form('wrong password'))).toEqual({
    error: 'failed',
    step: 'password',
  });
  expect(verifyPassword).toHaveBeenCalledOnce();
  expect(alertLoginFailure.mock.calls[0]?.[2]).toMatchObject({
    reason: 'password',
    passwordKnown: false,
  });
});

it('does no hash while locked out, even with the right password, and answers the same', async () => {
  env.ip = '203.0.113.2';
  const ipHash = keyedHash(env.ip, process.env.AUTH_SECRET!);
  for (let i = 0; i < MAX_FAILURES_PER_IP; i++) await recordAttempt(db, { ipHash }, false);
  expect(await loginAction({}, form('right password'))).toEqual({
    error: 'failed',
    step: 'password',
  });
  expect(verifyPassword).not.toHaveBeenCalled();
  expect(alertLoginFailure.mock.calls[0]?.[2]).toMatchObject({
    reason: 'locked',
    passwordKnown: false,
  });
});

const codeForm = (code: string) => {
  const data = new FormData();
  data.set('code', code);
  return data;
};

/** Step 2's answer, or 'signedIn' when it redirected into the app. */
async function verify(code: string) {
  try {
    return await verifyAction({}, codeForm(code));
  } catch (error) {
    if (String((error as { digest?: string }).digest).startsWith('NEXT_REDIRECT')) {
      return 'signedIn';
    }
    throw error;
  }
}

it('checks at most the lockout limit of codes sent in parallel', async () => {
  env.ip = '203.0.113.3';
  env.mfa = await createMfaToken({ secret }, coder.id, credentialFingerprint(coder));
  const results = await Promise.all(Array.from({ length: 20 }, () => verify('000000')));
  expect(results.every((r) => r !== 'signedIn')).toBe(true);
  expect(verifyTotp.mock.calls.length).toBeLessThanOrEqual(MAX_FAILURES_PER_IP);
});

it('signs in once with a backup code sent twice in parallel', async () => {
  env.ip = '203.0.113.4';
  env.mfa = await createMfaToken({ secret }, coder.id, credentialFingerprint(coder));
  const results = await Promise.all([verify(backup.codes[0]!), verify(backup.codes[0]!)]);
  expect(results.filter((r) => r === 'signedIn')).toHaveLength(1);
  expect(await listDevices(db, coder.id)).toHaveLength(1);
  const left = (await getUserById(db, coder.id))!.backupCodeHashes;
  expect(left).toEqual(backup.hashes.slice(1));
});

it('starts over when the password changed after step 1', async () => {
  env.ip = '203.0.113.5';
  env.mfa = await createMfaToken({ secret }, coder.id, 'made-with-the-old-password');
  expect(await verify(backup.codes[1]!)).toEqual({ error: 'expired', step: 'code' });
  expect((await getUserById(db, coder.id))!.backupCodeHashes).toContain(backup.hashes[1]);
});
