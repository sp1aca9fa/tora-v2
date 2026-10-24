// Categories (requirements S16 part 3): what kinds of items the app holds, set by the admin.
// Categories, kinds and condition lists are data with stable keys (app_settings `categories`);
// TCG and games are built-in templates in the same format, with today's keys.
import {
  type ProductClass,
  GAME_KINDS,
  GAME_REGIONS,
  type ProductField,
  TCG_KINDS,
  TCG_REGIONS,
  SEALED_KINDS,
} from './taxonomy';

/** Names per language code ("en", "ja"); a missing one falls back (see `pickName`). */
export type Names = Record<string, string>;

export const FIELD_TYPES = ['text', 'number', 'date', 'choice', 'yesno'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/** Fields every category can switch on, stored in their own columns (collectors and search read them). */
export const STANDARD_FIELDS: readonly ProductField[] = [
  'franchise',
  'platform',
  'setName',
  'setCode',
  'variant',
  'cardNumber',
  'rarity',
  'releaseDate',
  'retailPriceBase',
];

const STANDARD_TYPES: Record<ProductField, FieldType | 'amount'> = {
  franchise: 'text',
  platform: 'text',
  setName: 'text',
  setCode: 'text',
  variant: 'text',
  cardNumber: 'text',
  rarity: 'text',
  releaseDate: 'date',
  retailPriceBase: 'amount',
};

export interface FieldDef {
  /** A standard field's key, or a custom field's (lowercase letters, digits, underscores). */
  key: string;
  /** One of STANDARD_FIELDS (stored in its column); otherwise in the item's `fields`. */
  standard?: boolean;
  /** Label; a standard field without one uses the app's text. */
  names?: Names;
  /** Custom fields only (a standard field's type is fixed). */
  type?: FieldType;
  /** A choice field's values, in order. */
  choices?: { key: string; names: Names }[];
  required?: boolean;
  /** Shown on the item page (default: yes). */
  hidden?: boolean;
  /** The kinds it applies to; none: every kind. */
  kinds?: string[];
}

export interface KindDef {
  key: string;
  names?: Names;
  /** Its condition list's key: how lots are described and which prices value them. */
  conditions: string;
  /** Not offered for new items (items already registered keep it). */
  hidden?: boolean;
}

export interface CategoryDef {
  key: string;
  names?: Names;
  /** Not offered for new items; a category with items is hidden instead of deleted. */
  hidden?: boolean;
  kinds: KindDef[];
  fields: FieldDef[];
  /** Region choices (TCG print language, game region); none: no region field. */
  regions?: string[];
  /**
   * Names of the regions the admin added (S10); built-in ones (`REGIONS`) use the app's texts
   * unless named here.
   */
  regionNames?: Record<string, Names>;
  /** TCG: franchise chips and the pre-registered set catalog. */
  setCatalog?: boolean;
}

export interface ConditionValue {
  key: string;
  names: Names;
  /** Values sharing a pool group are valued together when one has too few sales. */
  pool?: string | null;
}

/** A condition list: ready-made (card grades, sealed, item condition) or the admin's own. */
export interface ConditionList {
  key: string;
  names?: Names;
  /** Ready-made: its values and fields are the app's (not editable). */
  builtIn?: boolean;
  /** Best first (the admin's lists). */
  values: ConditionValue[];
}

export interface Taxonomy {
  categories: CategoryDef[];
  /** The admin's own condition lists (ready-made ones are added by `resolveTaxonomy`). */
  lists: ConditionList[];
}

/** Ready-made condition lists; their bucket keys are the app's (`raw:A`, `sealed:shrink`, `cond:new`). */
export const BUILT_IN_LISTS: ConditionList[] = [
  { key: 'card_grades', builtIn: true, values: [] },
  { key: 'sealed', builtIn: true, values: [] },
  { key: 'item_condition', builtIn: true, values: [] },
];
const BUILT_IN_LIST_KEYS = BUILT_IN_LISTS.map((l) => l.key);

/** Bucket prefixes the ready-made lists use: an admin's list key may not be one. */
const RESERVED_LIST_KEYS = [...BUILT_IN_LIST_KEYS, 'raw', 'graded', 'cond'];

const field = (key: ProductField, kinds?: readonly string[]): FieldDef => ({
  key,
  standard: true,
  ...(kinds ? { kinds: [...kinds] } : {}),
});
const TCG_SEALED = [...SEALED_KINDS];
const TCG_OTHER = TCG_KINDS.filter(
  (k) => k !== 'single' && !(SEALED_KINDS as readonly string[]).includes(k),
);

/** The two built-in templates: today's TCG and games, in the categories format. */
export const BUILT_IN_CATEGORIES: CategoryDef[] = [
  {
    key: 'tcg',
    kinds: TCG_KINDS.map((key) => ({
      key,
      conditions:
        key === 'single'
          ? 'card_grades'
          : (SEALED_KINDS as readonly string[]).includes(key)
            ? 'sealed'
            : 'item_condition',
    })),
    fields: [
      field('franchise'),
      field('setName', ['single', ...TCG_SEALED]),
      field('setCode', ['single', ...TCG_SEALED]),
      field('variant', TCG_SEALED),
      field('cardNumber', ['single']),
      field('rarity', ['single']),
      field('releaseDate', [...TCG_SEALED, ...TCG_OTHER]),
      field('retailPriceBase', [...TCG_SEALED, ...TCG_OTHER]),
    ],
    regions: [...TCG_REGIONS],
    setCatalog: true,
  },
  {
    key: 'game',
    kinds: GAME_KINDS.map((key) => ({ key, conditions: 'item_condition' })),
    fields: [field('franchise'), field('platform'), field('releaseDate'), field('retailPriceBase')],
    regions: [...GAME_REGIONS],
  },
];

/** The saved categories with the ready-made lists added; none saved: the built-in templates. */
export function resolveTaxonomy(saved: Partial<Taxonomy> | null | undefined): Taxonomy {
  const categories = saved?.categories?.length ? saved.categories : BUILT_IN_CATEGORIES;
  const own = (saved?.lists ?? []).filter((l) => !RESERVED_LIST_KEYS.includes(l.key));
  return { categories, lists: [...BUILT_IN_LISTS, ...own] };
}

/** Item types of the built-in templates keep today's keys (roles and orders are saved by them). */
const BUILT_IN_TYPES: Record<string, string> = {
  'tcg/card_grades': 'card',
  'tcg/sealed': 'sealed',
  'tcg/item_condition': 'item',
  'game/item_condition': 'game',
};

/**
 * The item type of a category's kinds with a condition list: roles, source order, identity pages
 * and the quality gate are set per item type (S16: per category and condition list).
 */
export const itemTypeKey = (category: string, list: string) =>
  BUILT_IN_TYPES[`${category}/${list}`] ?? `${category}/${list}`;

/** The condition list of an item type. */
export function conditionListOf(itemType: string): string {
  const builtIn = Object.entries(BUILT_IN_TYPES).find(([, t]) => t === itemType)?.[0];
  if (builtIn) return builtIn.split('/')[1]!;
  return itemType.includes('/') ? itemType.slice(itemType.indexOf('/') + 1) : 'item_condition';
}

/** The category of an item type. */
export function categoryOfType(itemType: string): string {
  const builtIn = Object.entries(BUILT_IN_TYPES).find(([, t]) => t === itemType)?.[0];
  return builtIn ? builtIn.split('/')[0]! : itemType.split('/')[0]!;
}

export interface ItemTypeInfo {
  key: string;
  category: string;
  list: string;
  /** The only item type of its category (shown with the category's name alone). */
  alone: boolean;
}

/** Every item type, in the order of categories and their kinds. */
export function itemTypes(taxonomy: Taxonomy): ItemTypeInfo[] {
  const out: ItemTypeInfo[] = [];
  for (const c of taxonomy.categories) {
    const lists = [...new Set(c.kinds.map((k) => k.conditions))];
    for (const list of lists) {
      out.push({ key: itemTypeKey(c.key, list), category: c.key, list, alone: lists.length === 1 });
    }
  }
  return out;
}

/** Bucket -> pool group of the admin's condition lists' values (see `bucketFamily`). */
export type Pools = Record<string, string>;

export function conditionPools(lists: ConditionList[]): Pools {
  const pools: Pools = {};
  for (const l of lists) {
    if (l.builtIn) continue;
    for (const v of l.values) if (v.pool) pools[`${l.key}:${v.key}`] = `${l.key}~${v.pool}`;
  }
  return pools;
}

export const categoryDef = (taxonomy: Taxonomy, key: string) =>
  taxonomy.categories.find((c) => c.key === key);

export const kindDef = (taxonomy: Taxonomy, category: string, kind: string) =>
  categoryDef(taxonomy, category)?.kinds.find((k) => k.key === kind);

export const conditionList = (taxonomy: Taxonomy, key: string) =>
  taxonomy.lists.find((l) => l.key === key);

/** The item type of a kind (null: unknown category or kind). */
export function itemTypeOf(taxonomy: Taxonomy, category: string, kind: string): string | null {
  const k = kindDef(taxonomy, category, kind);
  return k ? itemTypeKey(category, k.conditions) : null;
}

/** The fields an item of a kind has, in the category's order. */
export function fieldsFor(taxonomy: Taxonomy, category: string, kind: string): FieldDef[] {
  return (categoryDef(taxonomy, category)?.fields ?? []).filter(
    (f) => !f.kinds?.length || f.kinds.includes(kind),
  );
}

/**
 * The required fields an item leaves empty (S10): standard ones read from the item, custom ones
 * from its `fields`. Forms and the spreadsheet import refuse such an item; purchase imports keep it.
 */
export function missingFields(
  taxonomy: Taxonomy,
  item: { category: string; kind: string; fields?: Record<string, unknown> | null } & Record<
    string,
    unknown
  >,
): string[] {
  return fieldsFor(taxonomy, item.category, item.kind)
    .filter((f) => f.required)
    .filter((f) => {
      const v = f.standard ? item[f.key] : item.fields?.[f.key];
      return v === undefined || v === null || v === '';
    })
    .map((f) => f.key);
}

/**
 * The catalog sets the admin's categories use (S10): those of a region a set category lists
 * (`setCatalog`), and the ones without a region (the same everywhere, e.g. Magic). None when no
 * category keeps a set catalog (a watches-only setup loads nothing).
 */
export function catalogInUse<T extends { region: string | null }>(
  taxonomy: Taxonomy,
  sets: T[],
): T[] {
  const regions = new Set(
    taxonomy.categories.filter((c) => c.setCatalog && !c.hidden).flatMap((c) => c.regions ?? []),
  );
  const any = taxonomy.categories.some((c) => c.setCatalog && !c.hidden);
  return any ? sets.filter((s) => s.region === null || regions.has(s.region)) : [];
}

/** A standard field's or custom field's value type. */
export const fieldType = (f: FieldDef): FieldType | 'amount' =>
  f.standard ? STANDARD_TYPES[f.key as ProductField] : (f.type ?? 'text');

/** A name in a language, else the first given (`fallback` when there is none). */
export function pickName(names: Names | undefined, locale: string, fallback: string): string {
  return names?.[locale]?.trim() || Object.values(names ?? {}).find((n) => n.trim()) || fallback;
}

/** Keys of what the admin writes: lowercase letters, digits and underscores, starting with a letter. */
export const isKey = (s: string) => /^[a-z][a-z0-9_]{0,39}$/.test(s);

/** Problems with an admin's categories (empty: fine). Codes are for the app's texts. */
export function checkTaxonomy(t: Taxonomy): string[] {
  const problems: string[] = [];
  const listKeys = new Set(t.lists.map((l) => l.key));
  const seen = new Set<string>();
  for (const l of t.lists) {
    if (l.builtIn) continue;
    if (!isKey(l.key) || RESERVED_LIST_KEYS.includes(l.key)) problems.push('list_key');
    if (l.values.length === 0) problems.push('list_empty');
    const values = new Set(l.values.map((v) => v.key));
    if (values.size !== l.values.length || l.values.some((v) => !isKey(v.key))) {
      problems.push('value_key');
    }
  }
  for (const c of t.categories) {
    if (!isKey(c.key) || seen.has(c.key)) problems.push('category_key');
    seen.add(c.key);
    if (c.kinds.length === 0) problems.push('no_kinds');
    const kinds = new Set(c.kinds.map((k) => k.key));
    if (kinds.size !== c.kinds.length || c.kinds.some((k) => !isKey(k.key))) {
      problems.push('kind_key');
    }
    if (c.kinds.some((k) => !listKeys.has(k.conditions))) problems.push('kind_list');
    const regions = c.regions ?? [];
    if (new Set(regions).size !== regions.length || regions.some((r) => !isKey(r))) {
      problems.push('region_key');
    }
    const fields = new Set(c.fields.map((f) => f.key));
    if (
      fields.size !== c.fields.length ||
      c.fields.some((f) =>
        f.standard
          ? !STANDARD_FIELDS.includes(f.key as ProductField)
          : !isKey(f.key) || STANDARD_FIELDS.some((k) => k.toLowerCase() === f.key),
      )
    ) {
      problems.push('field_key');
    }
    if (c.fields.some((f) => f.type === 'choice' && !f.choices?.length)) {
      problems.push('choice_empty');
    }
  }
  return [...new Set(problems)];
}

/**
 * Which condition fields a lot of this item type records: the ready-made lists' fields, or one
 * value of the admin's own list (`value`, its key).
 */
export function holdingFieldsFor(cls: ProductClass): {
  condition: boolean;
  packaging: boolean;
  grading: boolean;
  value: string | null;
} {
  const list = conditionListOf(cls);
  if (list === 'card_grades')
    return { condition: false, packaging: false, grading: true, value: null };
  if (list === 'sealed') return { condition: false, packaging: true, grading: false, value: null };
  if (list === 'item_condition') {
    return { condition: true, packaging: true, grading: false, value: null };
  }
  return { condition: false, packaging: false, grading: false, value: list };
}
