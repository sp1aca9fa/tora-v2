import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, it } from 'vitest';
import {
  completeSetup,
  createPendingUser,
  makeSetupLink,
  offerSetupSecret,
  pendingSetups,
  setupByToken,
} from './accounts';
import { type Db, createDb } from './client';
import { collectRequest, requestCollect, takeCollectRequest } from './collect-request';
import { migrateDb } from './migrate';
import { createUser, getUserById, listDevices, registerDevice } from './users';

let db: Db;
let admin: string;

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-accounts-'));
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  const creds = { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] };
  admin = (await createUser(db, 'admin', creds)).user.id;
  return () => rm(dir, { recursive: true, force: true });
});

it('sets up a new account once, through its link only', async () => {
  const user = await createPendingUser(db, 'bob', 'member');
  const first = await makeSetupLink(db, user.id, 'both', admin);
  const { token } = await makeSetupLink(db, user.id, 'both', admin);
  // A new link stops the old one; a made-up token opens nothing.
  expect(await setupByToken(db, first.token)).toBeNull();
  expect(await setupByToken(db, 'tora_setup_nope')).toBeNull();
  const found = (await setupByToken(db, token))!;
  expect(found.user.username).toBe('bob');
  await offerSetupSecret(db, found.setup.id, 'enc1');
  await offerSetupSecret(db, found.setup.id, 'enc2');
  expect((await setupByToken(db, token))!.setup.totpSecretEnc).toBe('enc1');
  expect((await pendingSetups(db)).get(user.id)?.kind).toBe('both');

  expect(
    await completeSetup(db, found.setup.id, {
      passwordHash: 'p',
      totpSecretEnc: 'enc1',
      backupCodeHashes: ['h'],
    }),
  ).toBe(true);
  expect(await completeSetup(db, found.setup.id, { passwordHash: 'q' })).toBe(false);
  expect(await setupByToken(db, token)).toBeNull();
  expect(await getUserById(db, user.id)).toMatchObject({
    passwordHash: 'p',
    totpSecretEnc: 'enc1',
  });
  expect((await pendingSetups(db)).size).toBe(0);
});

it('signs every device out on a reset, and expires', async () => {
  await registerDevice(db, admin, 'phone');
  const { token } = await makeSetupLink(db, admin, 'password', admin);
  const later = new Date(Date.now() + 25 * 3_600_000);
  expect(await setupByToken(db, token, later)).toBeNull();
  const found = (await setupByToken(db, token))!;
  await completeSetup(db, found.setup.id, { passwordHash: 'new' });
  expect(await listDevices(db, admin)).toEqual([]);
  expect((await getUserById(db, admin))!.totpSecretEnc).toBe('y');
});

it('takes a collect request once', async () => {
  expect(await takeCollectRequest(db)).toBe(false);
  await requestCollect(db, admin);
  expect(await takeCollectRequest(db)).toBe(true);
  expect(await takeCollectRequest(db)).toBe(false);
  expect((await collectRequest(db))!.takenAt).not.toBeNull();
});
