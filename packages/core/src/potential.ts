// Potential (requirements S32): what a person says they look for in an item. A stated preference:
// tested once and none proved out, so it orders a way's list and tags rows but is never a signal.

export interface PotentialCriteria {
  /** Words looked for in the name and alias. */
  subjects?: string[];
  rarities?: string[];
  /** Marked out of print. */
  outOfPrint?: boolean;
  /** Has a current rank. */
  ranked?: boolean;
}

export const POTENTIAL_SUBJECTS = 10;
export const POTENTIAL_SUBJECT_CHARS = 40;
export const POTENTIAL_RARITIES = 20;

const fold = (text: string) => text.normalize('NFKC').toLowerCase();

/**
 * Criteria from a client: only strings, trimmed, at most 10 words of 40 characters each, a word
 * once whatever its case; only rarities in use (`known`); the switches on only when exactly true.
 */
export function cleanPotential(input: unknown, known: readonly string[]): PotentialCriteria {
  const c = (typeof input === 'object' && input ? input : {}) as Record<string, unknown>;
  const strings = (v: unknown) =>
    Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];
  const seen = new Set<string>();
  const subjects: string[] = [];
  for (const raw of strings(c.subjects)) {
    const word = [...raw.trim()].slice(0, POTENTIAL_SUBJECT_CHARS).join('').trim();
    if (!word || seen.has(fold(word)) || subjects.length === POTENTIAL_SUBJECTS) continue;
    seen.add(fold(word));
    subjects.push(word);
  }
  return {
    subjects,
    rarities: [...new Set(strings(c.rarities).filter((r) => known.includes(r)))].slice(
      0,
      POTENTIAL_RARITIES,
    ),
    outOfPrint: c.outOfPrint === true,
    ranked: c.ranked === true,
  };
}

export const hasPotential = (c: PotentialCriteria | null | undefined): c is PotentialCriteria =>
  !!c && (!!c.subjects?.length || !!c.rarities?.length || !!c.outOfPrint || !!c.ranked);

export type PotentialHit =
  { kind: 'subject' | 'rarity'; value: string } | { kind: 'out_of_print' | 'ranked' };

/**
 * The criteria an item meets, each word and rarity counting as one (as the measure read them); its
 * length is the item's potential. A word matches inside a name ("Cat" also in "Catfish"): names in
 * Japanese have no word breaks. Unknown rarity or mark meets nothing.
 */
export function potentialHits(
  c: PotentialCriteria | null | undefined,
  item: {
    name: string;
    nameAlias?: string | null;
    rarity?: string | null;
    reprint?: 'none' | 'likely' | null;
    ranked: boolean;
  },
): PotentialHit[] {
  if (!c) return [];
  const names = fold(`${item.name}\n${item.nameAlias ?? ''}`);
  return [
    ...(c.subjects ?? [])
      .filter((word) => names.includes(fold(word)))
      .map((value) => ({ kind: 'subject' as const, value })),
    ...(c.rarities ?? [])
      .filter((r) => r === item.rarity)
      .map((value) => ({ kind: 'rarity' as const, value })),
    ...(c.outOfPrint && item.reprint === 'none' ? [{ kind: 'out_of_print' as const }] : []),
    ...(c.ranked && item.ranked ? [{ kind: 'ranked' as const }] : []),
  ];
}
