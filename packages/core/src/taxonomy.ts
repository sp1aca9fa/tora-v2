// Product taxonomy: category -> kind, franchise, region (requirements section 5, products).
import { hasJapanese } from './text';

export const CATEGORIES = ['tcg', 'game'] as const;
export type Category = (typeof CATEGORIES)[number];

export const TCG_KINDS = [
  'single',
  'booster_box',
  'booster_pack',
  'deck',
  'special_set',
  'supply',
  'other',
] as const;
export const GAME_KINDS = [
  'software',
  'collectors_edition',
  'amiibo',
  'controller',
  'figure',
  'console',
  'other',
] as const;
export const PRODUCT_KINDS = [
  'single',
  'booster_box',
  'booster_pack',
  'deck',
  'special_set',
  'supply',
  'software',
  'collectors_edition',
  'amiibo',
  'controller',
  'figure',
  'console',
  'other',
] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];

export function kindsFor(category: Category): readonly ProductKind[] {
  return category === 'tcg' ? TCG_KINDS : GAME_KINDS;
}

/** TCG franchises with a pre-registered set catalog. Others are free text. */
export const TCG_FRANCHISES = ['pokemon', 'one_piece', 'yugioh', 'mtg'] as const;
export type TcgFranchise = (typeof TCG_FRANCHISES)[number];

export const TCG_REGIONS = ['jp', 'en', 'zh_cn', 'zh_tw', 'kr', 'th', 'id', 'other'] as const;
export const GAME_REGIONS = ['jp', 'na', 'eu', 'asia', 'kr', 'other'] as const;
export const REGIONS = [
  'jp',
  'en',
  'na',
  'eu',
  'asia',
  'kr',
  'zh_cn',
  'zh_tw',
  'th',
  'id',
  'other',
] as const;
export type Region = (typeof REGIONS)[number];

export function regionsFor(category: Category): readonly Region[] {
  return category === 'tcg' ? TCG_REGIONS : GAME_REGIONS;
}

export const SET_TYPES = ['expansion', 'deck', 'special'] as const;
export type SetType = (typeof SET_TYPES)[number];

/** How a product is valued and what condition fields it has. */
export type ProductClass = 'card' | 'sealed' | 'item';

export const SEALED_KINDS: readonly ProductKind[] = [
  'booster_box',
  'booster_pack',
  'deck',
  'special_set',
];

export function productClass(product: { category: Category; kind: ProductKind }): ProductClass {
  if (product.category !== 'tcg') return 'item';
  if (product.kind === 'single') return 'card';
  return SEALED_KINDS.includes(product.kind) ? 'sealed' : 'item';
}

/** Sealed kinds that make sense for a catalog set of this type. */
export function kindsForSetType(setType: SetType): ProductKind[] {
  switch (setType) {
    case 'expansion':
      return ['booster_box', 'booster_pack'];
    case 'deck':
      return ['deck'];
    case 'special':
      return ['special_set', 'booster_box', 'booster_pack'];
  }
}

const SUFFIX: Record<string, { ja: string; en: string }> = {
  booster_box: { ja: 'BOX', en: 'Booster Box' },
  booster_pack: { ja: 'パック', en: 'Booster Pack' },
};

/**
 * Name for a sealed product generated from a catalog set, in the set name's language:
 * "バトルパートナーズ BOX", "Bloomburrow Collector Booster Box". Decks and special sets
 * are the set itself.
 */
export function catalogProductName(setName: string, kind: ProductKind, variant?: string | null) {
  const suffix = SUFFIX[kind];
  const v = variant?.trim();
  if (!suffix) return v ? `${setName} (${v})` : setName;
  if (hasJapanese(setName)) return `${setName}${v ? ` ${v}` : ''} ${suffix.ja}`;
  return `${setName}${v ? ` ${v}` : ''} ${suffix.en}`;
}

export type ProductField =
  | 'franchise'
  | 'platform'
  | 'setName'
  | 'setCode'
  | 'variant'
  | 'cardNumber'
  | 'rarity'
  | 'releaseDate'
  | 'retailPriceJpy';

/** Optional product fields shown for a category + kind (name and region are always shown). */
export function productFieldsFor(category: Category, kind: ProductKind): readonly ProductField[] {
  if (category === 'game') return ['franchise', 'platform', 'releaseDate', 'retailPriceJpy'];
  switch (productClass({ category, kind })) {
    case 'card':
      return ['setName', 'setCode', 'cardNumber', 'rarity'];
    case 'sealed':
      return ['setName', 'setCode', 'variant', 'releaseDate', 'retailPriceJpy'];
    default:
      return ['releaseDate', 'retailPriceJpy'];
  }
}

/** Which condition dimensions a holding of this product records. */
export function holdingFieldsFor(cls: ProductClass): {
  condition: boolean;
  packaging: boolean;
  grading: boolean;
} {
  if (cls === 'card') return { condition: false, packaging: false, grading: true };
  if (cls === 'sealed') return { condition: false, packaging: true, grading: false };
  return { condition: true, packaging: true, grading: false };
}

export const PLATFORM_SUGGESTIONS = [
  'Nintendo Switch 2',
  'Nintendo Switch',
  'PlayStation 5',
  'PlayStation 4',
  'Xbox Series X|S',
  'PC',
  'Nintendo 3DS',
  'Wii U',
  'Game Boy',
];

/** One set in the pre-registered catalog (packages/catalog/data/*.json). */
export interface CatalogSetEntry {
  franchise: TcgFranchise;
  region: Region | null;
  code: string | null;
  name: string;
  nameAlias: string | null;
  setType: SetType;
  releaseDate: string | null;
  source: string;
  sourceKey: string;
}
