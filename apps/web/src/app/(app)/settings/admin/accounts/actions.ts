'use server';

import { normalizeUsername } from '@tora/auth';
import {
  type AccountSetupKind,
  type Db,
  cancelSetup,
  createPendingUser,
  getUserById,
  getUserByUsername,
  makeSetupLink,
  recordAdminChange,
  requestCollect,
  revokeAllDevices,
  revokeDevice,
  setUserDisabled,
} from '@tora/db';
import { revalidatePath } from 'next/cache';
import { appOrigin, checkAdminCode } from '@/lib/auth/admin-code';
import { authed } from '@/lib/auth/guard';

export interface AccountTaskState {
  error?: 'invalid' | 'locked' | 'notConfigured' | 'username' | 'taken' | 'self' | 'missing';
  /** A setup link, shown once. */
  link?: string;
  expiresAt?: string;
}

const PAGE = '/settings/admin/accounts';

/** An admin's session, and their code checked when the task is a risky one. */
async function admin(code?: string) {
  const session = await authed();
  if (session.user.role !== 'admin') return { error: 'missing' as const };
  if (code !== undefined) {
    const check = await checkAdminCode(session, code);
    if (check !== 'ok') return { error: check };
  }
  return { session };
}

async function linkFor(db: Db, userId: string, kind: AccountSetupKind, by: string) {
  const { token, expiresAt } = await makeSetupLink(db, userId, kind, by);
  return { link: `${await appOrigin()}/login/setup/${token}`, expiresAt };
}

/** A new account, set up by its person through a link (S21). */
export async function createAccountAction(input: {
  username: string;
  admin: boolean;
  code: string;
}): Promise<AccountTaskState> {
  const username = normalizeUsername(input.username);
  if (!username) return { error: 'username' };
  const { session, error } = await admin(input.code);
  if (!session) return { error };
  const { db, user: me } = session;
  if (await getUserByUsername(db, username)) return { error: 'taken' };
  const role = input.admin ? 'admin' : 'member';
  const user = await createPendingUser(db, username, role);
  const link = await linkFor(db, user.id, 'both', me.id);
  await recordAdminChange(db, me.id, 'userCreated', { user: username, role }, PAGE);
  revalidatePath(PAGE);
  return link;
}

/** A link with which a person sets a new password, authenticator, or both. */
export async function setupLinkAction(input: {
  userId: string;
  kind: AccountSetupKind;
  code: string;
}): Promise<AccountTaskState> {
  if (!['both', 'password', '2fa'].includes(input.kind)) return { error: 'missing' };
  const { session, error } = await admin(input.code);
  if (!session) return { error };
  const user = await getUserById(session.db, input.userId);
  if (!user) return { error: 'missing' };
  const link = await linkFor(session.db, user.id, input.kind, session.user.id);
  await recordAdminChange(
    session.db,
    session.user.id,
    'userSetupLink',
    { user: user.username, setup: input.kind },
    PAGE,
  );
  revalidatePath(PAGE);
  return link;
}

/** Stops a waiting link. */
export async function cancelSetupAction(userId: string): Promise<AccountTaskState> {
  const { session, error } = await admin();
  if (!session) return { error };
  const user = await getUserById(session.db, userId);
  if (!user) return { error: 'missing' };
  await cancelSetup(session.db, userId);
  await recordAdminChange(session.db, session.user.id, 'userSetupCancel', { user: user.username });
  revalidatePath(PAGE);
  return {};
}

/** Signs a person out of one device, or all of them. */
export async function revokeDeviceAdminAction(
  userId: string,
  deviceId: string | 'all',
): Promise<AccountTaskState> {
  const { session, error } = await admin();
  if (!session) return { error };
  const { db, user: me } = session;
  const user = await getUserById(db, userId);
  if (!user) return { error: 'missing' };
  const count =
    deviceId === 'all'
      ? await revokeAllDevices(db, userId)
      : Number(await revokeDevice(db, userId, deviceId));
  if (count)
    await recordAdminChange(db, me.id, 'userDevices', { user: user.username, count }, PAGE);
  revalidatePath(PAGE);
  return {};
}

/** Disables (and signs out) or enables an account; never one's own. */
export async function setDisabledAction(input: {
  userId: string;
  disabled: boolean;
  code: string;
}): Promise<AccountTaskState> {
  const { session, error } = await admin(input.code);
  if (!session) return { error };
  const { db, user: me } = session;
  if (input.userId === me.id) return { error: 'self' };
  const user = await getUserById(db, input.userId);
  if (!user) return { error: 'missing' };
  await setUserDisabled(db, user.id, input.disabled);
  await recordAdminChange(
    db,
    me.id,
    input.disabled ? 'userDisabled' : 'userEnabled',
    { user: user.username },
    PAGE,
  );
  revalidatePath(PAGE);
  return {};
}

/** "Collect now": the home PC takes it on its hourly check (S21). */
export async function requestCollectAction(): Promise<AccountTaskState> {
  const { session, error } = await admin();
  if (!session) return { error };
  await requestCollect(session.db, session.user.id);
  await recordAdminChange(
    session.db,
    session.user.id,
    'collectRequested',
    {},
    '/settings/collectors',
  );
  revalidatePath('/settings/collectors');
  return {};
}
