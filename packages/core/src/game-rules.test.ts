import { describe, expect, it } from 'vitest';
import {
  type ConsoleRow,
  type ItemRulesRow,
  categorySearchUrl,
  checkHash,
  consoleOf,
  effectiveRules,
  isGameItem,
  rulesHash,
  titlePasses,
} from './game-rules';

// Made-up category numbers (public test).
const consoles: ConsoleRow[] = [
  {
    key: 'alpha',
    names: { en: 'Alpha Station', ja: 'アルファ' },
    aliases: ['ALPHA ST'],
    categories: { market: '111' },
    boxedAllowed: true,
  },
  { key: 'beta', names: { en: 'Beta' }, aliases: [], categories: {}, boxedAllowed: false },
];

const rules = (over: Partial<ItemRulesRow> = {}): ItemRulesRow => ({
  console: 'alpha',
  edition: null,
  required: [],
  excluded: [],
  boxed: false,
  boxedOf: null,
  gameRules: null,
  ...over,
});

describe('isGameItem', () => {
  it('is games of the software kind, turned on or off by the row', () => {
    expect(isGameItem({ category: 'game', kind: 'software' })).toBe(true);
    expect(isGameItem({ category: 'game', kind: 'hardware' })).toBe(false);
    expect(isGameItem({ category: 'game', kind: 'hardware' }, { gameRules: 1 })).toBe(true);
    expect(isGameItem({ category: 'game', kind: 'software' }, { gameRules: 0 })).toBe(false);
    expect(isGameItem({ category: 'tcg', kind: 'single' }, { gameRules: 1 })).toBe(false);
    expect(isGameItem({ category: 'tcg', kind: 'sealed' })).toBe(false);
  });
});

describe('consoleOf', () => {
  it('matches the key, a name or an alias, ignoring case, width and spaces', () => {
    expect(consoleOf('alpha', consoles)).toBe('alpha');
    expect(consoleOf('ａｌｐｈａ　station', consoles)).toBe('alpha');
    expect(consoleOf('アルファ', consoles)).toBe('alpha');
    expect(consoleOf('alpha st', consoles)).toBe('alpha');
    expect(consoleOf('BETA', consoles)).toBe('beta');
  });
  it('gives null for an unknown or empty platform', () => {
    expect(consoleOf('Gamma', consoles)).toBeNull();
    expect(consoleOf('', consoles)).toBeNull();
    expect(consoleOf('   ', consoles)).toBeNull();
    expect(consoleOf(null, consoles)).toBeNull();
    expect(consoleOf('alpha', [])).toBeNull();
  });
});

describe('effectiveRules', () => {
  it('uses the platform when the item has no row, else the row as written', () => {
    const none = effectiveRules({ platform: 'Alpha Station' }, null, consoles);
    expect(none).toMatchObject({ console: 'alpha', categories: { market: '111' }, own: false });
    const own = effectiveRules({ platform: 'Alpha Station' }, rules({ console: 'beta' }), consoles);
    expect(own).toMatchObject({ console: 'beta', categories: {}, own: true });
    const unknown = effectiveRules({ platform: 'Gamma' }, null, consoles);
    expect(unknown).toMatchObject({ console: null, categories: {} });
  });

  it('takes the console from the platform when the row names none', () => {
    const onlyGameRules = rules({ console: null, gameRules: 1 });
    expect(effectiveRules({ platform: 'Alpha Station' }, onlyGameRules, consoles)).toMatchObject({
      console: 'alpha',
      categories: { market: '111' },
      own: true,
    });
    expect(
      effectiveRules({ platform: null }, rules({ console: '  ' }), consoles).console,
    ).toBeNull();
  });

  it('carries the item region, none when empty', () => {
    expect(effectiveRules({ platform: null, region: ' jp ' }, null, consoles).region).toBe('jp');
    expect(effectiveRules({ platform: null, region: '' }, null, consoles).region).toBeNull();
  });
});

describe('rulesHash', () => {
  const hashOf = (r: ItemRulesRow, list = consoles) =>
    rulesHash(effectiveRules({ platform: null }, r, list));

  it('is stable under word order, spacing and repeats', () => {
    const a = hashOf(rules({ required: ['Gold', 'limited'], excluded: ['x', 'y'] }));
    const b = hashOf(rules({ required: ['limited', 'gold', 'Gold'], excluded: ['y', ' x '] }));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it('changes with each field and with the console category', () => {
    const base = hashOf(rules());
    const changed = [
      hashOf(rules({ console: 'beta' })),
      hashOf(rules({ edition: 'Gold' })),
      hashOf(rules({ required: ['gold'] })),
      hashOf(rules({ excluded: ['gold'] })),
      hashOf(rules({ boxed: true })),
      hashOf(rules({ boxedOf: 'p1' })),
      hashOf(rules(), [{ ...consoles[0]!, categories: { market: '112' } }, consoles[1]!]),
      hashOf(rules(), [{ ...consoles[0]!, categories: {} }, consoles[1]!]),
      rulesHash(effectiveRules({ platform: null, region: 'jp' }, rules(), consoles)),
    ];
    for (const h of changed) expect(h).not.toBe(base);
    expect(new Set(changed).size).toBe(changed.length);
  });

  it('per source covers only that source category; overall covers every one', () => {
    const two = [{ ...consoles[0]!, categories: { market: '111', other: '5' } }, consoles[1]!];
    const before = effectiveRules({ platform: null }, rules(), consoles);
    const after = effectiveRules({ platform: null }, rules(), two);
    expect(rulesHash(after, 'market')).toBe(rulesHash(before, 'market'));
    expect(rulesHash(after, 'other')).not.toBe(rulesHash(before, 'other'));
    expect(rulesHash(after)).not.toBe(rulesHash(before));
    expect(checkHash(after, 'listings', 'market')).toBe(rulesHash(after, 'market'));
    expect(checkHash(after, 'sales', '')).toBe(rulesHash(after));
    // A word still changes the per-source hash.
    const word = effectiveRules({ platform: null }, rules({ required: ['gold'] }), two);
    expect(rulesHash(word, 'market')).not.toBe(rulesHash(after, 'market'));
  });

  it('is the same for an empty row and the platform alone when they name the same console', () => {
    expect(rulesHash(effectiveRules({ platform: 'Alpha Station' }, null, consoles))).toBe(
      hashOf(rules()),
    );
  });
});

describe('titlePasses', () => {
  const eff = (r: Partial<ItemRulesRow>) => effectiveRules({ platform: null }, rules(r), consoles);

  it('needs every required word and no excluded one, spaces and width ignored', () => {
    const r = eff({ required: ['Gold Edition'], excluded: ['ジャンク'] });
    expect(titlePasses('Hero Quest ＧＯＬＤ　editionです', r)).toBe(true);
    expect(titlePasses('Hero Quest', r)).toBe(false);
    expect(titlePasses('Hero Quest gold edition ジャンク', r)).toBe(false);
  });

  it('needs a box named when boxed', () => {
    const r = eff({ boxed: true });
    expect(titlePasses('Hero Quest 箱説付き', r)).toBe(true);
    expect(titlePasses('Hero Quest ソフトのみ', r)).toBe(false);
  });

  it('reads box and missing-part words written with spaces', () => {
    const r = eff({ boxed: true });
    expect(titlePasses('Hero Quest Complete in Box', r)).toBe(true);
    expect(titlePasses('Hero Quest CIB', r)).toBe(true);
    expect(titlePasses('Hero Quest 箱説付き ソフト のみ', r)).toBe(false);
    expect(titlePasses('Hero Quest 箱付き 説明書 なし', r)).toBe(false);
    expect(titlePasses('Hero Quest 完品 箱 なし', r)).toBe(false);
    expect(titlePasses('Hero Quest', r)).toBe(false);
  });

  it('lets a missing title pass only rules that ask for nothing in it', () => {
    expect(titlePasses(null, eff({}))).toBe(true);
    expect(titlePasses('', eff({ required: ['gold'] }))).toBe(false);
    expect(titlePasses(undefined, eff({ boxed: true }))).toBe(false);
  });
});

describe('categorySearchUrl', () => {
  const urls = { market: 'https://market.example/search?c=TORA_CATEGORY_ID' };
  it('fills the number in, encoded; none without a template or a number', () => {
    expect(categorySearchUrl(urls, 'market', ' 12 ')).toBe('https://market.example/search?c=12');
    expect(categorySearchUrl(urls, 'market', 'a&b')).toBe('https://market.example/search?c=a%26b');
    expect(categorySearchUrl(urls, 'other', '12')).toBeNull();
    expect(categorySearchUrl(urls, 'market', '')).toBeNull();
    expect(categorySearchUrl(undefined, 'market', '12')).toBeNull();
  });
});
