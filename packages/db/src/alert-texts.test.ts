// The alert texts a sender outside the web app reads: every language's file, with no number token
// left for a person to receive.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readAlertTexts } from './alert-texts';
import { DB_TEXT_NUMBERS } from './text-numbers';

const root = join(import.meta.dirname, '../../..');
const LOCALES = readdirSync(join(root, 'apps/web/messages'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.slice(0, -5));

describe('readAlertTexts', () => {
  it.each(LOCALES)('%s has its numbers filled in', (locale) => {
    const texts = readAlertTexts(locale, root);
    expect(Object.values(texts).filter((t) => t.includes('[['))).toEqual([]);
  });

  it('gives the number a text states', () => {
    expect(readAlertTexts('en', root).summaryDrops).toContain(
      `${DB_TEXT_NUMBERS.sharpDropPct}% or more in a week`,
    );
  });

  it('throws for a language with no file', () => {
    expect(() => readAlertTexts('xx', root)).toThrow();
  });
});
