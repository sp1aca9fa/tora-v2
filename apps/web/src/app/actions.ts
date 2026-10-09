'use server';

import { revokeDevice } from '@tora/db';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { LOCALE_COOKIE, isLocale } from '@/i18n/locale';
import { currentSession } from '@/lib/auth/guard';
import { SESSION_COOKIE } from '@/lib/auth/session';

export async function setLocale(formData: FormData) {
  const locale = formData.get('locale');
  if (!isLocale(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: 365 * 24 * 60 * 60,
    sameSite: 'lax',
  });
}

/** Signing out frees this device's login slot. */
export async function logout() {
  const session = await currentSession();
  if (session) await revokeDevice(session.db, session.user.id, session.device.id);
  (await cookies()).delete(SESSION_COOKIE);
  redirect('/login');
}

export async function revokeDeviceAction(deviceId: string) {
  const session = await currentSession();
  if (!session) redirect('/login');
  if (deviceId === session.device.id) return logout();
  await revokeDevice(session.db, session.user.id, deviceId);
  revalidatePath('/settings');
}
