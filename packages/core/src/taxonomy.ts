// Product taxonomy: category -> kind, franchise, region (requirements section 5, products).
// Categories are the admin's (S16, see categories.ts); these are the built-in templates' keys.
import { hasJapanese } from './text';

/** The built-in categories (others are the admin's, see categories.ts). */
export const CATEGORIES = ['tcg', 'game'] as const;
/** A category's key (built-in or the admin's). */
export type Category = string;

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
/** A kind's key (built-in or the admin's). */
export type ProductKind = string;

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
/**
 * A region key: the built-in ones above, or one an admin added to a category's list (S10), so
 * any string; `categoryDef(...).regions` says which a category takes.
 */
export type Region = string;

export const SET_TYPES = ['expansion', 'deck', 'special'] as const;
export type SetType = (typeof SET_TYPES)[number];

/**
 * An item type (S16): a category's kinds sharing a condition list, with their own roles, source
 * order and identity pages. Built-in: `card` (TCG singles), `sealed`, `item` (TCG other), `game`.
 */
export type ProductClass = string;

export const SEALED_KINDS = ['booster_box', 'booster_pack', 'deck', 'special_set'] as const;

/** An item's type: saved on the item (S16), else worked out from the built-in templates. */
export function productClass(product: {
  category: Category;
  kind: ProductKind;
  itemType?: string | null;
}): ProductClass {
  if (product.itemType) return product.itemType;
  if (product.category === 'game') return 'game';
  if (product.kind === 'single') return 'card';
  return (SEALED_KINDS as readonly string[]).includes(product.kind) ? 'sealed' : 'item';
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
  | 'retailPriceBase';

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
