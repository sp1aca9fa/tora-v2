import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, it } from 'vitest';
import { type Db, createDb } from './client';
import { migrateDb } from './migrate';
import { consumeBackupCode, createUser, getUserById } from './users';

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
