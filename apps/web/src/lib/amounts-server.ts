import 'server-only';
import { cookies } from 'next/headers';
import { type AmountsMode, AMOUNTS_COOKIE } from './amounts';
import { currentSession } from './auth/guard';

/** Hidden or shown for this request: the session's choice, else the user's setting. */
export async function amountsMode(): Promise<AmountsMode> {
  const chosen = (await cookies()).get(AMOUNTS_COOKIE)?.value;
  if (chosen === 'hidden' || chosen === 'shown') return chosen;
  const session = await currentSession();
  return session?.user.preferences?.amountsVisible ? 'shown' : 'hidden';
}
