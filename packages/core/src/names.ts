/** A language of the app (BCP 47 tag of a translation file: "en", "ja", "fr"). */
export type Locale = string;

/**
 * The app's languages (requirements S16), set by the admin from the installed translation files:
 * the primary one is shown to whoever has not chosen; each user toggles between the two.
 */
export interface LanguageSettings {
  primary: Locale;
  /** Null: one language only, no toggle. */
  secondary: Locale | null;
}

/** Languages of a setup that never chose any (Tora started with these two). */
export const DEFAULT_LANGUAGES: LanguageSettings = { primary: 'en', secondary: 'ja' };

/** The saved languages kept to the installed ones, with what is not set filled in. */
export function resolveLanguages(
  saved: Partial<LanguageSettings> | null | undefined,
  installed: readonly string[],
): LanguageSettings {
  const primary =
    saved?.primary && installed.includes(saved.primary) ? saved.primary : DEFAULT_LANGUAGES.primary;
  const wanted = saved ? (saved.secondary ?? null) : DEFAULT_LANGUAGES.secondary;
  const secondary = wanted && wanted !== primary && installed.includes(wanted) ? wanted : null;
  return { primary, secondary };
}

/** The language a request is shown in: the user's choice when it is one of the two, else the primary. */
export function pickLocale(choice: string | null | undefined, languages: LanguageSettings): Locale {
  return choice && (choice === languages.primary || choice === languages.secondary)
    ? choice
    : languages.primary;
}

/** Product display name. Products have one name (in the language they are sold under). */
export function displayName(product: { name?: string | null }): string {
  return product.name?.trim() ?? '';
}
