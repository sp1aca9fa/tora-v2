// Purchase files uploaded in the app for the import through Claude (requirements S8 step 5).
import { toTokyoIso } from '@tora/core';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from './client';
import { importUploads } from './schema';

/** Most files and size per file (a request to the app carries one file of up to ~4 MB). */
export const UPLOAD_MAX_FILES = 30;
export const UPLOAD_MAX_BYTES = 4 * 1024 * 1024;

export async function addUpload(
  db: Db,
  userId: string,
  batchId: string,
  file: { name: string; data: Buffer },
): Promise<void> {
  await db.insert(importUploads).values({
    userId,
    batchId,
    name: file.name,
    size: file.data.length,
    data: file.data.toString('base64'),
    // Held until the upload of the batch is finished.
    status: 'uploading',
  });
}

/** The batch is complete: waiting to be read. */
export async function finishUploadBatch(db: Db, userId: string, batchId: string): Promise<number> {
  const rows = await db
    .update(importUploads)
    .set({ status: 'waiting', updatedAt: toTokyoIso() })
    .where(
      and(
        eq(importUploads.userId, userId),
        eq(importUploads.batchId, batchId),
        eq(importUploads.status, 'uploading'),
      ),
    )
    .returning({ id: importUploads.id });
  return rows.length;
}

/**
 * Claims a waiting batch for reading (so the app and the home PC never read one twice): its
 * files, or null when someone else took it.
 */
export async function claimUploadBatch(db: Db, batchId: string) {
  const claimed = await db
    .update(importUploads)
    .set({ status: 'reading', updatedAt: toTokyoIso() })
    .where(and(eq(importUploads.batchId, batchId), eq(importUploads.status, 'waiting')))
    .returning();
  return claimed.length ? claimed : null;
}

/** Batches waiting to be read, oldest first (all users, or one). */
export async function waitingUploadBatches(
  db: Db,
  userId?: string,
): Promise<{ batchId: string; userId: string }[]> {
  const rows = await db
    .selectDistinct({ batchId: importUploads.batchId, userId: importUploads.userId })
    .from(importUploads)
    .where(
      and(
        eq(importUploads.status, 'waiting'),
        userId ? eq(importUploads.userId, userId) : undefined,
      ),
    );
  return rows;
}

/** A batch was read (or failed): its files' data is dropped. */
export async function finishUploadRead(
  db: Db,
  batchId: string,
  result: { status: 'done' | 'failed'; message: string; importRunId?: string | null },
): Promise<void> {
  await db
    .update(importUploads)
    .set({
      status: result.status,
      message: result.message,
      importRunId: result.importRunId ?? null,
      data: result.status === 'done' ? '' : undefined,
      updatedAt: toTokyoIso(),
    })
    .where(eq(importUploads.batchId, batchId));
}

/** A failed batch goes back to waiting (tried again on the next run). */
export async function retryUploadBatch(db: Db, userId: string, batchId: string): Promise<void> {
  await db
    .update(importUploads)
    .set({ status: 'waiting', message: null, updatedAt: toTokyoIso() })
    .where(
      and(
        eq(importUploads.userId, userId),
        eq(importUploads.batchId, batchId),
        inArray(importUploads.status, ['failed']),
      ),
    );
}

/** The user's recent upload batches, newest first, without the files' data. */
export async function uploadBatchesOf(db: Db, userId: string, limit = 10) {
  const rows = await db
    .select({
      batchId: importUploads.batchId,
      name: importUploads.name,
      status: importUploads.status,
      message: importUploads.message,
      importRunId: importUploads.importRunId,
      createdAt: importUploads.createdAt,
    })
    .from(importUploads)
    .where(eq(importUploads.userId, userId))
    .orderBy(desc(importUploads.createdAt))
    .limit(limit * UPLOAD_MAX_FILES);
  const batches = new Map<
    string,
    {
      batchId: string;
      files: string[];
      status: string;
      message: string | null;
      importRunId: string | null;
      createdAt: string;
    }
  >();
  for (const r of rows) {
    const b = batches.get(r.batchId) ?? { ...r, files: [] };
    b.files.push(r.name);
    batches.set(r.batchId, b);
  }
  return [...batches.values()].slice(0, limit);
}
