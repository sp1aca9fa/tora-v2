import { type SourceRegistry, shopOf, sourceInfo } from './sources';

/** True when the string contains Japanese script. */
export function hasJapanese(text: string): boolean {
  return /[぀-ヿ㐀-鿿ｦ-ﾟ]/.test(text);
}

/**
 * Lowercased, width-normalized text for search (full-width ASCII to half-width, katakana kept).
 */
export function searchKey(text: string): string {
  return text.normalize('NFKC').toLowerCase().trim();
}

/**
 * Order source key from the free-text "acquired from" (e.g. "スニダン" -> the shop whose aliases
 * name it), so order / transaction IDs of manual entries and imports are compared in one
 * namespace; unknown shops by their lowercased name.
 */
export function orderSourceOf(
  registry: SourceRegistry,
  acquiredFrom: string | null | undefined,
): string | null {
  const text = acquiredFrom?.normalize('NFKC').trim();
  if (!text) return null;
  return shopOf(registry, text) ?? text.toLowerCase();
}

/** Shops where one transaction ID is exactly one item (so an ID may be registered once). */
export function singleItemOrders(registry: SourceRegistry, source: string | null): boolean {
  return !!source && !!sourceInfo(registry, source)?.singleItemOrders;
}

/** Romaji syllables to katakana (Hepburn, and the common other spellings). */
// prettier-ignore
const KANA: Record<string, string> = {
  a: 'ア', i: 'イ', u: 'ウ', e: 'エ', o: 'オ',
  ka: 'カ', ki: 'キ', ku: 'ク', ke: 'ケ', ko: 'コ', kya: 'キャ', kyu: 'キュ', kyo: 'キョ',
  ga: 'ガ', gi: 'ギ', gu: 'グ', ge: 'ゲ', go: 'ゴ', gya: 'ギャ', gyu: 'ギュ', gyo: 'ギョ',
  sa: 'サ', shi: 'シ', si: 'シ', su: 'ス', se: 'セ', so: 'ソ', sha: 'シャ', shu: 'シュ', sho: 'ショ', she: 'シェ',
  za: 'ザ', ji: 'ジ', zi: 'ジ', zu: 'ズ', ze: 'ゼ', zo: 'ゾ', ja: 'ジャ', ju: 'ジュ', jo: 'ジョ', je: 'ジェ',
  ta: 'タ', chi: 'チ', ti: 'チ', tsu: 'ツ', tu: 'ツ', te: 'テ', to: 'ト', cha: 'チャ', chu: 'チュ', cho: 'チョ', che: 'チェ',
  da: 'ダ', di: 'ディ', du: 'ドゥ', de: 'デ', do: 'ド',
  na: 'ナ', ni: 'ニ', nu: 'ヌ', ne: 'ネ', no: 'ノ', nya: 'ニャ', nyu: 'ニュ', nyo: 'ニョ',
  ha: 'ハ', hi: 'ヒ', fu: 'フ', hu: 'フ', he: 'ヘ', ho: 'ホ', hya: 'ヒャ', hyu: 'ヒュ', hyo: 'ヒョ',
  fa: 'ファ', fi: 'フィ', fe: 'フェ', fo: 'フォ',
  ba: 'バ', bi: 'ビ', bu: 'ブ', be: 'ベ', bo: 'ボ', bya: 'ビャ', byu: 'ビュ', byo: 'ビョ',
  pa: 'パ', pi: 'ピ', pu: 'プ', pe: 'ペ', po: 'ポ', pya: 'ピャ', pyu: 'ピュ', pyo: 'ピョ',
  ma: 'マ', mi: 'ミ', mu: 'ム', me: 'メ', mo: 'モ', mya: 'ミャ', myu: 'ミュ', myo: 'ミョ',
  ya: 'ヤ', yu: 'ユ', yo: 'ヨ',
  ra: 'ラ', ri: 'リ', ru: 'ル', re: 'レ', ro: 'ロ', rya: 'リャ', ryu: 'リュ', ryo: 'リョ',
  wa: 'ワ', wo: 'ヲ', vu: 'ヴ', va: 'ヴァ', vi: 'ヴィ', ve: 'ヴェ', vo: 'ヴォ',
};

/** Katakana for a romaji word ("pikachu" to "ピカチュ"), or null when it is not one. */
function romajiToKana(word: string): string | null {
  let out = '';
  let i = 0;
  while (i < word.length) {
    const c = word[i]!;
    // A doubled consonant is a small tsu ("tt", "kk"; "tch" too).
    if (c === word[i + 1] && /[bcdfghjkmprstvz]/.test(c)) {
      out += 'ッ';
      i++;
      continue;
    }
    if (c === 't' && word.startsWith('tch', i)) {
      out += 'ッ';
      i++;
      continue;
    }
    const syllable = [3, 2, 1].map((n) => word.slice(i, i + n)).find((s) => KANA[s]);
    if (syllable) {
      out += KANA[syllable];
      i += syllable.length;
    } else if (c === 'n' || c === 'm') {
      // A syllable-ending n ("pon", "nn", "n'"), or m before b / p ("tombo").
      out += 'ン';
      i += word[i + 1] === "'" || (c === 'n' && word[i + 1] === 'n') ? 2 : 1;
    } else if (c === '-') {
      out += 'ー';
      i++;
    } else {
      return null;
    }
  }
  return out;
}

/** Hiragana as katakana, long vowels left out ("ピカチュウ", "ぴかちゅー" and "ピカチュ" alike). */
function looseKana(text: string): string {
  return text
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .replace(/ー/g, '')
    .replace(/(?<=[オコゴソゾトドノホボポモヨョロウクグスズツヌフブプムユュル])ウ/g, '');
}

/**
 * A name search (S27): each word of `q` must be in the text, case- and width-blind; a word typed
 * in romaji or hiragana also finds its katakana ("pikachu" finds ピカチュウ). Null for an empty
 * search.
 */
export function nameSearch(q: string): ((text: string) => boolean) | null {
  const terms = searchKey(q).split(/\s+/).filter(Boolean);
  if (!terms.length) return null;
  const words = terms.map((term) => {
    // Long vowels typed doubled ("rizaadon", "toukyou") are left out like the names'.
    const kana = /^[a-z'-]+$/.test(term)
      ? romajiToKana(term.replace(/([aeiou])\1|ou/g, (v) => v[0]!))
      : null;
    return { term, loose: looseKana(kana ?? term) };
  });
  return (text) => {
    const key = searchKey(text);
    const loose = looseKana(key);
    return words.every((w) => key.includes(w.term) || (!!w.loose && loose.includes(w.loose)));
  };
}
