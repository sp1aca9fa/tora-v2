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
