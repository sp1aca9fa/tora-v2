import { type LanguageSettings, type Locale, resolveLanguages } from '@tora/core';

/**
 * Installed languages (requirements S16): one translation file each in messages/ (`{code}.json`),
 * with the short label of the language toggle. Adding a language: translate en.json into a new
 * file, add a line here, check it with `pnpm --filter web test` (missing texts fail).
 */
export const LANGUAGES: Record<Locale, { short: string }> = {
  en: { short: 'EN' },
  ja: { short: 'JP' },
};
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
