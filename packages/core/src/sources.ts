// Sources and roles (requirements S8, "bring your own sources"). Plug-in packages describe their
// price sources and the shops purchases come from; collectors save these descriptions to the
// database and the app reads them there. Nothing here names a store: the descriptions do.
import type { CurrencySettings, RateSourceInfo } from './money';
import { type Taxonomy, itemTypes, resolveTaxonomy } from './categories';
import type { LanguageSettings } from './names';
import type { ProductClass } from './taxonomy';

/**
 * What a source is trusted for, per item class: `reference` (valued first; the main source an
 * item should be linked to), `supporting` (valued when the reference has too few sales),
 * `comparison` (shown beside the value, never in it), `off` (not used).
 */
export const SOURCE_ROLES = ['reference', 'supporting', 'comparison', 'off'] as const;
export type SourceRole = (typeof SOURCE_ROLES)[number];
/** Every item type of the admin's categories (S16), in their order. */
export const typesOf = (registry: Pick<SourceRegistry, 'taxonomy'>) =>
  itemTypes(registry.taxonomy ?? resolveTaxonomy(null)).map((t) => t.key);

/** Whether a source collects a category (none declared: the built-in TCG and games). */
export const collects = (source: Pick<SourceInfo, 'categories'>, category: string) =>
  (source.categories ?? ['tcg', 'game']).includes(category);

/** The built-in templates' item types (the registry's taxonomy lists every one, see `itemTypes`). */
export const ITEM_CLASSES: readonly ProductClass[] = ['card', 'sealed', 'item', 'game'];

export interface SourceInfo {
  /** Stored with its data (e.g. on every sale); never changes. */
  key: string;
  label: string;
  /** One or two characters for small badges. */
  badge?: string;
  /** Chart colour (CSS colour). */
  color?: string;
  /** Country of its market (ISO 3166, e.g. "jp") and its currency (ISO 4217). */
  market?: string;
  currency?: string;
  /** What its prices are: sales, asking prices, buy prices. */
  priceKinds?: ('sold' | 'listing' | 'buylist')[];
  /** Suggested role per item type (`card`, `game`, `watch/dial`...); types not listed are off. */
  roles?: Partial<Record<ProductClass, SourceRole>>;
  /**
   * Categories it collects (S16, by key); none: the built-in TCG and games. Price sources lists it
   * under those categories' item types only.
   */
  categories?: string[];
  /** Order among sources of the same role (lower first). */
  priority?: number;
  /**
   * Listing links users paste: a regular expression matched against the link without its
   * protocol and "www." (its first group is the listing ID), and the canonical link with {id}
   * (and {rest} for the expression's second group, when there is one).
   */
  links?: { pattern: string; url: string }[];
  /** Names purchases from this shop show (receipts, screenshots, notes), matched case-blind. */
  aliases?: string[];
  /** Each order holds one item: an order ID is one lot. */
  singleItemOrders?: boolean;
  /**
   * Its order / item IDs: their shape (a regular expression, e.g. read from a screenshot's file
   * name) and how a purchase page shows them (a hint for the import's reader).
   */
  orderIds?: { pattern?: string; hint?: string };
  /**
   * What the data review's model should know about its sales (how its titles read, what a sale
   * without a title is), in English; given with the cases from this source.
   */
  reviewNotes?: string;
  /** A shop purchases come from, not a price source. */
  shopOnly?: boolean;
  /**
   * Item classes it has one stable page per item for: such a page can be an item's identity link
   * (what the item exactly is, to search for it everywhere), whatever its price role.
   */
  identity?: ProductClass[];
  /**
   * Its terms forbid giving its data to AI models: left out of the data review, the MCP tools
   * (Claude) and anything else that would feed it to a model.
   */
  noAi?: boolean;
  /**
   * Its terms allow copies only while needed: listing details kept with a price (`raw.ids`,
   * `raw.listings`) are dropped after this many days; the day's aggregate stays.
   */
  detailsDays?: number;
}

/** Sources whose data may not reach an AI model. */
export const noAiSources = (registry: SourceRegistry) =>
  registry.sources.filter((s) => s.noAi).map((s) => s.key);

/**
 * How a supporting source compares with its class's reference (quality gate): `agrees`,
 * `disagrees` (then valued as comparison only), or `unverified` (too few items both cover).
 */
export interface SourceQuality {
  status: 'agrees' | 'disagrees' | 'unverified';
  /** Items (and conditions) both sources sold enough of. */
  pairs: number;
  /** Median gap with the reference (absolute) and its direction (negative: below), as fractions. */
  gap: number | null;
  bias: number | null;
  /** The reference it was compared with. */
  against: string | null;
  checkedAt: string;
  /** An admin dismissed the notice (kept while it keeps disagreeing). */
  dismissedAt?: string | null;
}

/**
 * The markets the app uses (requirements S11), set by an admin for the whole app: the primary
 * market's sources make the value, the secondary market's give one price to compare with.
 */
export interface MarketSettings {
  primary: string | null;
  secondary: string | null;
  /**
   * Per market and item class, the identity source the admin chose (null: none asked for);
   * not set: the first source declaring it.
   */
  identity?: Record<string, Partial<Record<ProductClass, string | null>>>;
  /** What item pages compare (S16): the primary with the secondary (default) or every market. */
  compare?: 'secondary' | 'all';
  /**
   * Items outside cards and sealed TCG are expected to have their identity link only above this
   * cost, in the base currency's smallest unit (S16). Not set: `IDENTITY_MIN_COST`.
   */
  identityMinCost?: number;
}

/** The default of `MarketSettings.identityMinCost` (¥3,000 when the base is yen). */
export const IDENTITY_MIN_COST = 3000;

/** Markets the sources belong to, best first (by their best source's priority). */
export function marketsOf(sources: SourceInfo[]): string[] {
  return [
    ...new Set(
      sources
        .filter((s) => s.market && !s.shopOnly)
        .toSorted((a, b) => (a.priority ?? 100) - (b.priority ?? 100) || a.key.localeCompare(b.key))
        .map((s) => s.market!),
    ),
  ];
}

/** The settings with what is not set filled in: the first two markets, by their sources. */
export function resolveMarkets(
  sources: SourceInfo[],
  saved: Partial<MarketSettings> | null | undefined,
): MarketSettings {
  const all = marketsOf(sources);
  const primary = saved?.primary && all.includes(saved.primary) ? saved.primary : (all[0] ?? null);
  const secondary =
    saved?.secondary === null
      ? null
      : saved?.secondary && saved.secondary !== primary && all.includes(saved.secondary)
        ? saved.secondary
        : (all.find((m) => m !== primary) ?? null);
  return {
    primary,
    secondary,
    identity: saved?.identity ?? {},
    compare: saved?.compare === 'all' ? 'all' : 'secondary',
    identityMinCost: saved?.identityMinCost ?? IDENTITY_MIN_COST,
  };
}

export interface SourceRegistry {
  sources: SourceInfo[];
  /** The markets (see `MarketSettings`); none: every source counts as one market. */
  markets?: MarketSettings;
  /**
   * Each source's role per class as valuation uses it: its suggestion, or the admin's choice
   * (Settings), with supporting sources that disagree with the reference lowered to comparison.
   */
  roles: Record<string, Partial<Record<ProductClass, SourceRole>>>;
  /** The roles before the quality gate (what the admin set or the plug-in suggested). */
  declared?: Record<string, Partial<Record<ProductClass, SourceRole>>>;
  /** The last quality check per source and class. */
  quality?: Record<string, Partial<Record<ProductClass, SourceQuality>>>;
  /**
   * The admin's order of the sources per class (Settings > Price sources): the order values
   * try sources sharing a role, and item pages list them in. Not listed: the plug-ins' priority.
   */
  order?: SourceOrder;
  /** When a source's description or roles last changed (values saved before are stale). */
  changedAt?: string;
  /** The base currency and where other currencies' rates come from (S16); default: yen. */
  currency?: CurrencySettings;
  /** The rate plug-ins the collectors installed. */
  rateSources?: RateSourceInfo[];
  /** The admin's languages as saved (app_settings `languages`; checked against the installed ones by the app). */
  languages?: Partial<LanguageSettings> | null;
  /** The admin's categories and condition lists (S16; default: the built-in TCG and games). */
  taxonomy?: Taxonomy;
  /** The app's time zone (S16 part 5; default Asia/Tokyo). */
  timeZone?: string;
}

/**
 * A market's currency (its sources'; default: the primary market's, else the base): the
 * currency of the prices valued, other markets' prices are only compared.
 */
export function marketCurrency(
  registry: SourceRegistry,
  market: string | null | undefined = registry.markets?.primary,
): string {
  const source = registry.sources.find((s) => s.currency && !s.shopOnly && inMarket(s, market));
  return source?.currency ?? baseCurrency(registry);
}

/** The currency every amount is stored in. */
export const baseCurrency = (registry: SourceRegistry) => registry.currency?.base ?? 'JPY';

export type SourceOrder = Partial<Record<ProductClass, string[]>>;

export const EMPTY_REGISTRY: SourceRegistry = { sources: [], roles: {} };

/** A supporting source whose sales stray this far from the reference's (median) is not valued. */
export const QUALITY_MAX_GAP = 0.15;
/** Fewer items covered by both than this: not enough to judge. */
export const QUALITY_MIN_PAIRS = 10;

/** Roles as valuation uses them: supporting sources that disagree count as comparison. */
export function effectiveRoles(
  declared: Partial<Record<ProductClass, SourceRole>>,
  quality: Partial<Record<ProductClass, SourceQuality>> | undefined,
): Partial<Record<ProductClass, SourceRole>> {
  return Object.fromEntries(
    Object.entries(declared).map(([cls, role]) => [
      cls,
      role === 'supporting' && quality?.[cls as ProductClass]?.status === 'disagrees'
        ? 'comparison'
        : role,
    ]),
  );
}

export function roleOf(registry: SourceRegistry, key: string, cls: ProductClass): SourceRole {
  return registry.roles[key]?.[cls] ?? 'off';
}

const rank = (role: SourceRole) => SOURCE_ROLES.indexOf(role);

/** Sources by their plug-in's priority (the registry's order). */
export function byPriority(sources: SourceInfo[]): SourceInfo[] {
  return sources.toSorted(
    (a, b) => (a.priority ?? 100) - (b.priority ?? 100) || a.key.localeCompare(b.key),
  );
}

/** Sources in a class's order: the admin's, then the others in the registry's order. */
export function inClassOrder<T extends { key: string }>(
  registry: SourceRegistry,
  cls: ProductClass,
  sources: T[],
): T[] {
  const order = registry.order?.[cls] ?? [];
  const at = (key: string) => {
    const i = order.indexOf(key);
    return i < 0 ? order.length + registry.sources.findIndex((s) => s.key === key) : i;
  };
  return sources.toSorted((a, b) => at(a.key) - at(b.key));
}

/** Sorts sources by their role for a class, in the class's order within a role. */
export function byRole<T extends { key: string }>(
  registry: SourceRegistry,
  cls: ProductClass,
  sources: T[],
): T[] {
  return inClassOrder(registry, cls, sources).toSorted(
    (a, b) => rank(roleOf(registry, a.key, cls)) - rank(roleOf(registry, b.key, cls)),
  );
}

/** Whether a source belongs to a market (no market set: every source does). */
const inMarket = (s: SourceInfo, market: string | null | undefined) =>
  !market || s.market === market;

/**
 * Sources valued for a class in a market (default: the primary one), best first: references,
 * then supporting ones, each in the class's order (the admin's, else the plug-ins' priority).
 */
export function valuationOrder(
  registry: SourceRegistry,
  cls: ProductClass,
  market: string | null | undefined = registry.markets?.primary,
): string[] {
  return byRole(
    registry,
    cls,
    registry.sources.filter((s) => {
      if (!inMarket(s, market)) return false;
      const role = roleOf(registry, s.key, cls);
      return role === 'reference' || role === 'supporting';
    }),
  ).map((s) => s.key);
}

/** The class's main source in a market (its first reference; default: the primary market). */
export function referenceSource(
  registry: SourceRegistry,
  cls: ProductClass,
  market: string | null | undefined = registry.markets?.primary,
): string | null {
  const first = valuationOrder(registry, cls, market)[0];
  return first && roleOf(registry, first, cls) === 'reference' ? first : null;
}

/**
 * Sources whose product pages can be an item's identity link in a market (default: the primary
 * one), the one to look for first: the admin's choice, else those declaring it in the class's order. A
 * link from any of them identifies the item. Empty when the admin chose none.
 */
export function identitySources(
  registry: SourceRegistry,
  cls: ProductClass,
  market: string | null | undefined = registry.markets?.primary,
): string[] {
  const declared = inClassOrder(
    registry,
    cls,
    registry.sources.filter((s) => s.identity?.includes(cls) && inMarket(s, market)),
  ).map((s) => s.key);
  const chosen = market ? registry.markets?.identity?.[market]?.[cls] : undefined;
  if (chosen === null) return [];
  const linkable = registry.sources.some(
    (s) => s.key === chosen && s.links?.length && inMarket(s, market),
  );
  return chosen && linkable ? [chosen, ...declared.filter((k) => k !== chosen)] : declared;
}

/** Sources that can be chosen as a market's identity source: those with product pages. */
export function identityChoices(registry: SourceRegistry, market: string | null): string[] {
  return registry.sources
    .filter((s) => s.links?.length && !s.shopOnly && inMarket(s, market))
    .map((s) => s.key);
}

export function sourceInfo(registry: SourceRegistry, key: string): SourceInfo | undefined {
  return registry.sources.find((s) => s.key === key);
}

/** A source's name for people; its key when it is not described. */
export function sourceName(registry: SourceRegistry, key: string): string {
  return sourceInfo(registry, key)?.label ?? key;
}

/** A pasted listing link: which source, its listing ID and canonical link. Null when unknown. */
export function parseListingUrl(
  registry: SourceRegistry,
  input: string,
): { source: string; externalId: string; url: string } | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const bare = `${url.hostname.replace(/^www\./, '')}${url.pathname}`;
  for (const source of registry.sources) {
    for (const link of source.links ?? []) {
      const m = bare.match(new RegExp(`^${link.pattern}`));
      if (m?.[1]) {
        return {
          source: source.key,
          externalId: m[1],
          url: link.url.replace('{id}', m[1]).replace('{rest}', m[2] ?? ''),
        };
      }
    }
  }
  return null;
}

/** The shop a purchase text names (aliases, case-blind), or null. */
export function shopOf(registry: SourceRegistry, text: string | null | undefined): string | null {
  if (!text) return null;
  const t = text.normalize('NFKC').toLowerCase();
  for (const source of registry.sources) {
    if (
      [source.key, ...(source.aliases ?? [])].some((a) =>
        t.includes(a.normalize('NFKC').toLowerCase()),
      )
    ) {
      return source.key;
    }
  }
  return null;
}
