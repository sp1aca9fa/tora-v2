import { toLocalIso } from '@tora/core';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { beforeEach, expect, it } from 'vitest';
import { type Db, createDb } from './client';
import { migrateDb } from './migrate';
import { importUploads } from './schema';
import {
  UPLOAD_READING_STALE_MS,
  addUpload,
  claimUploadBatch,
  finishUploadBatch,
  finishUploadRead,
  renewUploadClaim,
  retryUploadBatch,
  waitingUploadBatches,
} from './uploads';
import { createUser } from './users';

let db: Db;
let userId: string;

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-uploads-'));
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  userId = (
    await createUser(db, 'a', { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] })
  ).user.id;
  return () => rm(dir, { recursive: true, force: true });
});

const statusOf = async () =>
  (await db.select().from(importUploads).where(eq(importUploads.batchId, 'b')))[0]!.status;

it('takes a batch stuck in reading as failed after 6 hours', async () => {
  await addUpload(db, userId, 'b', { name: 'order.pdf', data: Buffer.from('x') });
  await finishUploadBatch(db, userId, 'b');
  const start = new Date('2026-10-31T10:00:00+09:00');
  expect(await claimUploadBatch(db, 'b', start)).toHaveLength(1);
  // Being read: nobody else takes it, nor retries it.
  const soon = new Date(start.getTime() + UPLOAD_READING_STALE_MS - 60_000);
  expect(await waitingUploadBatches(db, undefined, soon)).toEqual([]);
  expect(await claimUploadBatch(db, 'b', soon)).toBeNull();
  await retryUploadBatch(db, userId, 'b', soon);
  expect(await statusOf()).toBe('reading');

  // The reader died: the home PC picks it up again.
  const late = new Date(start.getTime() + UPLOAD_READING_STALE_MS + 60_000);
  expect(await waitingUploadBatches(db, undefined, late)).toEqual([{ batchId: 'b', userId }]);
  expect(await claimUploadBatch(db, 'b', late)).toHaveLength(1);
  expect(await claimUploadBatch(db, 'b', late)).toBeNull();

  // Or the person retries it.
  const later = new Date(late.getTime() + UPLOAD_READING_STALE_MS + 60_000);
  await retryUploadBatch(db, 'someone-else', 'b', later);
  expect(await statusOf()).toBe('reading');
  await retryUploadBatch(db, userId, 'b', later);
  expect(await statusOf()).toBe('waiting');
  expect(toLocalIso(later)).toBe(
    (await db.select().from(importUploads).where(eq(importUploads.batchId, 'b')))[0]!.updatedAt,
  );
});

it('lets a read import only while its claim is its own', async () => {
  await addUpload(db, userId, 'b', { name: 'order.pdf', data: Buffer.from('x') });
  await finishUploadBatch(db, userId, 'b');
  const start = new Date('2026-10-31T10:00:00+09:00');
  const first = (await claimUploadBatch(db, 'b', start))![0]!.updatedAt;
  const renewed = await renewUploadClaim(db, 'b', first, new Date(start.getTime() + 60_000));
  expect(renewed).toBe(toLocalIso(new Date(start.getTime() + 60_000)));
  // The old token no longer holds once renewed.
  expect(await renewUploadClaim(db, 'b', first)).toBeNull();

  // The first read outlives its claim; a second reader takes the batch.
  const late = new Date(start.getTime() + 60_000 + UPLOAD_READING_STALE_MS + 60_000);
  const second = (await claimUploadBatch(db, 'b', late))![0]!.updatedAt;
  expect(await renewUploadClaim(db, 'b', renewed!, late)).toBeNull();
  // Its failure does not overwrite the second read.
  await finishUploadRead(db, 'b', { status: 'failed', message: 'x' }, renewed!);
  expect(await statusOf()).toBe('reading');
  expect(await renewUploadClaim(db, 'b', second, late)).toBe(second);
  await finishUploadRead(db, 'b', { status: 'done', message: 'ok' }, second);
  expect(await statusOf()).toBe('done');
});
