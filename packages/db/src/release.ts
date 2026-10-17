// Release dates and similar items (requirements S9 part 3): items are linked to the set catalog
// from the set code or name they have (unsure links are suggested on Actions), take the set's
// release date (else their own, else their first collected sale), and are grouped with similar
// items for the new-set pattern.
import { and, eq, inArray, isNull, min, ne, sql } from 'drizzle-orm';
import type { Db } from './client';
import { fileSuggestion } from './suggestions';
import {
  type Product,
  type TcgSet,
  priceDays,
  products,
  suggestions,
  tcgSets,
  users,
} from './schema';

/** Set code for comparison: "sv2a" and "SV2A" are the same code. */
export function setCodeKey(code: string | null | undefined): string | null {
  const c = code?.normalize('NFKC').toUpperCase().replace(/\s+/g, '');
  return c || null;
}

/**
 * Set name for comparison: width-normalized, lowercase, without the pack words, brackets, a
 * reading or nickname in parentheses, spaces and middle dots ("強化拡張パック「ポケモンカード151
 * (イチゴーイチ)」" is "ポケモンカード151").
 */
export function setNameKey(name: string | null | undefined): string | null {
  const n = name
    ?.normalize('NFKC')
    .toLowerCase()
    .replace(/[(][^()]*[)]/g, '')
    .replace(/^(強化|ハイクラス)?(拡張)?パック/, '')
    .replace(/[「」『』"\s・·]+/g, '');
  return n || null;
}

/** The set types an item of this kind can come from, best first. */
function setTypesFor(kind: string): TcgSet['setType'][] {
  if (kind === 'single') return ['expansion', 'special', 'deck'];
  if (kind === 'booster_box' || kind === 'booster_pack') return ['expansion', 'special'];
  if (kind === 'deck') return ['deck'];
  if (kind === 'special_set') return ['special'];
  return [];
}

export interface SetMatch {
  /** Linked without asking: the code and the name agree, or one of them names a single set. */
  sure: TcgSet | null;
  /** Possible sets to confirm on Actions (none when sure). */
  unsure: TcgSet[];
}

/**
 * The catalog set an item comes from, by its set code and name, among the sets of its franchise
 * and language. Sure when the code names one set whose name does not disagree, or the name is
 * exactly one set's (with no other code); a code that names several sets, a name only close
 * (one contains the other) or a code and name that disagree are only suggested.
 */
export function matchSet(
  product: Pick<Product, 'kind' | 'franchise' | 'region' | 'setCode' | 'setName'>,
  sets: TcgSet[],
): SetMatch {
  const none = { sure: null, unsure: [] };
  const types = setTypesFor(product.kind);
  if (!product.franchise || types.length === 0) return none;
  const pool = sets
    .filter(
      (s) =>
        s.franchise === product.franchise &&
        (!s.region || !product.region || s.region === product.region) &&
        types.includes(s.setType),
    )
    .sort((a, b) => types.indexOf(a.setType) - types.indexOf(b.setType));
  const code = setCodeKey(product.setCode);
  const name = setNameKey(product.setName);
  const names = (s: TcgSet) => [setNameKey(s.name), setNameKey(s.nameAlias)].filter(Boolean);
  const sameName = (s: TcgSet) => !!name && names(s).includes(name);
  const closeName = (s: TcgSet) =>
    !!name &&
    name.length >= 3 &&
    names(s).some((n) => n!.length >= 3 && (n!.includes(name) || name.includes(n!)));
  const best = (list: TcgSet[]) => list.filter((s) => s.setType === list[0]?.setType);

  if (code) {
    const byCode = best(pool.filter((s) => setCodeKey(s.code) === code));
    if (byCode.length === 1) {
      const set = byCode[0]!;
      // A name that is clearly another set's: ask.
      if (!name || sameName(set) || closeName(set)) return { sure: set, unsure: [] };
      return { sure: null, unsure: byCode };
    }
    if (byCode.length > 1) {
      const named = byCode.filter(sameName);
      if (named.length === 1) return { sure: named[0]!, unsure: [] };
      return { sure: null, unsure: byCode };
    }
  }
  if (!name) return none;
  const byName = best(pool.filter(sameName));
  // The item's code names no catalog set: a set with another code is only a guess.
  const codeAgrees = (s: TcgSet) => !code || !s.code;
  if (byName.length === 1 && codeAgrees(byName[0]!)) return { sure: byName[0]!, unsure: [] };
  if (byName.length) return { sure: null, unsure: byName.slice(0, 3) };
  // A code the catalog does not have (a promo's "SV-P"): a close name is no clue.
  if (code) return none;
  return { sure: null, unsure: best(pool.filter(closeName)).slice(0, 3) };
}

/**
 * Links items without a set to the catalog (all, or the ones given): sure matches at once (only
 * the link: the item's own set name and code stay, so searches do not change), unsure ones as a
 * `link_set` suggestion per possible set, to the person who made the item, else to the admins.
 */
export async function linkSets(
  db: Db,
  productIds?: string[],
): Promise<{ linked: number; suggested: number }> {
  if (productIds?.length === 0) return { linked: 0, suggested: 0 };
  const items = await db
    .select()
    .from(products)
    .where(
      and(
        eq(products.category, 'tcg'),
        isNull(products.setId),
        productIds ? inArray(products.id, productIds) : undefined,
      ),
    );
  if (items.length === 0) return { linked: 0, suggested: 0 };
  const franchises = [...new Set(items.map((p) => p.franchise).filter((f) => f !== null))];
  if (franchises.length === 0) return { linked: 0, suggested: 0 };
  const sets = await db.select().from(tcgSets).where(inArray(tcgSets.franchise, franchises));
  let admins: string[] | null = null;
  let linked = 0;
  let suggested = 0;
  for (const p of items) {
    const match = matchSet(p, sets);
    if (match.sure) {
      await db
        .update(products)
        .set({ setId: match.sure.id })
        .where(and(eq(products.id, p.id), isNull(products.setId)));
      linked++;
      continue;
    }
    if (match.unsure.length === 0) continue;
    admins ??= (await db.select({ id: users.id }).from(users).where(eq(users.role, 'admin'))).map(
      (u) => u.id,
    );
    const people = p.createdBy ? [p.createdBy] : admins;
    for (const userId of people) {
      for (const set of match.unsure) {
        const filed = await fileSuggestion(db, {
          userId,
          kind: 'link_set',
          targetKey: `${p.id}|${set.id}`,
          productId: p.id,
          payload: { setId: set.id },
          reason: 'set',
          evidence: {
            before: { setName: p.setName, setCode: p.setCode },
            set: {
              name: set.name,
              code: set.code,
              releaseDate: set.releaseDate,
              setType: set.setType,
            },
          },
        });
        if (filed) suggested++;
      }
    }
  }
  return { linked, suggested };
}

/** Links an item to a catalog set (an accepted suggestion); the other sets offered are closed. */
export async function linkProductSet(db: Db, productId: string, setId: string): Promise<boolean> {
  const [set] = await db.select({ id: tcgSets.id }).from(tcgSets).where(eq(tcgSets.id, setId));
  if (!set) return false;
  await db.update(products).set({ setId }).where(eq(products.id, productId));
  await db
    .update(suggestions)
    .set({ status: 'closed' })
    .where(
      and(
        eq(suggestions.productId, productId),
        eq(suggestions.kind, 'link_set'),
        eq(suggestions.status, 'open'),
        ne(suggestions.targetKey, `${productId}|${setId}`),
      ),
    );
  return true;
}

export type ReleaseFrom = 'set' | 'item' | 'first_sale';

/** When an item came out: its catalog set's date, else its own, else its first collected sale. */
export async function releaseDates(
  db: Db,
  items: Pick<Product, 'id' | 'setId' | 'releaseDate'>[],
): Promise<Map<string, { date: string; from: ReleaseFrom }>> {
  const out = new Map<string, { date: string; from: ReleaseFrom }>();
  const setIds = [...new Set(items.map((p) => p.setId).filter((s) => s !== null))];
  const sets = new Map(
    setIds.length
      ? (
          await db
            .select({ id: tcgSets.id, date: tcgSets.releaseDate })
            .from(tcgSets)
            .where(inArray(tcgSets.id, setIds))
        ).map((s) => [s.id, s.date])
      : [],
  );
  const rest: string[] = [];
  for (const p of items) {
    const set = p.setId ? sets.get(p.setId) : null;
    if (set) out.set(p.id, { date: set, from: 'set' });
    else if (p.releaseDate) out.set(p.id, { date: p.releaseDate.slice(0, 10), from: 'item' });
    else rest.push(p.id);
  }
  for (let i = 0; i < rest.length; i += 500) {
    const rows = await db
      .select({ id: priceDays.productId, first: min(priceDays.day) })
      .from(priceDays)
      .where(
        and(inArray(priceDays.productId, rest.slice(i, i + 500)), sql`${priceDays.prices} <> '[]'`),
      )
      .groupBy(priceDays.productId);
    for (const r of rows) {
      if (r.first) out.set(r.id, { date: r.first.slice(0, 10), from: 'first_sale' });
    }
  }
  return out;
}

/** A platform for comparison: "Nintendo Switch" is "switch", "PlayStation 5" is "ps5". */
export function platformKey(platform: string | null | undefined): string | null {
  const p = platform
    ?.normalize('NFKC')
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
    .replace(/^nintendo(?=.)/, '')
    .replace(/^playstation/, 'ps')
    .replace(/^ニンテンドー/, '')
    .replace(/^スイッチ/, 'switch');
  return p || null;
}

/**
 * The group an item is compared with (S9): cards and sealed products by kind, franchise and
 * language; games by kind and platform; other categories by kind. Null when what decides the
 * group is missing.
 */
export function similarKey(
  p: Pick<Product, 'category' | 'kind' | 'franchise' | 'region' | 'platform'>,
): string | null {
  if (p.category === 'tcg') {
    return p.franchise && p.region ? `tcg|${p.kind}|${p.franchise}|${p.region}` : null;
  }
  if (p.category === 'game') {
    const platform = platformKey(p.platform);
    return platform ? `game|${p.kind}|${platform}` : null;
  }
  return `${p.category}|${p.kind}`;
}

/**
 * Every item similar to this one (itself left out), from every person's items: owned, watched or
 * not. Its group's later rules decide which have enough history to count.
 */
export async function similarProducts(db: Db, product: Product): Promise<Product[]> {
  const key = similarKey(product);
  if (!key) return [];
  const rows = await db
    .select()
    .from(products)
    .where(
      and(
        eq(products.category, product.category),
        eq(products.kind, product.kind),
        ne(products.id, product.id),
      ),
    );
  return rows.filter((p) => similarKey(p) === key);
}
