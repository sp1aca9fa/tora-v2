// The alert texts as a sender outside the web app needs them (the home PC's `pnpm alerts`, tests):
// read from the app's text files, so the PC and the app send the same words, with each number
// token replaced from the code's constants, as the app's own loader does. Node only.
import { withNumbers } from '@tora/core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AlertTexts } from './alerts';
import { findRepoRoot } from './env';
import { DB_TEXT_NUMBERS } from './text-numbers';

/** `locale`'s alert texts; throws when the file is missing or a token has no value. */
export function readAlertTexts(locale: string, root: string = findRepoRoot()): AlertTexts {
  const file = join(root, 'apps', 'web', 'messages', `${locale}.json`);
  const all = JSON.parse(readFileSync(file, 'utf8')) as { alertText?: AlertTexts };
  return withNumbers(all.alertText ?? {}, DB_TEXT_NUMBERS) as AlertTexts;
}
