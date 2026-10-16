import 'server-only';
import { type AlertContext, type AlertTexts, setAppUrl, type Db } from '@tora/db';
import { headers } from 'next/headers';
import { isLocale } from '@/i18n/locale';

/** What sending needs on the app (S17): the secret and the `alertText` messages. */
export function alertContext(): AlertContext | null {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret) return null;
  return {
    secret,
    texts: async (locale) =>
      isLocale(locale)
        ? (((await import(`../../messages/${locale}.json`)).default as { alertText?: AlertTexts })
            .alertText ?? {})
        : {},
    log: console.log,
  };
}

/** Remembers the app's address for links in messages (the home PC does not know it). */
export async function rememberAppUrl(db: Db): Promise<void> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  if (!host || /^(localhost|127\.|\[::1\])/.test(host)) return;
  await setAppUrl(db, `${h.get('x-forwarded-proto') ?? 'https'}://${host}`);
}

/**
 * When the morning check runs, in UTC: keep it equal to the `crons` schedule in vercel.json
 * ("0 23 * * *" is 08:00 in Japan). Vercel's free plan runs it once a day, within the hour.
 */
export const MORNING_CHECK_UTC_HOUR = 23;
