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
export function dbConfigFromEnv(env: Record<string, string | undefined> = process.env): DbConfig {
  const raw = env.DATABASE_URL?.trim() || 'file:./data/local.db';
  const authToken = env.DATABASE_AUTH_TOKEN?.trim() || undefined;
  if (!raw.startsWith('file:')) return { url: raw, authToken };

  const path = raw.slice('file:'.length);
  if (path === ':memory:') return { url: raw };
  const absolute = isAbsolute(path)
    ? path
    : resolve(/*turbopackIgnore: true*/ findRepoRoot(), path);
  mkdirSync(dirname(absolute), { recursive: true });
  return { url: `file:${absolute}`, authToken };
}

export function isRemoteUrl(url: string): boolean {
  return !url.startsWith('file:') && url !== ':memory:';
}
