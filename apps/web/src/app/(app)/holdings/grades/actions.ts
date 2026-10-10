'use server';

import { type CardGrade, GRADERS, RAW_GRADES, parseGrade } from '@tora/core';
import { setCardGrade } from '@tora/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { authed } from '@/lib/auth/guard';
import { type FormState, optEnum, optText, parseForm, reqEnum, runDomain } from '@/lib/form';

export type GradesState = FormState & { done?: number };

const schema = z.object({
  grading: reqEnum(['raw', 'graded']),
  rawGrade: optEnum(RAW_GRADES),
  grader: optEnum(GRADERS),
  grade: optText,
});

/** Sets one grade on the ticked cards. */
export async function setGradesAction(_: GradesState, formData: FormData): Promise<GradesState> {
  const { db, user } = await authed();
  const ids = formData.getAll('ids').filter((v): v is string => typeof v === 'string');
  if (ids.length === 0) return { error: 'noneSelected' };
  const parsed = parseForm(schema, formData);
  if ('state' in parsed) return parsed.state;
  const d = parsed.data;
  let grade: CardGrade | null = null;
  if (d.grading === 'raw') {
    grade = d.rawGrade ? { grading: 'raw', rawGrade: d.rawGrade } : null;
  } else if (d.grader && d.grade) {
    // "other" graders keep the typed grade; known graders go through the shared parser.
    const read = d.grader === 'other' ? null : parseGrade(`${d.grader}${d.grade}`);
    grade =
      d.grader === 'other'
        ? { grading: 'graded', grader: 'other', grade: d.grade }
        : read?.grading === 'graded'
          ? read
          : null;
  }
  if (!grade) return { error: 'check', fields: [d.grading === 'raw' ? 'rawGrade' : 'grade'] };
  const result = await runDomain(() => setCardGrade(db, user.id, ids, grade));
  if (!result.ok) return result.state;
  revalidatePath('/', 'layout');
  return { done: result.value };
}
