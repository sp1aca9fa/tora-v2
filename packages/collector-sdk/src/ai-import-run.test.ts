import { TEST_SOURCES } from '@tora/db/testing';
import {
  type Db,
  addUpload,
  createDb,
  createUser,
  finishUploadBatch,
  pendingImportReview,
  saveSourceInfos,
  schema,
  uploadBatchesOf,
} from '@tora/db';
import { migrateDb } from '@tora/db/migrate';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { beforeEach, expect, it } from 'vitest';
import type { AskClaude, ExtractedRow } from './ai-import';
import { readUploadBatch, readWaitingUploads } from './ai-import-run';

let db: Db;
let userId: string;

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-upload-'));
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  await saveSourceInfos(db, TEST_SOURCES);
  userId = (
    await createUser(db, 'a', { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] })
  ).user.id;
  return () => rm(dir, { recursive: true, force: true });
});

const row = (file: string): ExtractedRow => ({
  file,
  shop: 'メルカリ',
  orderId: 'm12345678901',
  title: 'リザードンex SAR 201/165',
  url: null,
  price: 41000,
  quantity: 1,
  date: '2026-09-01',
  dateApprox: false,
  status: 'purchased',
  collectible: true,
  productId: null,
  product: {
    category: 'tcg',
    kind: 'single',
    name: 'リザードンex',
    franchise: 'pokemon',
    setName: null,
    setCode: 'SV2a',
    cardNumber: '201/165',
    rarity: 'SAR',
    platform: null,
    region: 'jp',
  },
  gradedAs: null,
  sealedState: null,
  unsure: null,
});

it('reads an uploaded batch once into the review, by whoever claims it first', async () => {
  const seen: string[][] = [];
  const ask: AskClaude = async <T>(o: { files?: string[] }) => {
    seen.push(o.files ?? []);
    return {
      output: {
        rows: [
          ...(o.files ?? []).map(row),
          // Not a collectible: left out, but in the import's log.
          { ...row(o.files?.[0] ?? ''), orderId: null, title: '充電ケーブル', collectible: false },
        ],
      } as T,
      costUsd: 0.001,
      tokens: 100,
      modelName: 'claude-haiku-5-5',
    };
  };
  await addUpload(db, userId, 'batch-0001', { name: 'IMG 1.png', data: Buffer.from('png') });
  // Still uploading: not read yet.
  expect(await readWaitingUploads(db, ask)).toBe(0);
  expect(await finishUploadBatch(db, userId, 'batch-0001')).toBe(1);

  expect(await readWaitingUploads(db, ask)).toBe(1);
  // The file reached the reader under a safe, unique name.
  expect(seen[0]).toEqual(['01-IMG_1.png']);
  const review = await pendingImportReview(db, userId);
  expect(review.map((r) => r.product.name)).toEqual(['リザードンex']);
  const [batch] = await uploadBatchesOf(db, userId);
  expect(batch).toMatchObject({ status: 'done', files: ['IMG 1.png'] });
  expect(batch!.importRunId).toBeTruthy();
  const log = await db
    .select()
    .from(schema.importRows)
    .where(eq(schema.importRows.importRunId, batch!.importRunId!))
    .orderBy(schema.importRows.position);
  expect(log.map((r) => [r.title, r.outcome, r.reason, r.detail])).toEqual([
    ['リザードンex SAR 201/165', 'imported', null, 'm12345678901'],
    ['充電ケーブル', 'skipped', 'not_collectible', '01-IMG_1.png'],
  ]);
  expect(log[0]!.holdingId).toBe(review[0]!.holding.id);
  // The file's data is dropped once read; a second read finds nothing waiting.
  const [stored] = await db.select().from(schema.importUploads);
  expect(stored!.data).toBe('');
  expect(await readUploadBatch(db, 'batch-0001', ask)).toBeNull();
});

it('keeps a batch that could not be read, to try again', async () => {
  const ask: AskClaude = async () => {
    throw new Error('claude exited with 1');
  };
  await addUpload(db, userId, 'batch-0002', { name: 'a.png', data: Buffer.from('png') });
  await finishUploadBatch(db, userId, 'batch-0002');
  expect(await readUploadBatch(db, 'batch-0002', ask)).toMatchObject({ status: 'failed' });
  const [batch] = await uploadBatchesOf(db, userId);
  expect(batch).toMatchObject({ status: 'failed', message: 'claude exited with 1' });
  const [stored] = await db.select().from(schema.importUploads);
  expect(stored!.data).not.toBe('');
});
