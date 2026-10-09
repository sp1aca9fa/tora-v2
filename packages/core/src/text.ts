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
