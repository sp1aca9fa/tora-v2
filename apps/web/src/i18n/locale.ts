import type { Locale } from '@tora/core';

export const LOCALES = ['en', 'ja'] as const satisfies readonly Locale[];
export const LOCALE_COOKIE = 'locale';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** Cookie choice first, then the browser's Accept-Language, then English. */
export function resolveLocale(cookie: string | undefined, acceptLanguage: string | null): Locale {
  if (isLocale(cookie)) return cookie;
  return acceptLanguage?.toLowerCase().startsWith('ja') ? 'ja' : 'en';
}
