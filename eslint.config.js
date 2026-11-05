import js from '@eslint/js';
import nextVitals from 'eslint-config-next/core-web-vitals';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores([
    '**/node_modules/',
    '**/.next/',
    '**/next-env.d.ts',
    'packages/db/drizzle/',
    'collectors/',
    '.setup-test/',
  ]),
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    extends: [nextVitals],
    settings: { next: { rootDir: 'apps/web' } },
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    // The process check's script and tests are shared with other projects, byte for byte, so they
    // cannot carry the `/* global */` line this repo's other scripts use.
    files: ['ops/process-check*.mjs'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly' } },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
]);
