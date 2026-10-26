import { type LanguageSettings, type Locale, resolveLanguages } from '@tora/core';

/**
 * Installed languages (requirements S16): every translation file in messages/ (`{code}.json`),
 * found when the app is built (next.config.ts), with the language toggle's short label. Adding a
 * language is adding its file; texts it lacks show in English (`pnpm languages` lists them).
 */
export const LANGUAGES: Record<Locale, { short: string }> = Object.fromEntries(
  Object.entries(
    JSON.parse(process.env.TORA_LANGUAGES ?? '{"en":"EN"}') as Record<string, string>,
  ).map(([code, short]) => [code, { short }]),
);
export const LOCALES = Object.keys(LANGUAGES);
export const LOCALE_COOKIE = 'locale';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && LOCALES.includes(value);
}

/** The admin's languages (saved in app_settings) kept to the installed ones. */
export const appLanguages = (saved: Partial<LanguageSettings> | null | undefined) =>
  resolveLanguages(saved, LOCALES);

/** A language's own name ("日本語"), else its code. */
export function nativeName(code: Locale): string {
  try {
    return new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}
