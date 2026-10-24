import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, it } from 'vitest';
import { type Db, createDb } from './client';
import { migrateDb } from './migrate';
import {
  createStatusToken,
  removeStatusToken,
  statusTokenCreatedAt,
  statusTokenValid,
} from './status-token';

const SECRET = 'test-secret-0123456789abcdef0123456789';
let db: Db;

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-status-'));
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  return () => rm(dir, { recursive: true, force: true });
});

it('accepts only the newest status token, and none once removed', async () => {
  expect(await statusTokenValid(db, 'Bearer x', SECRET)).toBe(false);
  const first = await createStatusToken(db, SECRET);
  expect(await statusTokenValid(db, `Bearer ${first}`, SECRET)).toBe(true);
  expect(await statusTokenValid(db, first, SECRET)).toBe(false);
  const second = await createStatusToken(db, SECRET);
  expect(await statusTokenValid(db, `Bearer ${first}`, SECRET)).toBe(false);
  expect(await statusTokenValid(db, `Bearer ${second}`, SECRET)).toBe(true);
  expect(await statusTokenCreatedAt(db)).not.toBeNull();
  await removeStatusToken(db);
  expect(await statusTokenValid(db, `Bearer ${second}`, SECRET)).toBe(false);
  expect(await statusTokenCreatedAt(db)).toBeNull();
});
