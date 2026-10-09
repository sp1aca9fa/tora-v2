export type Locale = 'en' | 'ja';

/** Product name in the current locale, falling back to the other language. */
export function displayName(
  product: { nameJa?: string | null; nameEn?: string | null },
  locale: Locale,
): string {
  const ja = product.nameJa?.trim();
  const en = product.nameEn?.trim();
  return (locale === 'ja' ? ja || en : en || ja) ?? '';
}
