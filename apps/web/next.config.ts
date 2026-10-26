import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

// `next` runs from apps/web; the shared .env lives at the repo root (also used by scripts and
// collectors). Existing variables win, so a hosting platform's environment is never overridden.
const repoRoot = path.join(process.cwd(), '..', '..');
const rootEnv = path.join(repoRoot, '.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

// Installed languages (S16): every messages/{code}.json, with its toggle label (`languages.short`).
const languages = Object.fromEntries(
  readdirSync('messages')
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const code = f.slice(0, -5);
      const texts = JSON.parse(readFileSync(path.join('messages', f), 'utf8'));
      return [code, texts.languages?.short ?? code.toUpperCase()];
    }),
);

const nextConfig: NextConfig = {
  env: { TORA_LANGUAGES: JSON.stringify(languages) },
  transpilePackages: ['@tora/core', '@tora/db', '@tora/collector-sdk'],
  // Purchase files are uploaded one per request (Vercel caps a request near 4.5 MB).
  experimental: { serverActions: { bodySizeLimit: '5mb' } },
  serverExternalPackages: ['@libsql/client', 'libsql'],
  outputFileTracingRoot: repoRoot,
  poweredByHeader: false,
  // `next dev` would otherwise write an AGENTS.md for AI agents into apps/web.
  agentRules: false,
};

export default createNextIntlPlugin('./src/i18n/request.ts')(nextConfig);
