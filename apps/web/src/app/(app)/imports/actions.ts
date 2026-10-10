'use server';

import { type CardGrade, GRADERS, RAW_GRADES, parseGrade } from '@tora/core';
import { type ImportReview, confirmImportReview } from '@tora/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { authed } from '@/lib/auth/guard';
import { type FormState, runDomain } from '@/lib/form';

export type ReviewState = FormState & { done?: number };

const rowSchema = z.object({
  id: z.string().min(1).max(64),
  cls: z.enum(['card', 'sealed', 'item']),
  gradeType: z.enum(['', 'raw', ...GRADERS]),
  rawGrade: z.enum(RAW_GRADES).optional(),
  grade: z.string().max(10).optional(),
  certNumber: z.string().max(40).optional(),
  packagingState: z.enum(['sealed_shrink', 'sealed_no_shrink']).optional(),
});
export type ReviewRow = z.infer<typeof rowSchema>;
const payloadSchema = z.array(rowSchema).max(1000);

/** Null when no grade was picked; throws on an unreadable one. */
function gradeOf(row: ReviewRow): CardGrade | null {
  if (row.gradeType === '') return null;
  if (row.gradeType === 'raw') {
    if (!row.rawGrade) throw new Error('grade');
    return { grading: 'raw', rawGrade: row.rawGrade };
  }
  const text = row.grade?.trim() ?? '';
  if (row.gradeType === 'other') {
    if (!text) throw new Error('grade');
    return { grading: 'graded', grader: 'other', grade: text };
  }
  const read = parseGrade(`${row.gradeType}${text}`);
  if (read?.grading !== 'graded') throw new Error('grade');
  return read;
}

/**
 * "save" confirms the rows that are complete (cards with a grade, every sealed item) and keeps
 * cards without a grade for later; "all" confirms everything shown.
 */
export async function confirmReviewAction(
  _: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  const { db, user } = await authed();
  let rows: ReviewRow[];
  try {
    rows = payloadSchema.parse(JSON.parse(String(formData.get('payload') ?? '[]')));
  } catch {
    return { error: 'check' };
  }
  const all = formData.get('mode') === 'all';
  const reviews: ImportReview[] = [];
  for (const row of rows) {
    let grade: CardGrade | null;
    try {
      grade = gradeOf(row);
    } catch {
      return { error: 'check', fields: ['grade'] };
    }
    if (row.cls === 'card' && !grade && !all) continue;
    reviews.push({
      id: row.id,
      grade: row.cls === 'card' ? grade : null,
      certNumber: grade?.grading === 'graded' ? row.certNumber : null,
      packagingState: row.cls === 'sealed' ? (row.packagingState ?? null) : null,
    });
  }
  if (reviews.length === 0) return { error: 'noneGraded' };
  const result = await runDomain(() => confirmImportReview(db, user.id, reviews));
  if (!result.ok) return result.state;
  revalidatePath('/', 'layout');
  return { done: result.value };
}
