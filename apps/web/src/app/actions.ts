'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { LOCALE_COOKIE, isLocale } from '@/i18n/locale';
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

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect('/login');
}
