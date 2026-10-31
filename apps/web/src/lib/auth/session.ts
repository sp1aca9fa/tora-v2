import { sha256 } from '@tora/auth';
import { SignJWT, jwtVerify } from 'jose';

export const SESSION_COOKIE = 'tora_session';
export const MFA_COOKIE = 'tora_mfa';
/** Browsers cap cookie lifetime at ~400 days; the proxy renews the cookie on use. */
export const SESSION_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;
export const SESSION_RENEW_AFTER_SECONDS = 24 * 60 * 60;
export const MFA_MAX_AGE_SECONDS = 10 * 60;
const MIN_SECRET_LENGTH = 32;

export interface AuthConfig {
  secret: string;
}

/** Null when auth is not configured; callers must then deny access (fail closed). */
export function authConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): AuthConfig | null {
  const secret = env.AUTH_SECRET?.trim();
  return secret && secret.length >= MIN_SECRET_LENGTH ? { secret } : null;
}

/**
 * Ties sessions to the current credentials: a password change or 2FA reset invalidates every
 * existing session even before the devices are revoked.
 */
export function credentialFingerprint(user: {
  passwordHash: string | null;
  totpSecretEnc: string | null;
}): string {
  return sha256(`${user.passwordHash ?? ''}|${user.totpSecretEnc ?? ''}`).slice(0, 16);
}

export interface SessionClaims {
  userId: string;
  deviceId: string;
  fingerprint: string;
  issuedAt: number;
}

const key = (secret: string) => new TextEncoder().encode(secret);
const seconds = (d: Date) => Math.floor(d.getTime() / 1000);

export async function createSessionToken(
  config: AuthConfig,
  claims: Omit<SessionClaims, 'issuedAt'>,
  now = new Date(),
): Promise<string> {
  return new SignJWT({ dev: claims.deviceId, fp: claims.fingerprint })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.userId)
    .setAudience('session')
    .setIssuedAt(seconds(now))
    .setExpirationTime(seconds(now) + SESSION_MAX_AGE_SECONDS)
    .sign(key(config.secret));
}

/** Signature and expiry only; the device / user checks happen in `currentSession`. */
export async function verifySessionToken(
  token: string | undefined,
  config: AuthConfig | null,
): Promise<SessionClaims | null> {
  if (!token || !config) return null;
  try {
    const { payload } = await jwtVerify(token, key(config.secret), {
      algorithms: ['HS256'],
      audience: 'session',
    });
    if (!payload.sub || typeof payload.dev !== 'string' || typeof payload.fp !== 'string') {
      return null;
    }
    return {
      userId: payload.sub,
      deviceId: payload.dev,
      fingerprint: payload.fp,
      issuedAt: payload.iat ?? 0,
    };
  } catch {
    return null;
  }
}

/**
 * Short-lived proof that step 1 (password) succeeded, for the authenticator step. It carries the
 * credentials' fingerprint, as the session does: after a password change or 2FA reset a step 1
 * done before it no longer opens step 2.
 */
export async function createMfaToken(
  config: AuthConfig,
  userId: string,
  fingerprint: string,
  now = new Date(),
) {
  return new SignJWT({ fp: fingerprint })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setAudience('mfa')
    .setIssuedAt(seconds(now))
    .setExpirationTime(seconds(now) + MFA_MAX_AGE_SECONDS)
    .sign(key(config.secret));
}

export async function verifyMfaToken(
  token: string | undefined,
  config: AuthConfig | null,
): Promise<{ userId: string; fingerprint: string } | null> {
  if (!token || !config) return null;
  try {
    const { payload } = await jwtVerify(token, key(config.secret), {
      algorithms: ['HS256'],
      audience: 'mfa',
    });
    if (!payload.sub || typeof payload.fp !== 'string') return null;
    return { userId: payload.sub, fingerprint: payload.fp };
  } catch {
    return null;
  }
}

export function sessionCookieOptions(maxAge = SESSION_MAX_AGE_SECONDS) {
  return {
    httpOnly: true,
    // TORA_LOCAL_HTTP=1: the app run on the home PC and opened over plain http from the home
    // network (a phone cannot keep a secure cookie there).
    secure: process.env.NODE_ENV === 'production' && process.env.TORA_LOCAL_HTTP !== '1',
    sameSite: 'lax' as const,
    path: '/',
    maxAge,
  };
}

/**
 * Only same-origin relative paths, to avoid open redirects after login. Browsers drop tabs and
 * newlines from a URL and read a backslash as a slash, so `/<tab>/evil.com` or `/\evil.com`
 * would leave the site: any control character or backslash gives the home page.
 */
export function safeNextPath(next: unknown): string {
  if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//')) return '/';
  if (next.startsWith('/login')) return '/';
  for (const c of next) {
    if (c <= '\u001f' || c === '\u007f' || c === '\\') return '/';
  }
  return next;
}

/** Short device description from the User-Agent, e.g. "iPhone · Safari". */
export function deviceLabel(userAgent: string | null): string {
  const ua = userAgent ?? '';
  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Mac OS X|Macintosh/.test(ua)
            ? 'Mac'
            : /Linux/.test(ua)
              ? 'Linux'
              : 'Unknown device';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /CriOS|Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : null;
  return browser ? `${os} · ${browser}` : os;
}
