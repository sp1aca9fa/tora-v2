import { randomInt } from 'node:crypto';
import { keyedHash, sha256 } from './crypto';

// No 0/o, 1/l/i: easy to read back from paper.
const CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';

function normalize(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * One-time recovery codes like `k7m2-9qxd` (~49 bits each). Only their keyed hashes are stored
 * (keyed with AUTH_SECRET, as the status token): a copy of the database alone is not enough to
 * try every code offline.
 */
export function generateBackupCodes(
  authSecret: string,
  count = 8,
): { codes: string[]; hashes: string[] } {
  const codes = Array.from({ length: count }, () => {
    const raw = Array.from({ length: 10 }, () => CHARS[randomInt(CHARS.length)]).join('');
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
  return { codes, hashes: codes.map((c) => keyedHash(normalize(c), authSecret)) };
}

/**
 * The stored hash the code matches, or null. Codes made before the keyed hash are stored as a
 * plain SHA-256 and still match, so they keep working until used or replaced.
 */
export function matchBackupCode(
  code: string,
  hashes: readonly string[],
  authSecret: string,
): string | null {
  const n = normalize(code);
  if (n.length !== 10) return null;
  const keyed = keyedHash(n, authSecret);
  if (hashes.includes(keyed)) return keyed;
  const plain = sha256(n);
  return hashes.includes(plain) ? plain : null;
}

export function looksLikeBackupCode(code: string): boolean {
  return normalize(code).length === 10 && /[a-z]/i.test(code);
}
