import { type Db, createDb } from '@tora/db';
import { migrateDb } from '@tora/db/migrate';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, it } from 'vitest';
import { MAX_FAILURES_GLOBAL, MAX_FAILURES_PER_IP, isLockedOut, recordAttempt } from './lockout';

let db: Db;

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-auth-'));
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  return () => rm(dir, { recursive: true, force: true });
});

it('locks an IP after repeated failures, then releases after the window', async () => {
  const now = new Date('2026-10-09T03:00:00Z');
  for (let i = 0; i < MAX_FAILURES_PER_IP - 1; i++) await recordAttempt(db, 'ip1', false, now);
  expect(await isLockedOut(db, 'ip1', now)).toBe(false);
  await recordAttempt(db, 'ip1', false, now);
  expect(await isLockedOut(db, 'ip1', now)).toBe(true);
  expect(await isLockedOut(db, 'ip2', now)).toBe(false);

  const later = new Date(now.getTime() + 16 * 60 * 1000);
  expect(await isLockedOut(db, 'ip1', later)).toBe(false);
});

it('locks everyone after too many failures across IPs', async () => {
  const now = new Date('2026-10-09T03:00:00Z');
  for (let i = 0; i < MAX_FAILURES_GLOBAL; i++) await recordAttempt(db, `ip${i}`, false, now);
  expect(await isLockedOut(db, 'fresh-ip', now)).toBe(true);
});
