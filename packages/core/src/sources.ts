// Sources and roles (requirements S8, "bring your own sources"). Plug-in packages describe their
// price sources and the shops purchases come from; collectors save these descriptions to the
// database and the app reads them there. Nothing here names a store: the descriptions do.
import type { ProductClass } from './taxonomy';

/**
 * What a source is trusted for, per item class: `reference` (valued first; the main source an
 * item should be linked to), `supporting` (valued when the reference has too few sales),
 * `comparison` (shown beside the value, never in it), `off` (not used).
 */
export const SOURCE_ROLES = ['reference', 'supporting', 'comparison', 'off'] as const;
export type SourceRole = (typeof SOURCE_ROLES)[number];
export const ITEM_CLASSES: readonly ProductClass[] = ['card', 'sealed', 'item'];

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
  /** Suggested role per item class; classes not listed are off. */
  roles?: Partial<Record<ProductClass, SourceRole>>;
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
  /** A shop purchases come from, not a price source. */
  shopOnly?: boolean;
}

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

export interface SourceRegistry {
  sources: SourceInfo[];
  /**
   * Each source's role per class as valuation uses it: its suggestion, or the admin's choice
   * (Settings), with supporting sources that disagree with the reference lowered to comparison.
   */
  roles: Record<string, Partial<Record<ProductClass, SourceRole>>>;
  /** The roles before the quality gate (what the admin set or the plug-in suggested). */
  declared?: Record<string, Partial<Record<ProductClass, SourceRole>>>;
  /** The last quality check per source and class. */
  quality?: Record<string, Partial<Record<ProductClass, SourceQuality>>>;
  /** When a source's description or roles last changed (values saved before are stale). */
  changedAt?: string;
}

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

const rank = (role: SourceRole) => (role === 'reference' ? 0 : role === 'supporting' ? 1 : 2);

/** Sources valued for a class, best first: references, then supporting ones, by priority. */
export function valuationOrder(registry: SourceRegistry, cls: ProductClass): string[] {
  return registry.sources
    .filter((s) => {
      const role = roleOf(registry, s.key, cls);
      return role === 'reference' || role === 'supporting';
    })
    .toSorted(
      (a, b) =>
        rank(roleOf(registry, a.key, cls)) - rank(roleOf(registry, b.key, cls)) ||
        (a.priority ?? 100) - (b.priority ?? 100) ||
        a.key.localeCompare(b.key),
    )
    .map((s) => s.key);
}

/** The class's main source (its first reference), which items of the class should be linked to. */
export function referenceSource(registry: SourceRegistry, cls: ProductClass): string | null {
  const first = valuationOrder(registry, cls)[0];
  return first && roleOf(registry, first, cls) === 'reference' ? first : null;
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
