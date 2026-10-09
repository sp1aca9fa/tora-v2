/** Lowercased, width-normalized tokens (Japanese runs are kept whole). */
export function tokens(text: string): string[] {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .split(/[\s・「」『』【】()[\]（）\-/:&,.!?、。]+/)
    .filter((t) => t.length > 0);
}

/**
 * Share of the wanted terms found in a candidate title (0-1). A term matches when it is a token
 * of the title or (for Japanese words) contained in it.
 */
export function termCoverage(wanted: string[], title: string): number {
  const terms = [...new Set(wanted.flatMap(tokens))];
  if (terms.length === 0) return 0;
  const normalized = title.normalize('NFKC').toLowerCase();
  const titleTokens = new Set(tokens(title));
  const hits = terms.filter((t) => titleTokens.has(t) || normalized.includes(t));
  return hits.length / terms.length;
}
