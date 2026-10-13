import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { existsSync } from 'node:fs';
import path from 'node:path';

// `next` runs from apps/web; the shared .env lives at the repo root (also used by scripts and
// collectors). Existing variables win, so Vercel's environment is never overridden.
const repoRoot = path.join(process.cwd(), '..', '..');
const rootEnv = path.join(repoRoot, '.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const nextConfig: NextConfig = {
  transpilePackages: ['@tora/core', '@tora/db', '@tora/collector-sdk'],
  // Purchase files are uploaded one per request (Vercel caps a request near 4.5 MB).
  experimental: { serverActions: { bodySizeLimit: '5mb' } },
  serverExternalPackages: ['@libsql/client', 'libsql'],
  outputFileTracingRoot: repoRoot,
  poweredByHeader: false,
};

export default createNextIntlPlugin('./src/i18n/request.ts')(nextConfig);
