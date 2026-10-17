import { existsSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

/** Walks up from `start` to the directory holding pnpm-workspace.yaml. */
export function findRepoRoot(start: string = process.cwd()): string {
  let dir = resolve(/*turbopackIgnore: true*/ start);
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
}

/** Loads the repo root `.env` into process.env (existing variables win). For CLI scripts. */
export function loadRootEnv(): void {
  const file = join(findRepoRoot(), '.env');
  if (existsSync(file)) process.loadEnvFile(file);
}

export interface DbConfig {
  url: string;
  authToken?: string;
}

/**
 * Reads DATABASE_URL / DATABASE_AUTH_TOKEN. Relative `file:` URLs resolve against the repo root
 * (so the web app, scripts and collectors share one local file) and their directory is created.
 */
export function dbConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
  options: { allowClaude?: boolean } = {},
): DbConfig {
  const raw = env.DATABASE_URL?.trim() || 'file:./data/local.db';
  const authToken = env.DATABASE_AUTH_TOKEN?.trim() || undefined;
  if (!raw.startsWith('file:')) {
    // Claude Code never reads the hosted database (S19): its reads count against the free plan's
    // monthly quota, and one careless query can use most of it. Programs it starts get
    // CLAUDECODE=1; heavy questions go to the analysis copy instead.
    if (
      env.CLAUDECODE === '1' &&
      env.TORA_ALLOW_TURSO !== '1' &&
      !options.allowClaude &&
      !isLoopbackUrl(raw)
    ) {
      throw new Error(
        'Claude Code may not open the hosted database (Turso). Use the analysis copy ' +
          '(~/.local/share/tora/analysis/tora.db, see docs/backups.md), or run the command ' +
          'yourself in a terminal outside Claude Code.',
      );
    }
    return { url: raw, authToken };
  }

  const path = raw.slice('file:'.length);
  if (path === ':memory:') return { url: raw };
  const absolute = isAbsolute(path)
    ? path
    : resolve(/*turbopackIgnore: true*/ findRepoRoot(), path);
  mkdirSync(dirname(absolute), { recursive: true });
  return { url: `file:${absolute}`, authToken };
}

/** A database server on this machine (e.g. a local libsql-server used to measure rows read). */
function isLoopbackUrl(url: string): boolean {
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

export function isRemoteUrl(url: string): boolean {
  return !url.startsWith('file:') && url !== ':memory:';
}
