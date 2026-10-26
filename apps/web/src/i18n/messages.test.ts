// Translation files (requirements S16): every text the code asks for is in en.json; another
// language may lack texts (they show in English) but has none en.json lacks. Run after adding or
// translating a language.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { loadMessages } from './messages';

const root = join(__dirname, '../..');
type Tree = { [key: string]: string | Tree };
const load = (code: string): Tree =>
  JSON.parse(readFileSync(join(root, 'messages', `${code}.json`), 'utf8'));
/** The installed languages: their files. */
const LOCALES = readdirSync(join(root, 'messages'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.slice(0, -5));

/** Every text's dotted key. */
const keys = (tree: Tree, prefix = ''): string[] =>
  Object.entries(tree).flatMap(([k, v]) =>
    typeof v === 'string' ? [`${prefix}${k}`] : keys(v, `${prefix}${k}.`),
  );

const has = (tree: Tree, key: string) =>
  key
    .split('.')
    .reduce<unknown>((t, p) => (t && typeof t === 'object' ? (t as Tree)[p] : undefined), tree) !==
  undefined;

/** Literal keys the code passes to a translator (`t('a.b')` after `useTranslations('ns')`). */
function usedKeys(): { file: string; key: string }[] {
  const files: string[] = [];
  (function walk(dir: string) {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(f) && !f.endsWith('.test.ts')) files.push(p);
    }
  })(join(root, 'src'));
  const found: { file: string; key: string }[] = [];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const namespaces = new Map<string, Set<string>>();
    for (const m of src.matchAll(
      /const (\w+) = (?:await )?(?:useTranslations|getTranslations)\((?:'([^']*)'|\{[^}]*namespace: '([^']*)'[^}]*\})?\)/g,
    )) {
      const set = namespaces.get(m[1]!) ?? new Set();
      set.add(m[2] ?? m[3] ?? '');
      namespaces.set(m[1]!, set);
    }
    for (const [name, set] of namespaces) {
      for (const m of src.matchAll(
        new RegExp(`\\b${name}(?:\\.rich|\\.has|\\.markup)?\\('([^'\`]+)'`, 'g'),
      )) {
        for (const ns of set) found.push({ file, key: ns ? `${ns}.${m[1]}` : m[1]! });
      }
    }
  }
  return found;
}

describe('translation files', () => {
  const english = load('en');
  const all = keys(english);

  it.each(LOCALES.filter((l) => l !== 'en'))('%s has no text en.json lacks', (code) => {
    const theirs = keys(load(code));
    expect(
      theirs.filter((k) => !all.includes(k)),
      'not in en.json',
    ).toEqual([]);
  });

  it('shows English where a language has no text', async () => {
    const code = LOCALES.find((l) => l !== 'en');
    if (!code) return;
    const own = load(code);
    const loaded = await loadMessages(code);
    expect(keys(loaded).sort()).toEqual([...all].sort());
    const first = keys(own)[0]!;
    expect(has(loaded, first)).toBe(true);
    const value = (tree: Tree, key: string) =>
      key.split('.').reduce<unknown>((t, p) => (t as Tree)[p], tree);
    expect(value(loaded, first)).toBe(value(own, first));
  });

  it.each(LOCALES)('%s: every text is a valid message (a literal "<" or "{" is quoted)', (code) => {
    const messages = load(code);
    const invalid: string[] = [];
    const t = createTranslator({
      locale: code,
      messages,
      onError: (e) => {
        if (e.code === 'INVALID_MESSAGE') invalid.push(e.message.slice(0, 120));
      },
    });
    // Values and tags are not given: only texts that do not parse count.
    for (const key of keys(messages)) t(key as never);
    expect(invalid).toEqual([]);
  });

  it('has every text the code asks for', () => {
    const used = usedKeys();
    // The scan itself still finds the code's texts.
    expect(used.length).toBeGreaterThan(200);
    const missing = used
      .filter(({ key }) => !has(english, key))
      .map(({ file, key }) => `${file.slice(root.length + 1)}: ${key}`);
    expect([...new Set(missing)]).toEqual([]);
  });
});
