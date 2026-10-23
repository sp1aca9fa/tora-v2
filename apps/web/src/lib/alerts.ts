import 'server-only';
import { setAppUrl, type Db } from '@tora/db';
import { headers } from 'next/headers';

export { alertContext } from './alert-context';

/** The address last saved by this server process (saved again only when it changes). */
let remembered: string | null = null;

/**
 * Remembers the app's address for links in messages (scripts and the server's own checks do not
 * know it): the public https address people sign in through (a hosting platform's, a Funnel's),
 * not a local or network address.
 */
export async function rememberAppUrl(db: Db): Promise<void> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  const proto = h.get('x-forwarded-proto');
  // Without a proxy's word, a domain name with no port (not an IP or a machine name).
  const named = !!host && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host) && !/^[\d.]+$/.test(host);
  if (!host || /^(localhost|127\.|\[::1\])/.test(host) || !(proto ? proto === 'https' : named))
    return;
  const url = `https://${host}`;
  if (url === remembered) return;
  await setAppUrl(db, url);
  remembered = url;
}

/**
 * When the morning check runs on a hosting platform, in UTC: keep it equal to the `crons`
 * schedule in vercel.json ("0 23 * * *" is 08:00 in Japan); its free plan runs it once a day,
 * within the hour. A self-hosted server runs it itself (instrumentation.ts).
 */
export const MORNING_CHECK_UTC_HOUR = 23;
