/** Median of a list (mean of the two middle values for even counts); null when empty. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = values.toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export interface ParsedSourceUrl {
  source: string;
  externalId: string;
  url: string;
}

/**
 * Recognizes a product URL pasted by the user. Only parses the link (no network): the collector
 * on the home PC fetches the data later.
 */
export function parseSourceUrl(input: string): ParsedSourceUrl | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, '');
  const snkrdunk = host === 'snkrdunk.com' && url.pathname.match(/^\/(?:en\/)?apparels\/(\d+)/);
  if (snkrdunk) {
    return {
      source: 'snkrdunk',
      externalId: snkrdunk[1]!,
      url: `https://snkrdunk.com/apparels/${snkrdunk[1]}`,
    };
  }
  return null;
}
