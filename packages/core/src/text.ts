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

const ORDER_SOURCES: [RegExp, string][] = [
  [/snkrdunk|スニダン|スニーカーダンク/i, 'snkrdunk'],
  [/mercari|メルカリ/i, 'mercari'],
  [/amazon|アマゾン/i, 'amazon'],
  [/yahoo|ヤフオク|paypay/i, 'yahoo'],
  [/surugaya|駿河屋/i, 'surugaya'],
];

/**
 * Order source key from the free-text "acquired from" (e.g. "SNKRDUNK", "スニダン" -> snkrdunk),
 * so order / transaction IDs of manual entries and imports are compared in one namespace.
 */
export function orderSourceOf(acquiredFrom: string | null | undefined): string | null {
  const text = acquiredFrom?.normalize('NFKC').trim();
  if (!text) return null;
  return ORDER_SOURCES.find(([re]) => re.test(text))?.[1] ?? text.toLowerCase();
}

/** Marketplaces where one transaction ID is exactly one item (so an ID may be registered once). */
export const SINGLE_ITEM_ORDER_SOURCES = ['snkrdunk', 'mercari', 'yahoo'];
