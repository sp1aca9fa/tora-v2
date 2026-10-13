'use server';

import { readUploadBatch, askClaudeApi, claudeApiAvailable } from '@tora/collector-sdk/uploads';
import {
  UPLOAD_MAX_BYTES,
  UPLOAD_MAX_FILES,
  addUpload,
  finishUploadBatch,
  retryUploadBatch,
  uploadBatchesOf,
} from '@tora/db';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { authed } from '@/lib/auth/guard';

const TYPES = /\.(png|jpe?g|webp|gif|pdf|txt|csv|html?|eml)$/i;

/** One file of an upload batch (sent one by one: a request carries one file). */
export async function uploadFileAction(
  batchId: string,
  formData: FormData,
): Promise<{ error?: string }> {
  const { db, user } = await authed();
  if (!/^[\w-]{8,64}$/.test(batchId)) return { error: 'invalid_input' };
  const file = formData.get('file');
  if (!(file instanceof File)) return { error: 'invalid_input' };
  if (!TYPES.test(file.name)) return { error: 'uploadType' };
  if (file.size > UPLOAD_MAX_BYTES) return { error: 'uploadTooBig' };
  const batches = await uploadBatchesOf(db, user.id, 1);
  const current = batches.find((b) => b.batchId === batchId);
  if (current && current.files.length >= UPLOAD_MAX_FILES) return { error: 'uploadTooMany' };
  await addUpload(db, user.id, batchId, {
    name: file.name.slice(0, 120),
    data: Buffer.from(await file.arrayBuffer()),
  });
  return {};
}

/**
 * The batch is complete. With a Claude API key the app reads it right after answering;
 * otherwise it waits for the home PC's next run.
 */
export async function finishUploadsAction(batchId: string): Promise<{ readNow: boolean }> {
  const { db, user } = await authed();
  const files = await finishUploadBatch(db, user.id, batchId);
  const readNow = files > 0 && claudeApiAvailable();
  if (readNow) {
    after(async () => {
      await readUploadBatch(db, batchId, askClaudeApi);
      revalidatePath('/', 'layout');
    });
  }
  revalidatePath('/imports');
  return { readNow };
}

export async function retryUploadsAction(batchId: string) {
  const { db, user } = await authed();
  await retryUploadBatch(db, user.id, batchId);
  if (claudeApiAvailable()) {
    after(async () => {
      await readUploadBatch(db, batchId, askClaudeApi);
      revalidatePath('/', 'layout');
    });
  }
  revalidatePath('/imports');
}
