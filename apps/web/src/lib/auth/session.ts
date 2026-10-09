import { SignJWT, jwtVerify } from 'jose';
import { createHash } from 'node:crypto';

export const SESSION_COOKIE = 'tora_session';
export const SESSION_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;
const MIN_SECRET_LENGTH = 32;

export interface AuthConfig {
  secret: string;
  passwordHash: string;
}

/** Null when auth is not configured; callers must then deny access (fail closed). */
export function authConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): AuthConfig | null {
  const secret = env.AUTH_SECRET?.trim();
  const passwordHash = env.AUTH_PASSWORD_HASH?.trim();
  if (!secret || secret.length < MIN_SECRET_LENGTH || !passwordHash) return null;
  return { secret, passwordHash };
}

/**
 * Ties sessions to the current password: changing the password (or the secret) invalidates
 * every existing session.
 */
function passwordFingerprint(passwordHash: string): string {
  return createHash('sha256').update(passwordHash).digest('base64url').slice(0, 16);
}

const key = (secret: string) => new TextEncoder().encode(secret);

export async function createSessionToken(config: AuthConfig, now = new Date()): Promise<string> {
  return new SignJWT({ pwd: passwordFingerprint(config.passwordHash) })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(Math.floor(now.getTime() / 1000))
    .setExpirationTime(Math.floor(now.getTime() / 1000) + SESSION_MAX_AGE_SECONDS)
    .sign(key(config.secret));
}

export async function verifySessionToken(
  token: string | undefined,
  config: AuthConfig | null,
): Promise<boolean> {
  if (!token || !config) return false;
  try {
    const { payload } = await jwtVerify(token, key(config.secret), { algorithms: ['HS256'] });
    return payload.pwd === passwordFingerprint(config.passwordHash);
  } catch {
    return false;
  }
}

/** Only same-origin relative paths, to avoid open redirects after login. */
export function safeNextPath(next: unknown): string {
  if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//')) return '/';
  if (next.startsWith('/\\') || next.startsWith('/login')) return '/';
  return next;
}
