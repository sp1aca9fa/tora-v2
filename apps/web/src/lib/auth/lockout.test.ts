import { type Db, createDb } from '@tora/db';
import { migrateDb } from '@tora/db/migrate';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, it } from 'vitest';
import {
  MAX_FAILURES_GLOBAL,
  MAX_FAILURES_PER_IP,
  MAX_FAILURES_PER_USERNAME,
  isLockedOut,
  recordAttempt,
} from './lockout';

let db: Db;
const now = new Date('2026-10-09T03:00:00Z');

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-auth-'));
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  return () => rm(dir, { recursive: true, force: true });
});

it('locks an IP after repeated failures, then releases after the window', async () => {
  for (let i = 0; i < MAX_FAILURES_PER_IP - 1; i++)
    await recordAttempt(db, { ipHash: 'ip1' }, false, now);
  expect(await isLockedOut(db, { ipHash: 'ip1' }, now)).toBe(false);
  await recordAttempt(db, { ipHash: 'ip1' }, false, now);
  expect(await isLockedOut(db, { ipHash: 'ip1' }, now)).toBe(true);
  expect(await isLockedOut(db, { ipHash: 'ip2' }, now)).toBe(false);
  expect(await isLockedOut(db, { ipHash: 'ip1' }, new Date(now.getTime() + 16 * 60 * 1000))).toBe(
    false,
  );
});

it('locks a username attacked from many IPs', async () => {
  for (let i = 0; i < MAX_FAILURES_PER_USERNAME; i++) {
    await recordAttempt(db, { ipHash: `ip${i}`, usernameHash: 'alice' }, false, now);
  }
  expect(await isLockedOut(db, { ipHash: 'fresh', usernameHash: 'alice' }, now)).toBe(true);
  expect(await isLockedOut(db, { ipHash: 'fresh', usernameHash: 'bob' }, now)).toBe(false);
});

it('locks everyone after too many failures overall', async () => {
  for (let i = 0; i < MAX_FAILURES_GLOBAL; i++)
    await recordAttempt(db, { ipHash: `ip${i}` }, false, now);
  expect(await isLockedOut(db, { ipHash: 'fresh' }, now)).toBe(true);
});
