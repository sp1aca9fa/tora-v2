// Game rules (requirements S36: Scope rule and Terms "The item's rules", "Console table", "Confirmed"):
// which items are games, the console a stored platform names, an item's effective rules and their hash,
// and whether a title passes them. Pure. The title words and their classes were written for the Wishlist
// dry run (2026-11-21, `collectors/scripts/wishlist-sim-rules.ts`, which now imports them from here).
import type { Names } from './categories';
import { median } from './market';

// ---------------------------------------------------------------------------------------------
// Which items the game rules touch

/** The fields of an item the game rules read. */
export interface GameItem {
  category: string;
  kind: string;
  platform?: string | null;
  /** The item's region (one of its category's regions), part of its rules (S36 Terms). */
  region?: string | null;
}

/** The fields of an item's own rules row (`item_rules`) the rules read. */
export interface ItemRulesRow {
  console: string | null;
  edition: string | null;
  required: readonly string[];
  excluded: readonly string[];
  boxed: boolean;
  /** The plain item a boxed item's sales and listings come from (S36 B1). */
  boxedOf: string | null;
  /** Null: by kind; 1: on for a game kind other than software; 0: off. */
  gameRules: 0 | 1 | null;
}

/**
 * Whether the game rules apply (S36 Scope rule: "Game" is an item of the game category whose kind is
 * software; for the other game kinds the rules apply only when a person turns them on for the item, and
 * `game_rules = 0` turns them off). Cards and sealed products are never games, whatever their row says.
 */
export function isGameItem(
  product: Pick<GameItem, 'category' | 'kind'>,
  rules?: Pick<ItemRulesRow, 'gameRules'> | null,
): boolean {
  if (product.category !== 'game') return false;
  if (rules?.gameRules === 0) return false;
  if (rules?.gameRules === 1) return true;
  return product.kind === 'software';
}

// ---------------------------------------------------------------------------------------------
// The console table

/** A row of the console table (S36 Terms "Console table"), as the rules read it. */
export interface ConsoleRow {
  /** Lower case, chosen by an admin. */
  key: string;
  names: Names;
  /** Other spellings of the console, matched against `products.platform`. */
  aliases: readonly string[];
  /** The console's software category per marketplace (source key to the site's category id). */
  categories: Readonly<Record<string, string>>;
  /** Whether "boxed" can be asked for its games (S36 B1). */
  boxedAllowed: boolean;
}

/** A console key as stored: trimmed and lower case. */
export function consoleKey(key: string): string {
  return key.normalize('NFKC').trim().toLowerCase();
}

/** A platform or console name for comparison: full-width to half-width, lower case, no spaces. */
function platformText(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}

/**
 * The console a stored platform names (S36 Assumed: aliases match `products.platform` after
 * normalizing case, width and spaces): the row whose key, one of whose names, or one of whose aliases
 * reads the same. The first such row in the order given wins. Null when the platform is empty or no row
 * names it (unknown stays unknown: such a game keeps today's search).
 */
export function consoleOf(
  platform: string | null | undefined,
  consoles: readonly ConsoleRow[],
): string | null {
  if (!platform) return null;
  const p = platformText(platform);
  if (!p) return null;
  for (const c of consoles) {
    const spellings = [c.key, ...Object.values(c.names), ...c.aliases];
    if (spellings.some((s) => s && platformText(s) === p)) return c.key;
  }
  return null;
}

/**
 * Where a category id goes in a saved search address (`ConsolePlugins.categoryUrls` in `@tora/db`).
 * Letters and underscores only, so a plug-in that encodes the id leaves it as it is.
 */
export const CATEGORY_URL_SLOT = 'TORA_CATEGORY_ID';

/**
 * The address of `source`'s search for `category` (the console page's "test" link), or null when the
 * plug-in declares none or there is no number. The app only links to it.
 */
export function categorySearchUrl(
  templates: Readonly<Record<string, string>> | undefined,
  source: string,
  category: string,
): string | null {
  const t = templates?.[source];
  const id = category.trim();
  if (!t || !id || !t.startsWith('https://')) return null;
  return t.replace(CATEGORY_URL_SLOT, encodeURIComponent(id));
}

// ---------------------------------------------------------------------------------------------
// Effective rules and their hash

/** What counts as the item at every source (S36 Terms "The item's rules"), with its console's categories. */
export interface EffectiveRules {
  /** The console's key, or null when the item names none the table knows. */
  console: string | null;
  edition: string | null;
  /** The item's region (`products.region`), null when it has none. */
  region: string | null;
  /** Normalized, without repeats, sorted. */
  required: string[];
  excluded: string[];
  boxed: boolean;
  boxedOf: string | null;
  /** The console's software category per marketplace; empty when no console or none set. */
  categories: Record<string, string>;
  /** True when the item has a rules row of its own (false: from its platform, no words). */
  own: boolean;
}

/** Words as the rules compare them: normalized, no spaces, no empty ones, no repeats, sorted. */
export function ruleWords(words: readonly string[] | null | undefined): string[] {
  return [...new Set((words ?? []).map((w) => compact(w)).filter((w) => w.length > 0))].toSorted();
}

/**
 * The item's effective rules (S36 Terms "The item's rules": the console, the edition, the region, words;
 * plan section 9 A): its own `item_rules` row when it has one, else no words; the row's console when it
 * names one, else the console found from `products.platform` (a row written only to set `game_rules`
 * keeps its platform's console); the item's region; with that console's category per marketplace. A
 * console key no row has gives no categories.
 */
export function effectiveRules(
  product: Pick<GameItem, 'platform' | 'region'>,
  rules: ItemRulesRow | null | undefined,
  consoles: readonly ConsoleRow[],
): EffectiveRules {
  const console = rules?.console?.trim()
    ? consoleKey(rules.console)
    : consoleOf(product.platform, consoles);
  const row = console ? consoles.find((c) => c.key === console) : undefined;
  const categories: Record<string, string> = {};
  for (const [source, id] of Object.entries(row?.categories ?? {})) {
    const v = id?.trim();
    if (v) categories[source] = v;
  }
  return {
    console: console || null,
    edition: rules?.edition?.trim() || null,
    region: product.region?.trim() || null,
    required: ruleWords(rules?.required),
    excluded: ruleWords(rules?.excluded),
    boxed: !!rules?.boxed,
    boxedOf: rules?.boxedOf ?? null,
    categories,
    own: !!rules,
  };
}

/** FNV-1a, 64 bits, over UTF-16 code units: stable across runs and machines, no crypto needed. */
function fnv1a64(text: string): string {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < text.length; i++) {
    h ^= BigInt(text.charCodeAt(i));
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, '0');
}

/**
 * The hash of an item's effective rules (S36 Terms "Confirmed", plan section 9 B): over the console,
 * the edition, the region, the required and excluded words (their order does not matter), boxed, the
 * plain item, and the console's categories. A confirmation holds only while the hash it was made under
 * is today's, so changing any of these takes it away without deleting a check.
 *
 * With `source`, the hash a check of the item's listings at that source is made under: only that
 * source's category counts, so setting another marketplace's category keeps those confirmations.
 * Without, the hash of a check of its sales (every source together): every category counts.
 */
export function rulesHash(rules: EffectiveRules, source?: string): string {
  const categories =
    source === undefined
      ? Object.entries(rules.categories)
          .filter(([, v]) => v)
          .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      : [[source, rules.categories[source] || null]];
  return fnv1a64(
    JSON.stringify([
      source === undefined ? 'sales' : 'listings',
      rules.console,
      rules.edition,
      rules.region,
      ruleWords(rules.required),
      ruleWords(rules.excluded),
      rules.boxed,
      rules.boxedOf,
      categories,
    ]),
  );
}

/**
 * The hash a check of `kind` at `source` is made and read under: listings per source, sales overall;
 * for a boxed item, with its plain item's rules in it.
 */
export function checkHash(
  rules: EffectiveRules,
  kind: ItemCheckKind,
  source: string,
  plain?: EffectiveRules | null,
): string {
  const own = kind === 'listings' ? rulesHash(rules, source) : rulesHash(rules);
  // A boxed item reads its plain item's rows (S36 B1): which rows those are is the plain item's
  // rules too, so its confirmation stops counting when either item's rules change. `plain` is the
  // plain item's effective rules, given only for a boxed item.
  if (!plain) return own;
  const of = kind === 'listings' ? rulesHash(plain, source) : rulesHash(plain);
  return fnv1a64(JSON.stringify(['boxed', own, of]));
}

// ---------------------------------------------------------------------------------------------
// Titles

/** Full-width to half-width, lower case, one space between words (as the 2026-11-21 dry run). */
export function normalizeTitle(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Normalized and without spaces: sellers space Japanese titles in many ways. */
function compact(text: string): string {
  return normalizeTitle(text).replace(/ /g, '');
}

/**
 * The stored search with a game's rules laid over it, for one run (S36 A1, A2): the console's
 * category at `source` when the search has none, and the required words added to its keywords (each
 * once). The excluded words are not put in: a plug-in's own filter would store such a sale excluded
 * with no rules mark, never restored when the word goes or the switch is off; the marks exclude them
 * (`markNewSales`). A search without keywords is left as it is: the words narrow a search, they never
 * start one. Returns the stored object itself when nothing changes, so a caller can tell. The wish
 * page's saved-search helper shows the same search (S36 C4).
 */
export function overlayQuery<Q extends { keywords?: string[]; categoryId?: string }>(
  query: Q,
  rules: Pick<EffectiveRules, 'required' | 'categories'>,
  source: string,
): Q {
  const keywords = query.keywords ?? [];
  if (!keywords.length) return query;
  const have = compact(keywords.join(' '));
  const required = rules.required.filter((w) => !have.includes(compact(w)));
  const category = query.categoryId ? null : (rules.categories[source] ?? null);
  if (!required.length && !category) return query;
  return {
    ...query,
    keywords: [...keywords, ...required],
    ...(category && { categoryId: category }),
  };
}

/** A title naming a box (S36 B1: "boxed", a copy with its box). Matched on the title without spaces. */
const BOXED =
  /箱付|箱つき|箱あり|箱有|箱説付|箱説つき|箱説あり|箱説有|箱・説明書付|箱、説明書付|箱説明書付|外箱付|元箱付|完品|cib|completeinbox/;

/**
 * Whether a title passes the item's rules (S36 Terms "The item's rules"): every required word present,
 * no excluded word, and when the item is boxed, a box named and no word saying a part is missing.
 * Compared normalized and without spaces. A missing title passes only rules that ask for nothing in it
 * (no required word, not boxed): it cannot show a word.
 */
export function titlePasses(title: string | null | undefined, rules: EffectiveRules): boolean {
  const t = title ? compact(title) : '';
  if (!t) return rules.required.length === 0 && !rules.boxed;
  for (const w of rules.required) if (!t.includes(compact(w))) return false;
  for (const w of rules.excluded) if (t.includes(compact(w))) return false;
  // Both on the title without spaces: "complete in box" and "箱 なし" are written spaced too.
  if (rules.boxed && (!BOXED.test(t) || INCOMPLETE.test(t))) return false;
  return true;
}

/** A stored or new sale's title and category as its source reads them (`Collector.saleText`, S36 A1). */
export interface SaleText {
  title: string | null;
  /** The source's category id, as text; null when the sale does not say. */
  category: string | null;
}

/**
 * Whether a sale fails the item's rules (S36 A1): its title fails `titlePasses`, or its category is
 * known and is not the console's category at `source` (compared for equality; a sale without a
 * category, or a console without one there, is judged on the title only). The one judgment: the
 * collect's marks (`@tora/collector-sdk` game-rules) and the registration check's preview use it.
 */
export function failsRules(text: SaleText, rules: EffectiveRules, source: string): boolean {
  if (!titlePasses(text.title, rules)) return true;
  const want = rules.categories[source];
  return !!want && text.category != null && text.category !== want;
}

// ---------------------------------------------------------------------------------------------
// Samples of a check (S36 A1, A2, B1: the 20 cheapest and the 20 nearest the median)

/** Entries per sample set (S36 A1: "the 20 cheapest ... and the 20 nearest in price to the median"). */
export const CHECK_SAMPLE_SIZE = 20;

interface Priced {
  price: number;
  source: string;
  ref: string;
}
const cmpText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const byPrice = (a: Priced, b: Priced) =>
  a.price - b.price || cmpText(a.source, b.source) || cmpText(a.ref, b.ref);

/** The `n` cheapest (ties by source and ref, so a sample is the same each time). */
export function cheapestOf<T extends Priced>(rows: readonly T[], n = CHECK_SAMPLE_SIZE): T[] {
  return rows.toSorted(byPrice).slice(0, n);
}

/**
 * The `n` nearest in price to the median of `rows` (all of them when fewer than `n`); ties by price,
 * then source and ref.
 */
export function nearestMedianOf<T extends Priced>(rows: readonly T[], n = CHECK_SAMPLE_SIZE): T[] {
  if (rows.length <= n) return [...rows];
  const mid = median(rows.map((r) => r.price))!;
  return rows
    .toSorted((a, b) => Math.abs(a.price - mid) - Math.abs(b.price - mid) || byPrice(a, b))
    .slice(0, n);
}

// ---------------------------------------------------------------------------------------------
// Classes of a sale (the dry run's, moved unchanged)

export const GAME_SALE_CLASSES = [
  'game',
  'goods',
  'book',
  'bonus',
  'bundle',
  'edition',
  'incomplete',
  'unknown',
] as const;
export type GameSaleClass = (typeof GAME_SALE_CLASSES)[number];

export interface GameRef {
  name: string;
  alias?: string | null;
  platform?: string | null;
}

/**
 * The title without the game's own name words, so a word that is part of the name ("2セット" in a set's name,
 * "+" in "ベスト+") is not read as a rule word. Words of 2 or more characters, longest first.
 */
export function withoutName(title: string, game: GameRef): string {
  const words = normalizeTitle(`${game.name} ${game.alias ?? ''}`)
    .split(' ')
    .filter((w) => w.length >= 2)
    .toSorted((a, b) => b.length - a.length);
  let t = normalizeTitle(title);
  for (const w of words) t = t.split(w).join(' ');
  return t.replace(/\s+/g, ' ').trim();
}

// The words, by class. Each list is what a seller writes for that thing; matched on the normalized title
// without the game's name words.
/** Goods sharing the game's name: figures, plush, charms, stands, clothing, stickers, food toys, cards, music. */
export const GOODS_WORDS =
  /フィギュア|figure|ぬいぐるみ|マスコット|キーホルダー|キーリング|キーチェーン|ストラップ|チャーム|アクリル|アクスタ|缶バッジ|缶バッチ|バッジ|ピンズ|ステッカー|シール|tシャツ|パーカー|トレーナー|靴下|ソックス|キャップ|帽子|レインコート|ジャケット|タオル|ハンカチ|クリアファイル|ポスター|タペストリー|マグカップ|コップ|グラス|クッション|ブランケット|ポーチ|リュック|バッグ|トート|財布|ペンケース|文房具|色紙|食玩|チョコエッグ|ガチャ|カプセルトイ|一番くじ|プライズ|amiibo|アミーボ|トレカ|トレーディングカード|ポケモンカード|ポケカ|カードダス|サウンドトラック|サントラ|オリジナルサウンド|ジオラマ|プラモデル|ソフビ|ねんどろいど|figma|時計|ランプ|ライト|コントローラー|プロコン|ジョイコン|joy-con|キャリングケース|収納ケース|保護フィルム|スキンシール|ポストカード|ブロマイド/;
/** Books: guides, art books, manga, novels, magazines. */
export const BOOK_WORDS =
  /攻略本|攻略ガイド|ガイドブック|公式ガイド|完全ガイド|ザ・コンプリート|設定資料|資料集|アートブック|art ?book|ファンブック|画集|コミック|漫画|マンガ|小説|ノベライズ|アンソロジー|ムック|雑誌|\d+巻|全巻|ビジュアルブック|パーフェクトガイド|マスターガイド/;
/** A bonus card or code sold alone: pre-order and early-purchase bonuses, serial codes, promo cards. */
export const BONUS_WORDS =
  /特典|早期購入|予約購入|購入者限定|シリアル|プロダクトコード|プロモカード|プロモ|コードのみ|未使用コード|ダウンロードカード|配布/;
/** A bonus that comes with the game, not instead of it: "特典付き", "特典あり", "おまけ付き". */
const WITH_BONUS = /特典付|特典あり|特典有|特典つき|おまけ付|おまけつき|付き|付属|同梱特典/;
/** A word that says the software itself is in the lot (with a goods or book word: game plus extra). */
const SOFTWARE = /ソフト(?!ビ|ビニール)|カセット|カートリッジ|ディスク|パッケージ版|パッケージ/;
/** More than one game, or the game with a console. */
export const BUNDLE_WORDS =
  /まとめ|まとめ売り|セット売り|詰め合わせ|福袋|大量|本体|同梱版|(?<!\d)([2-9]|\d{2,})\s*(本|点|作品|タイトル|枚|個)(?![体格物])|他\s*\d|[+&]\s*\S|セット/;
/** Another edition or platform: Switch 2 Edition, limited and collector's editions, downloads, imports, best. */
export const EDITION_WORDS =
  /switch ?2|スイッチ ?2|nintendo switch 2 edition|ダウンロード版|dl版|ダウンロードコード|dlコード|限定版|コレクターズ|collector|特装版|豪華版|プレミアムボックス|プレミアムパック|数量限定|初回限定|初回生産|限定セット|海外版|北米版|欧州版|アジア版|英語版|輸入版|import|ベスト版|廉価版|the best|best price|greatest hits|playstation hits|ハッピープライス/;
/**
 * Part of the game or the game damaged: no case, cartridge alone, junk, case or manual alone. Written
 * without spaces: `titlePasses` tests it on the title without spaces.
 */
export const INCOMPLETE =
  /ソフトのみ|カセットのみ|カートリッジのみ|ディスクのみ|ケースなし|ケース無し|ケース無|箱なし|箱無し|説明書なし|説明書無し|取説なし|ジャンク|動作未確認|動作不良|難あり|訳あり|ケース割れ|ケースのみ|箱のみ|空箱|説明書のみ|パッケージのみ|ソフト単品|裸|読み込み不良/;

/** Platform words a title may name, by the platform Tora stores (`products.platform`, free text). */
export const GAME_PLATFORMS: readonly (readonly [key: string, own: RegExp, word: RegExp])[] = [
  ['switch', /switch|スイッチ/, /switch|スイッチ|(?<![\w])ns(?![\w])/],
  ['ps5', /ps5|playstation 5/, /ps5|プレステ5|playstation ?5/],
  ['ps4', /ps4|playstation 4/, /ps4|プレステ4|playstation ?4/],
  ['3ds', /3ds/, /3ds/],
  ['ds', /^ds$|nintendo ds/, /(?<![\w3])ds(?![\w])/],
  ['gamecube', /gamecube|ゲームキューブ/, /gamecube|ゲームキューブ|(?<![\w])gc(?![\w])/],
  ['n64', /64/, /n64|ニンテンドー ?64|nintendo ?64/],
];

/** The dry run's platform key of a stored platform (null when none or not listed). */
export function gamePlatformKey(platform: string | null | undefined): string | null {
  if (!platform) return null;
  const p = normalizeTitle(platform);
  return GAME_PLATFORMS.find(([, own]) => own.test(p))?.[0] ?? null;
}

/** A title naming another platform and not the game's own (only when the game's platform is known). */
function otherPlatform(t: string, game: GameRef): boolean {
  const own = gamePlatformKey(game.platform);
  if (!own) return false;
  const named = GAME_PLATFORMS.filter(([, , word]) => word.test(t)).map(([key]) => key);
  return named.length > 0 && !named.includes(own);
}

/**
 * Yahoo's category path (raw.category): a sale outside "ゲーム > テレビゲーム" is not software. Its book
 * categories (攻略本, 本、雑誌, コミック) are books; any other category is goods. No path: the title decides.
 */
export function gameClassOfCategory(
  path: readonly string[] | null | undefined,
): GameSaleClass | null {
  if (!path?.length) return null;
  if (path[0] === 'ゲーム' && path[1] === 'テレビゲーム') return null;
  const joined = path.join('>');
  if (/攻略本|本、雑誌|コミック|雑誌|書籍/.test(joined)) return 'book';
  return 'goods';
}

/**
 * One sale's class, from its title and the game. The order decides overlaps:
 * 1. unknown: no title.
 * 2. Yahoo's category, when it says the sale is not software.
 * 3. goods or book words: with a software word too, the lot is the game plus something (bundle); with a
 *    "comes with" word and a software word, the game with a bonus (read on, as the game).
 * 4. a bonus word without "comes with": the bonus alone.
 * 5. bundle (several games, a console, a set).
 * 6. another edition or platform.
 * 7. incomplete.
 * 8. otherwise the game.
 */
export function classifyGameSale(
  title: string | null | undefined,
  game: GameRef,
  category?: readonly string[] | null,
): GameSaleClass {
  if (!title || !normalizeTitle(title)) return 'unknown';
  const byCategory = gameClassOfCategory(category);
  if (byCategory) return byCategory;
  const t = withoutName(title, game);
  const soft = SOFTWARE.test(t);
  const withBonus = WITH_BONUS.test(t);
  const goods = GOODS_WORDS.test(t);
  const book = BOOK_WORDS.test(t);
  if ((goods || book) && !(soft && withBonus)) {
    if (soft) return 'bundle';
    return goods ? 'goods' : 'book';
  }
  if (BONUS_WORDS.test(t) && !withBonus) return 'bonus';
  if (BUNDLE_WORDS.test(t)) return 'bundle';
  if (EDITION_WORDS.test(t) || otherPlatform(t, game)) return 'edition';
  if (INCOMPLETE.test(t)) return 'incomplete';
  return 'game';
}

// ---------------------------------------------------------------------------------------------
// Checks (stored in `item_checks`, append-only)

/** What a check judged: an item's sales (all sources, source '') or its listings at one source. */
export const ITEM_CHECK_KINDS = ['sales', 'listings'] as const;
export type ItemCheckKind = (typeof ITEM_CHECK_KINDS)[number];
export const ITEM_CHECK_OUTCOMES = ['passed', 'failed', 'not_judged', 'confirmed'] as const;
export type ItemCheckOutcome = (typeof ITEM_CHECK_OUTCOMES)[number];
/** Who made the row: the labeled check (A1, A2), a person at the registration check (B1), an admin. */
export const ITEM_CHECK_BY = ['check', 'person', 'admin'] as const;
export type ItemCheckBy = (typeof ITEM_CHECK_BY)[number];

/**
 * The outcomes each maker may write (S36 Terms "Confirmed"; plan section 9 B): the labeled check
 * judges (passed, failed, not judged); a person or an admin confirms or fails. Only an admin's
 * `confirmed` stands over a failure (`failureStands` in `@tora/db` item-rules).
 */
export const ITEM_CHECK_OUTCOMES_BY: Readonly<Record<ItemCheckBy, readonly ItemCheckOutcome[]>> = {
  check: ['passed', 'failed', 'not_judged'],
  person: ['confirmed', 'failed'],
  admin: ['confirmed', 'failed'],
};

/** How a covered span was read (S36 Terms "Covered day"): a read-back (A3), a deep read (B3), a load. */
export const SALE_SPAN_HOWS = ['readback', 'deep', 'load'] as const;
export type SaleSpanHow = (typeof SALE_SPAN_HOWS)[number];
