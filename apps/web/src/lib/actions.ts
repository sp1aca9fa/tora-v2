import 'server-only';
import { pendingActions } from '@tora/db';
import { cache } from 'react';
import { authed } from '@/lib/auth/guard';

/** The user's pending actions, loaded once per request (nav badge, portfolio line, Actions). */
export const userActions = cache(async () => {
  const { db, user } = await authed();
  return pendingActions(db, user.id, user.noticeLevels);
});
