// Reading files uploaded in the app (requirements S8 step 5): the same import through Claude as
// `pnpm import-ai`, for one batch of uploads, by the app (Claude API) or the home PC (`claude -p`).
// Everything read lands in Imports > Review, as with the command.
import { type Db, claimUploadBatch, finishUploadRead, waitingUploadBatches } from '@tora/db';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type AskClaude, checkContext, fileHash, readPurchases } from './ai-import';
import { applyAiImport, planAiImport } from './ai-import-plan';

/** A file name safe on disk, unique in the batch ("03-IMG_1234.png"). */
const safeName = (name: string, i: number) =>
  `${String(i + 1).padStart(2, '0')}-${name.replace(/[^\w.\-()぀-ヿ一-鿿]+/g, '_').slice(-80)}`;

/**
 * Reads one batch of uploaded files and imports what it finds into the review. Returns null when
 * the batch was not waiting (someone else is reading it).
 */
export async function readUploadBatch(
  db: Db,
  batchId: string,
  ask: AskClaude,
  log: (m: string) => void = () => {},
): Promise<{ status: 'done' | 'failed'; message: string } | null> {
  const files = await claimUploadBatch(db, batchId);
  if (!files) return null;
  const userId = files[0]!.userId;
  const dir = await mkdtemp(join(tmpdir(), 'tora-upload-'));
  try {
    const names: { name: string; hash: string }[] = [];
    for (const [i, f] of files.entries()) {
      const name = safeName(f.name, i);
      const data = Buffer.from(f.data, 'base64');
      await writeFile(join(dir, name), data);
      names.push({ name, hash: fileHash(data) });
    }
    const ctx = await checkContext(db, userId);
    const read = await readPurchases(ctx, dir, names, ask, { log });
    // No date at all: the day it was uploaded, checked in review.
    const plan = await planAiImport(db, userId, read, ctx.products, () => files[0]!.createdAt);
    const outcome = await applyAiImport(
      db,
      userId,
      plan,
      `Uploaded in the app: ${files.length} file(s) read. Cost $${read.costUsd.toFixed(3)}.`,
    );
    const message = Object.entries(outcome.counts)
      .map(([k, n]) => `${n} ${k}`)
      .join(', ');
    await finishUploadRead(db, batchId, {
      status: 'done',
      message: message || 'nothing to import',
      importRunId: outcome.runId,
    });
    return { status: 'done', message };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishUploadRead(db, batchId, { status: 'failed', message: message.slice(0, 500) });
    log(`upload ${batchId} failed: ${message}`);
    return { status: 'failed', message };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Reads every waiting batch (the home PC's run; or one user's in the app). */
export async function readWaitingUploads(
  db: Db,
  ask: AskClaude,
  options: { userId?: string; log?: (m: string) => void } = {},
): Promise<number> {
  let read = 0;
  for (const { batchId } of await waitingUploadBatches(db, options.userId)) {
    if (await readUploadBatch(db, batchId, ask, options.log)) read++;
  }
  return read;
}
