import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, it } from 'vitest';
import { type Db, createDb } from './client';
import { migrateDb } from './migrate';
import { eq } from 'drizzle-orm';
import { userDevices, users } from './schema';
import {
  consumeBackupCode,
  createUser,
  getUserById,
  listDevices,
  setUserDisabled,
  setUserRole,
} from './users';

let db: Db;
let userId: string;

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-users-'));
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  const creds = { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: ['h1', 'h2', 'h3'] };
  userId = (await createUser(db, 'alice', creds)).user.id;
  return () => rm(dir, { recursive: true, force: true });
});

it('uses a backup code up once, by its hash', async () => {
  expect(await consumeBackupCode(db, userId, 'h2')).toBe(true);
  expect((await getUserById(db, userId))?.backupCodeHashes).toEqual(['h1', 'h3']);
  expect(await consumeBackupCode(db, userId, 'h2')).toBe(false);
  expect(await consumeBackupCode(db, userId, 'nope')).toBe(false);
  expect(await consumeBackupCode(db, 'no-such-user', 'h1')).toBe(false);
  expect((await getUserById(db, userId))?.backupCodeHashes).toEqual(['h1', 'h3']);
});

it('lets only one of two parallel sign-ins with one code pass', async () => {
  const results = await Promise.all(
    Array.from({ length: 10 }, () => consumeBackupCode(db, userId, 'h1')),
  );
  expect(results.filter(Boolean)).toHaveLength(1);
  expect((await getUserById(db, userId))?.backupCodeHashes).toEqual(['h2', 'h3']);
});

it('never puts back a code used in parallel with another', async () => {
  const results = await Promise.all([
    consumeBackupCode(db, userId, 'h1'),
    consumeBackupCode(db, userId, 'h3'),
  ]);
  expect(results).toEqual([true, true]);
  expect((await getUserById(db, userId))?.backupCodeHashes).toEqual(['h2']);
});

it('changes a role, signs the account out, and never leaves no admin who can sign in', async () => {
  const creds = { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] };
  // alice is the first account: an admin.
  expect((await getUserById(db, userId))?.role).toBe('admin');
  const bob = (await createUser(db, 'bob', creds, 'member')).user.id;
  const device = (userId: string, label: string) =>
    db.insert(userDevices).values({ userId, label, lastSeenAt: new Date().toISOString() });
  await device(userId, 'd1');
  await device(bob, 'd2');

  // The only admin cannot become a member; nothing is written and nobody is signed out.
  expect(await setUserRole(db, userId, 'member')).toBe('last_admin');
  expect((await getUserById(db, userId))?.role).toBe('admin');
  expect((await listDevices(db, userId)).length).toBe(1);
  // The role it has already: nothing changes, the devices stay.
  expect(await setUserRole(db, userId, 'admin')).toBe('same');
  expect(await setUserRole(db, bob, 'member')).toBe('same');
  expect((await listDevices(db, bob)).length).toBe(1);
  expect(await setUserRole(db, 'no-such-user', 'admin')).toBe('not_found');
  await expect(setUserRole(db, bob, 'owner' as 'admin')).rejects.toThrow('unknown role');

  // A member made an admin is signed out; the other account is untouched.
  expect(await setUserRole(db, bob, 'admin')).toBe('changed');
  expect((await getUserById(db, bob))?.role).toBe('admin');
  expect((await listDevices(db, bob)).length).toBe(0);
  expect((await listDevices(db, userId)).length).toBe(1);

  // An admin that is turned off, or was never set up, does not count as one who can sign in.
  await setUserDisabled(db, bob, true);
  expect(await setUserRole(db, userId, 'member')).toBe('last_admin');
  await setUserDisabled(db, bob, false);
  await db.update(users).set({ passwordHash: null }).where(eq(users.id, bob));
  expect(await setUserRole(db, userId, 'member')).toBe('last_admin');
  await db.update(users).set({ passwordHash: 'x' }).where(eq(users.id, bob));

  // With another admin who can sign in, the first one can become a member, and is signed out.
  expect(await setUserRole(db, userId, 'member')).toBe('changed');
  expect((await getUserById(db, userId))?.role).toBe('member');
  expect((await listDevices(db, userId)).length).toBe(0);
  // And now that one is the last admin.
  expect(await setUserRole(db, bob, 'member')).toBe('last_admin');
});
