import { describe, expect, it } from 'vitest';
import {
  type AuthConfig,
  SESSION_MAX_AGE_SECONDS,
  authConfigFromEnv,
  createMfaToken,
  createSessionToken,
  credentialFingerprint,
  deviceLabel,
  safeNextPath,
  verifyMfaToken,
  verifySessionToken,
} from './session';

const config: AuthConfig = { secret: 'a'.repeat(32) };
const claims = { userId: 'U1', deviceId: 'D1', fingerprint: 'fp' };

describe('session tokens', () => {
  it('round-trips claims', async () => {
    const token = await createSessionToken(config, claims);
    expect(await verifySessionToken(token, config)).toMatchObject(claims);
  });

  it('rejects other secrets, tampering, expiry and missing config', async () => {
    const token = await createSessionToken(config, claims);
    expect(await verifySessionToken(token, { secret: 'b'.repeat(32) })).toBeNull();
    expect(await verifySessionToken(token.slice(0, -2) + 'xx', config)).toBeNull();
    const old = new Date(Date.now() - (SESSION_MAX_AGE_SECONDS + 60) * 1000);
    expect(
      await verifySessionToken(await createSessionToken(config, claims, old), config),
    ).toBeNull();
    expect(await verifySessionToken(undefined, config)).toBeNull();
    expect(await verifySessionToken(token, null)).toBeNull();
  });

  it('keeps MFA and session tokens apart', async () => {
    const mfa = await createMfaToken(config, 'U1');
    expect(await verifyMfaToken(mfa, config)).toBe('U1');
    expect(await verifySessionToken(mfa, config)).toBeNull();
    expect(await verifyMfaToken(await createSessionToken(config, claims), config)).toBeNull();
    const stale = await createMfaToken(config, 'U1', new Date(Date.now() - 11 * 60 * 1000));
    expect(await verifyMfaToken(stale, config)).toBeNull();
  });

  it('fingerprints change with the password or the 2FA secret', () => {
    const base = credentialFingerprint({ passwordHash: 'p', totpSecretEnc: 't' });
    expect(credentialFingerprint({ passwordHash: 'p2', totpSecretEnc: 't' })).not.toBe(base);
    expect(credentialFingerprint({ passwordHash: 'p', totpSecretEnc: 't2' })).not.toBe(base);
  });

  it('fails closed when the secret is missing or short', () => {
    expect(authConfigFromEnv({})).toBeNull();
    expect(authConfigFromEnv({ AUTH_SECRET: 'short' })).toBeNull();
    expect(authConfigFromEnv({ AUTH_SECRET: 'a'.repeat(32) })).toEqual(config);
  });
});

describe('helpers', () => {
  it('only allows same-origin relative redirects', () => {
    expect(safeNextPath('/settings')).toBe('/settings');
    expect(safeNextPath('//evil.com')).toBe('/');
    expect(safeNextPath('/\\evil.com')).toBe('/');
    expect(safeNextPath('https://evil.com')).toBe('/');
    expect(safeNextPath('/login/verify')).toBe('/');
    expect(safeNextPath(null)).toBe('/');
  });

  it('labels devices from the user agent', () => {
    expect(
      deviceLabel(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('iPhone · Safari');
    expect(
      deviceLabel(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
      ),
    ).toBe('Windows · Chrome');
    expect(deviceLabel(null)).toBe('Unknown device');
  });
});
