export * from './password';
export * from './totp';
export * from './crypto';
export * from './backup-codes';

/** Usernames: lowercase letters, digits, `.`, `_`, `-`; 3 to 32 characters. */
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 32;
const USERNAME = new RegExp(`^[a-z0-9._-]{${USERNAME_MIN},${USERNAME_MAX}}$`);
/** A new password's least length: the setup page and `pnpm user` ask the same. */
export const MIN_PASSWORD = 12;

export function normalizeUsername(input: string): string | null {
  const u = input.trim().toLowerCase();
  return USERNAME.test(u) ? u : null;
}
