'use server';

import {
  NOTICE_LEVELS,
  NOTICE_TYPES,
  type NoticeLevel,
  type NoticeLevels,
  type ProductClass,
  ROTATE_SECONDS,
  SOURCE_ROLES,
  type SourceRole,
  SUMMARY_PANELS,
  type SummaryPanel,
} from '@tora/core';
import {
  clearAllBucketValues,
  refreshBucketValues,
  runSnapshots,
  loadSourceRegistry,
  setNoticeLevels,
  setPreferences,
  setSourceRoles,
} from '@tora/db';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { cookies } from 'next/headers';
import { AMOUNTS_COOKIE } from '@/lib/amounts';
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

/**
 * Amounts at the start of a session: hidden (default) or always shown. This session's eye
 * button choice is dropped so the setting shows at once.
 */
export async function setAmountsVisibleAction(visible: boolean) {
  const { db, user } = await authed();
  await setPreferences(db, user.id, { amountsVisible: visible });
  (await cookies()).delete(AMOUNTS_COOKIE);
  revalidatePath('/', 'layout');
}

/**
 * A source's role for one item class (admins; the whole deployment): values, the value-over-time
 * history and the main-source notices follow it.
 */
export async function setSourceRoleAction(key: string, cls: ProductClass, role: SourceRole) {
  const { db, user } = await authed();
  if (user.role !== 'admin' || !(SOURCE_ROLES as readonly string[]).includes(role)) return;
  const registry = await loadSourceRegistry(db);
  if (!registry.sources.some((s) => s.key === key)) return;
  await setSourceRoles(db, key, { ...(registry.declared ?? registry.roles)[key], [cls]: role });
  await clearAllBucketValues(db);
  // The value-over-time history follows too (about 10 s), right after answering.
  after(async () => {
    await runSnapshots(db);
    await refreshBucketValues(db);
    revalidatePath('/', 'layout');
  });
  revalidatePath('/', 'layout');
}
