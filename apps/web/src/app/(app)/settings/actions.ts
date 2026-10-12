'use server';

import {
  NOTICE_LEVELS,
  NOTICE_TYPES,
  type NoticeLevel,
  type NoticeLevels,
  ROTATE_SECONDS,
  SUMMARY_PANELS,
  type SummaryPanel,
} from '@tora/core';
import { setNoticeLevels, setPreferences } from '@tora/db';
import { revalidatePath } from 'next/cache';
import { authed } from '@/lib/auth/guard';

export type NoticeLevelsState = { saved?: boolean };

/** Saves the level picked for each notice type (Settings). */
export async function saveNoticeLevelsAction(
  _prev: NoticeLevelsState,
  formData: FormData,
): Promise<NoticeLevelsState> {
  const { db, user } = await authed();
  const chosen: NoticeLevels = {};
  for (const type of NOTICE_TYPES) {
    const level = String(formData.get(type) ?? '');
    if ((NOTICE_LEVELS as readonly string[]).includes(level)) chosen[type] = level as NoticeLevel;
  }
  await setNoticeLevels(db, user.id, chosen);
  revalidatePath('/', 'layout');
  return { saved: true };
}

export async function resetNoticeLevelsAction() {
  const { db, user } = await authed();
  await setNoticeLevels(db, user.id, null);
  revalidatePath('/', 'layout');
}

export type SummaryPrefsState = { saved?: boolean; error?: string };

/** The Portfolio Summary's insights card: rotation, its speed, and which panels (Settings). */
export async function saveSummaryPrefsAction(
  _prev: SummaryPrefsState,
  formData: FormData,
): Promise<SummaryPrefsState> {
  const { db, user } = await authed();
  const panels = SUMMARY_PANELS.filter((p) => formData.getAll('panels').includes(p));
  if (panels.length === 0) return { error: 'nonePicked' };
  const seconds = Number(formData.get('seconds'));
  await setPreferences(db, user.id, {
    summary: {
      rotate: formData.get('rotate') === 'on',
      seconds: (ROTATE_SECONDS as readonly number[]).includes(seconds) ? seconds : 8,
      panels: panels as SummaryPanel[],
    },
  });
  revalidatePath('/', 'layout');
  return { saved: true };
}
