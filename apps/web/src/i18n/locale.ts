import type { Locale } from '@tora/core';

export const LOCALES = ['en', 'ja'] as const satisfies readonly Locale[];
export const LOCALE_COOKIE = 'locale';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

export const DEFAULT_LOCALE: Locale = 'en';

/** The cookie choice, else English (the browser language is deliberately ignored). */
export function resolveLocale(cookie: string | undefined): Locale {
  return isLocale(cookie) ? cookie : DEFAULT_LOCALE;
}
