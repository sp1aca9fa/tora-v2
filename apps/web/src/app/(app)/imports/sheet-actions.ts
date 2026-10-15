'use server';

import { decodeText, parseCsv } from '@tora/core';
import { type SheetEntry, applySheet, planSheet, readSheet } from '@tora/db';
import { revalidatePath } from 'next/cache';
import { authed } from '@/lib/auth/guard';
import { sheetReader } from '@/lib/lot-sheet';

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_ROWS = 5000;

export type SheetError = 'sheetType' | 'sheetTooBig' | 'sheetNoHeader' | 'sheetTooManyRows';

/** One row of the preview, for the browser. */
export interface SheetPreviewRow {
  line: number;
  item: string;
  type: SheetEntry['type'];
  error?: string;
  quantity?: number;
  costBase?: number;
  acquired?: string;
  newItem?: boolean;
}

type Plan =
  | { error: SheetError }
  | {
      db: Awaited<ReturnType<typeof authed>>['db'];
      userId: string;
      name: string;
      ignored: string[];
      entries: SheetEntry[];
    };

async function plan(formData: FormData): Promise<Plan> {
  const { db, user } = await authed();
  const file = formData.get('file');
  if (!(file instanceof File) || !/\.(csv|txt)$/i.test(file.name)) {
    return { error: 'sheetType' };
  }
  if (file.size > MAX_BYTES) return { error: 'sheetTooBig' };
  const { column, keyOf } = await sheetReader();
  const read = readSheet(parseCsv(decodeText(new Uint8Array(await file.arrayBuffer()))), column);
  if (!read) return { error: 'sheetNoHeader' };
  if (read.rows.length > MAX_ROWS) return { error: 'sheetTooManyRows' };
  return {
    db,
    userId: user.id,
    name: file.name,
    ignored: read.ignored,
    entries: await planSheet(db, user.id, read, keyOf),
  };
}

/** What importing the file would do, row by row (nothing is written). */
export async function previewSheetAction(
  formData: FormData,
): Promise<{ error: SheetError } | { rows: SheetPreviewRow[]; ignored: string[] }> {
  const p = await plan(formData);
  if ('error' in p) return { error: p.error };
  return {
    ignored: p.ignored,
    rows: p.entries.map((e) => ({
      line: e.line,
      item: e.item,
      type: e.type,
      ...(e.type === 'error' && { error: e.error }),
      ...(e.type === 'new' && {
        quantity: e.quantity,
        costBase: e.costBase,
        acquired: e.acquired,
        newItem: e.newItem,
      }),
    })),
  };
}

/** Adds the file's new rows as lots waiting in Review (the file is read again). */
export async function importSheetAction(
  formData: FormData,
): Promise<{ error: SheetError } | { runId: string; imported: number }> {
  const p = await plan(formData);
  if ('error' in p) return { error: p.error };
  const { runId, counts } = await applySheet(p.db, p.userId, p.entries, p.name);
  revalidatePath('/', 'layout');
  return { runId, imported: counts.imported ?? 0 };
}
