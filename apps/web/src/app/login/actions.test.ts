// A locked-out sign-in does no password hash (2026-10-31) and answers like any other failure.
import { hashPassword, keyedHash } from '@tora/auth';
import { type Db, createUser, getDb } from '@tora/db';
import { migrateDb } from '@tora/db/migrate';
import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { MAX_FAILURES_PER_IP, recordAttempt } from '@/lib/auth/lockout';

const env = await vi.hoisted(async () => {
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(`${tmpdir()}/tora-login-`);
  process.env.DATABASE_URL = `file:${dir}/test.db`;
  process.env.AUTH_SECRET = 'a'.repeat(32);
  return { ip: '203.0.113.1' };
});

const verifyPassword = vi.hoisted(() => vi.fn());
vi.mock('@tora/auth', async (real) => {
  const auth = await real<typeof import('@tora/auth')>();
  verifyPassword.mockImplementation(auth.verifyPassword);
  return { ...auth, verifyPassword };
});
const alertLoginFailure = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => 0));
vi.mock('@tora/db', async (real) => ({
  ...(await real<typeof import('@tora/db')>()),
  alertLoginFailure,
}));
vi.mock('next/server', () => ({ after: (fn: () => unknown) => fn() }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
  headers: async () => new Headers({ 'x-real-ip': env.ip }),
}));

const { loginAction } = await import('./actions');

let db: Db;

beforeAll(async () => {
  db = getDb();
  await migrateDb(db);
  await createUser(db, 'member', {
    passwordHash: await hashPassword('right password'),
    totpSecretEnc: 'y',
    backupCodeHashes: [],
  });
});

beforeEach(() => {
  verifyPassword.mockClear();
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
