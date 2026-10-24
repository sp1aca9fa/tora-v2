'use server';

import { createStatusToken, recordAdminChange, removeStatusToken } from '@tora/db';
import { revalidatePath } from 'next/cache';
import { authed } from '@/lib/auth/guard';
import { authConfigFromEnv } from '@/lib/auth/session';

/** A new read-only status token (admins): returned once, the old one stops working. */
export async function createStatusTokenAction(): Promise<string | null> {
  const { db, user } = await authed();
  const config = authConfigFromEnv();
  if (user.role !== 'admin' || !config) return null;
  const token = await createStatusToken(db, config.secret);
  await recordAdminChange(db, user.id, 'statusTokenNew', {}, '/settings/admin/server');
  revalidatePath('/settings/admin/server');
  return token;
}

export async function removeStatusTokenAction() {
  const { db, user } = await authed();
  if (user.role !== 'admin') return;
  await removeStatusToken(db);
  await recordAdminChange(db, user.id, 'statusTokenRemoved', {}, '/settings/admin/server');
  revalidatePath('/settings/admin/server');
}
