'use server';

import { getDb } from '@tora/db';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { hashIp, isLockedOut, recordAttempt } from '@/lib/auth/lockout';
import { verifyPassword } from '@/lib/auth/password';
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  authConfigFromEnv,
  createSessionToken,
  safeNextPath,
} from '@/lib/auth/session';

export type LoginState = { error?: 'invalid' | 'locked' | 'notConfigured' };

async function clientIp(): Promise<string> {
  const h = await headers();
  // On Vercel, x-real-ip / x-forwarded-for are set by the platform edge.
  return h.get('x-real-ip') ?? h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const config = authConfigFromEnv();
  if (!config) return { error: 'notConfigured' };

  const db = getDb();
  const ipHash = hashIp(await clientIp(), config.secret);
  if (await isLockedOut(db, ipHash)) return { error: 'locked' };

  const password = formData.get('password');
  const ok = typeof password === 'string' && (await verifyPassword(password, config.passwordHash));
  await recordAttempt(db, ipHash, ok);
  if (!ok) return { error: 'invalid' };

  (await cookies()).set(SESSION_COOKIE, await createSessionToken(config), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  redirect(safeNextPath(formData.get('next')));
}
