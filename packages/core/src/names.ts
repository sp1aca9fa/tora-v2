export type Locale = 'en' | 'ja';

/** Product display name. Products have one name (in the language they are sold under). */
export function displayName(product: { name?: string | null }): string {
  return product.name?.trim() ?? '';
}
