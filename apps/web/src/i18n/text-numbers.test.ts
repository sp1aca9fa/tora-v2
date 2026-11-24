// A text's numbers come from the code (spec 2026-11-25 text-numbers): every token has a value,
// every value is one a text can show, no text shows a token, and an English text's digit is either
// a token or on the reviewed list below.
import { withNumbers } from '@tora/core';
import { DB_TEXT_NUMBERS } from '@tora/db';
import { BACKUP_KEEP_DAYS, BACKUP_KEEP_MONTHS } from '@tora/db/backup';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadMessages } from './messages';
import { TEXT_NUMBERS } from './text-numbers';

type Tree = { [key: string]: string | Tree };
const dir = join(__dirname, '../../messages');
const LOCALES = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.slice(0, -5));
const load = (code: string): Tree => JSON.parse(readFileSync(join(dir, `${code}.json`), 'utf8'));
const leaves = (tree: Tree, prefix = ''): [string, string][] =>
  Object.entries(tree).flatMap(([k, v]) =>
    typeof v === 'string' ? [[`${prefix}${k}`, v]] : leaves(v, `${prefix}${k}.`),
  );
const tokensOf = (text: string) => [...text.matchAll(/\[\[(\w+)\]\]/g)].map((m) => m[1]!);

/**
 * A text's own words: without its tokens, and without the syntax of `{...}` (argument names,
 * `plural` and `select` heads, selectors such as `=0`). The words of a plural or select branch
 * stay: they are text a person reads.
 */
function bare(text: string): string {
  let out = '';
  let depth = 0;
  for (const c of text.replace(/\[\[\w+\]\]/g, '')) {
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (depth % 2 === 0) out += c;
  }
  return out;
}

/**
 * English texts that keep a digit, each with why it is not a code number. A key holding a code
 * number states it by a token; one that differs from its constant stays here ("differs from").
 */
const REVIEWED: Record<string, string> = {};
const review = (why: string, ...keys: string[]) => keys.forEach((k) => (REVIEWED[k] = why));
review(
  'a label or a format, not a setting',
  'portfolio.insights.period.7',
  'portfolio.insights.period.30',
  'portfolio.insights.period.90',
  'portfolio.insights.period.365',
  'spread.before2016',
  'settings.underMinute',
  'schedule.underMinute',
  'currency.latest',
  'currency.typedLabel',
  'opening.inBoxes',
  'accounts.usernameRule',
  'accounts.error.username',
);
review(
  'an example of what to type or what a word means',
  'valuation.estimatedNote',
  'grades.intro',
  'imports.sheet.problem.bad_date',
  'imports.sheet.problem.bad_graded',
  'currency.rateInvalid',
  'opening.error.code',
  'opening.error.tiers',
);
review(
  'a natural bound (none below 0 or 1; the 1 of "1 day in 10")',
  'imports.sheet.problem.bad_quantity',
  'imports.sheet.problem.bad_cost',
  'opportunities.plan.noCost',
  'boardTracking.invalid',
  'opening.error.packs',
  'consoles.error.sort',
  'opportunities.waitLow',
  'opportunities.waitFloored',
);
review('numbered steps', 'alerts.telegramSteps');
review('a name', 'alertText.logHint', 'setup.scanInfo');
review('a dated record of a past test', 'strategy.potentialNote');
review('a rounded size of a 0.001-degree grid', 'stores.pointInfo');
review(
  'set where the loader cannot import it (a shell script, the backup module); checked below',
  'schedule.estimate',
  'alertText.updateWaiting',
  'activity.admin.serverUpdateWaiting',
  'commands.schedule.install',
  'commands.backups.backup',
);

/**
 * Texts of another language that do not name the numbers their English text names, each with why.
 * One that types a number stays right only by hand.
 */
const OWN_NUMBERS: Record<string, string> = {
  'es imports.sheet.error.sheetTooManyRows': 'types 5.000, with its own thousands mark',
  'ja database.info': 'types the two limits in its own units (億, 万)',
  'es buy.falling': 'shorter: leaves out when the wait ends',
  'ja buy.falling': 'shorter: leaves out when the wait ends',
};

describe('text numbers', () => {
  it('replaces each token, leaves its input unchanged, and throws on a token with no value', () => {
    const input = { a: 'in [[n]] days, [[n]] times', b: { c: 'at [[at]]', d: 'no token' } };
    expect(withNumbers(input, { n: 30, at: '05:00' })).toEqual({
      a: 'in 30 days, 30 times',
      b: { c: 'at 05:00', d: 'no token' },
    });
    expect(input.a).toBe('in [[n]] days, [[n]] times');
    expect(() => withNumbers({ a: '[[missing]]' }, { n: 1 })).toThrow('[[missing]]');
  });

  it('has a value for every token of every language', () => {
    const missing = LOCALES.flatMap((code) =>
      leaves(load(code)).flatMap(([key, text]) =>
        tokensOf(text)
          .filter((t) => !Object.prototype.hasOwnProperty.call(TEXT_NUMBERS, t))
          .map((t) => `${code} ${key}: [[${t}]]`),
      ),
    );
    expect(missing).toEqual([]);
  });

  it('gives alert texts only values the db package has (its sender reads them too)', () => {
    const missing = LOCALES.flatMap((code) =>
      leaves((load(code).alertText as Tree | undefined) ?? {}).flatMap(([key, text]) =>
        tokensOf(text)
          .filter((t) => !Object.prototype.hasOwnProperty.call(DB_TEXT_NUMBERS, t))
          .map((t) => `${code} alertText.${key}: [[${t}]]`),
      ),
    );
    expect(missing).toEqual([]);
  });

  it('holds only finite numbers and non-empty strings', () => {
    const bad = Object.entries(TEXT_NUMBERS).filter(
      ([, v]) => !(typeof v === 'number' ? Number.isFinite(v) : typeof v === 'string' && v !== ''),
    );
    expect(bad).toEqual([]);
  });

  it.each(LOCALES)('%s reaches readers with no token left', async (code) => {
    const left = leaves((await loadMessages(code)) as Tree).filter(([, t]) => t.includes('[['));
    expect(left).toEqual([]);
  });

  it('keeps a digit in an English text only by a token or on the reviewed list', () => {
    const withDigits = leaves(load('en'))
      .filter(([, text]) => /\d/.test(bare(text)))
      .map(([key]) => key);
    expect(withDigits.filter((k) => !(k in REVIEWED))).toEqual([]);
    // A reviewed text that lost its digits leaves the list.
    expect(Object.keys(REVIEWED).filter((k) => !withDigits.includes(k))).toEqual([]);
  });

  it('shows whole numbers (a derived value that stops being one must be reworded)', () => {
    const FRACTIONS = ['trendingRatio'];
    const bad = Object.entries(TEXT_NUMBERS).filter(
      ([name, v]) => typeof v === 'number' && !Number.isInteger(v) && !FRACTIONS.includes(name),
    );
    expect(bad).toEqual([]);
  });

  it.each(LOCALES.filter((l) => l !== 'en'))(
    '%s names the numbers its English text names',
    (code) => {
      const english = new Map(leaves(load('en')));
      const names = (text: string) => [...new Set(tokensOf(text))].sort().join();
      const differs = leaves(load(code))
        .filter(([key, text]) => english.has(key) && names(english.get(key)!) !== names(text))
        .map(([key]) => `${code} ${key}`);
      const own = Object.keys(OWN_NUMBERS).filter((k) => k.startsWith(`${code} `));
      expect(differs.sort()).toEqual(own.sort());
    },
  );

  it('agrees with the numbers set where the loader cannot import them', () => {
    const en = new Map(leaves(load('en')));
    const script = (path: string) => readFileSync(join(__dirname, '../../../..', path), 'utf8');

    expect(en.get('commands.backups.backup')).toContain(`the last ${BACKUP_KEEP_DAYS} days`);
    expect(en.get('commands.backups.backup')).toContain('each month for a year');
    expect(BACKUP_KEEP_MONTHS).toBe(12);

    const ciWait = Number(
      /^CI_WAIT_ALERT_SECONDS=(\d+)$/m.exec(script('ops/update-server.sh'))?.[1],
    );
    expect(en.get('alertText.updateWaiting')).toContain(`for ${ciWait / 3600} h `);
    expect(en.get('activity.admin.serverUpdateWaiting')).toContain(` ${ciWait / 3600} h `);

    const task = script('scripts/install-windows-task.sh');
    const at = /^AT="\$\{AT:-(\d\d:\d\d)\}"$/m.exec(task)?.[1];
    expect(en.get('commands.schedule.install')).toContain(`at ${at}, retried hourly`);
    expect(task).toContain('-RepetitionInterval (New-TimeSpan -Hours 1)');

    const jitter = Number(
      /^MAX_JITTER_SECONDS="\$\{MAX_JITTER_SECONDS:-(\d+)\}"$/m.exec(
        script('scripts/collect-cron.sh'),
      )?.[1],
    );
    expect(en.get('schedule.estimate')).toContain(`up to ${jitter / 60} minutes at random`);

    // Another language types these numbers too: its text holds the same ones.
    const typed: [string, string[]][] = [
      ['commands.backups.backup', [`${BACKUP_KEEP_DAYS}`]],
      ['alertText.updateWaiting', [`${ciWait / 3600}`]],
      ['activity.admin.serverUpdateWaiting', [`${ciWait / 3600}`]],
      ['commands.schedule.install', [`${at}`]],
      ['schedule.estimate', [`${jitter / 60}`]],
    ];
    const lacking = LOCALES.flatMap((code) => {
      const texts = new Map(leaves(load(code)));
      return typed.flatMap(([key, numbers]) =>
        numbers
          .filter((n) => texts.has(key) && !new RegExp(`(?<!\\d)${n}(?!\\d)`).test(texts.get(key)!))
          .map((n) => `${code} ${key}: ${n}`),
      );
    });
    expect(lacking).toEqual([]);
  });
});
