// Set lines (S9, decision log 2026-10-18): a set's place in its franchise's releases. Group
// studies (the new-set pattern, the new-release wait, the market) use the item's line when it has
// enough items. The list is an admin setting; these four are built in.
export const SET_LINES = ['main', 'sub', 'high_class', 'special'] as const;
export type BuiltInLine = (typeof SET_LINES)[number];

/**
 * The line a Pokemon set's official title or a box's name says: 拡張パック is a main expansion,
 * 強化拡張パック a sub-expansion, ハイクラスパック a high class pack; anniversary and concept
 * packs are special. Null when the title says none of these.
 */
export function lineFromTitle(title: string | null | undefined): BuiltInLine | null {
  const t = title?.normalize('NFKC');
  if (!t || !/パック/.test(t)) return null;
  if (
    /anniversary|celebration|周年|記念|コンセプトパック|スペシャルパック|チャンピオンパック/i.test(
      t,
    )
  ) {
    return 'special';
  }
  if (/ハイクラスパック/.test(t)) return 'high_class';
  if (/強化拡張パック/.test(t)) return 'sub';
  if (/拡張パック/.test(t)) return 'main';
  return null;
}

/**
 * A group study on the item's line when it has enough items, else on the whole group; the result
 * says which (`line` null: the whole group).
 */
export function byLine<T extends { line: string | null }, R extends object>(
  line: string | null,
  items: T[],
  study: (items: T[]) => R | null,
): (R & { line: string | null }) | null {
  if (line) {
    const own = study(items.filter((i) => i.line === line));
    if (own) return { ...own, line };
  }
  const all = study(items);
  return all && { ...all, line: null };
}
