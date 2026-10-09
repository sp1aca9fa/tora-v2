import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password';
import {
  type AuthConfig,
  SESSION_MAX_AGE_SECONDS,
  authConfigFromEnv,
  createSessionToken,
  safeNextPath,
  verifySessionToken,
} from './session';

describe('password', () => {
  it('verifies the right password only', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(stored).not.toContain('$');
    expect(await verifyPassword('correct horse battery staple', stored)).toBe(true);
    expect(await verifyPassword('wrong', stored)).toBe(false);
  });

  it('rejects malformed hashes', async () => {
    expect(await verifyPassword('x', '')).toBe(false);
    expect(await verifyPassword('x', 'scrypt:1:2:3')).toBe(false);
    expect(await verifyPassword('x', 'bcrypt:a:b:c:d:e')).toBe(false);
  });
});

describe('session', () => {
  const config: AuthConfig = { secret: 'a'.repeat(32), passwordHash: 'scrypt:1:1:1:aa:bb' };

  it('round-trips a valid token', async () => {
    const token = await createSessionToken(config);
    expect(await verifySessionToken(token, config)).toBe(true);
  });

  it('rejects tokens after secret rotation or password change', async () => {
    const token = await createSessionToken(config);
    expect(await verifySessionToken(token, { ...config, secret: 'b'.repeat(32) })).toBe(false);
    expect(await verifySessionToken(token, { ...config, passwordHash: 'scrypt:other' })).toBe(
      false,
    );
  });

  it('rejects expired, tampered, missing tokens and missing config', async () => {
    const old = new Date(Date.now() - (SESSION_MAX_AGE_SECONDS + 60) * 1000);
    expect(await verifySessionToken(await createSessionToken(config, old), config)).toBe(false);
    const token = await createSessionToken(config);
    expect(await verifySessionToken(token.slice(0, -2) + 'xx', config)).toBe(false);
    expect(await verifySessionToken(undefined, config)).toBe(false);
    expect(await verifySessionToken(token, null)).toBe(false);
  });

  it('fails closed when env is missing or the secret is short', () => {
    expect(authConfigFromEnv({})).toBeNull();
    expect(authConfigFromEnv({ AUTH_SECRET: 'short', AUTH_PASSWORD_HASH: 'x' })).toBeNull();
    expect(authConfigFromEnv({ AUTH_SECRET: 'a'.repeat(32), AUTH_PASSWORD_HASH: 'x' })).toEqual({
      secret: 'a'.repeat(32),
      passwordHash: 'x',
    });
  });

  it('only allows same-origin relative redirects', () => {
    expect(safeNextPath('/settings')).toBe('/settings');
    expect(safeNextPath('//evil.com')).toBe('/');
    expect(safeNextPath('/\\evil.com')).toBe('/');
    expect(safeNextPath('https://evil.com')).toBe('/');
    expect(safeNextPath('/login')).toBe('/');
    expect(safeNextPath(null)).toBe('/');
  });
});
