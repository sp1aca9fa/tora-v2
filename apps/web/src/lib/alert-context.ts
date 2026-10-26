// Kept apart from alerts.ts (server-only, request headers) so the server's start-up hook
// (instrumentation.ts) can send alerts too.
import type { AlertContext, AlertTexts } from '@tora/db';
import { isLocale } from '@/i18n/locale';
import { loadMessages } from '@/i18n/messages';

/** What sending needs on the app (S17): the secret and the `alertText` messages. */
export function alertContext(): AlertContext | null {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret) return null;
  return {
    secret,
    texts: async (locale) =>
      isLocale(locale)
        ? (((await loadMessages(locale)) as { alertText?: AlertTexts }).alertText ?? {})
        : {},
    log: console.log,
  };
}
