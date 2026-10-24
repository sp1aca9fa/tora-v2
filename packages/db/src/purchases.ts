// Lookups for importing marketplace purchases (requirements S5b): the user's holdings to check
// for duplicates, and products already linked to a marketplace listing.
import { and, eq, isNull } from 'drizzle-orm';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { Db } from './client';
import { type Holding, type Product, holdings, productSources, products } from './schema';

/** All of the user's holdings with their product (any status: a sold item was still bought). */
export async function holdingsWithProducts(
  db: Db,
  userId: string,
): Promise<{ holding: Holding; product: Product }[]> {
  return db
    .select({ holding: holdings, product: products })
    .from(holdings)
    .innerJoin(products, eq(products.id, holdings.productId))
    .where(eq(holdings.userId, userId))
    .orderBy(holdings.createdAt);
}

/** Every listing of `source` linked to a product (receipts are matched by listing ID or title). */
export async function listingsOf(
  db: Db,
  source: string,
): Promise<{ externalId: string | null; title: string | null; product: Product }[]> {
  return db
    .select({
      externalId: productSources.externalId,
      title: productSources.title,
      product: products,
    })
    .from(productSources)
    .innerJoin(products, eq(products.id, productSources.productId))
    .where(eq(productSources.source, source))
    .orderBy(productSources.createdAt);
}

/**
 * A product name without what shops write differently: spaces, 「」 brackets, ボックス for BOX
 * (Pokemon Center's "拡張パック ステラミラクル BOX" is SNKRDUNK's "拡張パック「ステラミラクル」ボックス").
 */
export const looseName = (name: string) =>
  name
    .normalize('NFKC')
    .replace(/ボックス/g, 'BOX')
    .replace(/[\s「」『』"']/g, '')
    .toLowerCase();

/**
 * A shared product with the same name, kind and card identity, to avoid creating it twice; else
 * one with the same loose name, whatever its set code when the input has none (a shop's name
 * without the set code is still that product).
 */
type SameInput = Pick<Product, 'name' | 'kind'> & Partial<Pick<Product, 'setCode' | 'cardNumber'>>;

/** The first of `rows` (oldest first) that is the same item: the same name, else a loose match. */
function pickSame(rows: Product[], input: SameInput): Product | null {
  const loose = looseName(input.name);
  return (
    rows.find((p) => p.name === input.name && !p.setCode === !input.setCode) ??
    rows.find((p) => looseName(p.name) === loose) ??
    null
  );
}

export async function findSameProduct(db: Db, input: SameInput): Promise<Product | null> {
  const same = (column: AnySQLiteColumn, value: string | null | undefined) =>
    value ? eq(column, value) : isNull(column);
  const rows = await db
    .select()
    .from(products)
    .where(
      and(
        eq(products.kind, input.kind),
        input.setCode ? same(products.setCode, input.setCode) : undefined,
        same(products.cardNumber, input.cardNumber),
      ),
    )
    .orderBy(products.createdAt);
  return pickSame(rows, input);
}

/**
 * `findSameProduct` for many rows of one file (S15: a 5,000-row sheet read every item of a kind
 * once per row): each kind and card number is read once and its items found by name; `add` takes
 * the items the file creates.
 */
export function sameProductFinder(db: Db) {
  const groups = new Map<string, Promise<Map<string, Product[]>>>();
  const groupKey = (p: Pick<Product, 'kind'> & Partial<Pick<Product, 'cardNumber'>>) =>
    `${p.kind}\u0000${p.cardNumber ?? ''}`;
  const index = (byName: Map<string, Product[]>, p: Product) => {
    for (const k of new Set([p.name, `\u0000${looseName(p.name)}`]))
      byName.set(k, [...(byName.get(k) ?? []), p]);
  };
  const load = (input: SameInput) => {
    const key = groupKey(input);
    let group = groups.get(key);
    if (!group) {
      group = db
        .select()
        .from(products)
        .where(
          and(
            eq(products.kind, input.kind),
            input.cardNumber
              ? eq(products.cardNumber, input.cardNumber)
              : isNull(products.cardNumber),
          ),
        )
        .orderBy(products.createdAt)
        .then((rows) => {
          const byName = new Map<string, Product[]>();
          for (const p of rows) index(byName, p);
          return byName;
        });
      groups.set(key, group);
    }
    return group;
  };
  return {
    async find(input: SameInput): Promise<Product | null> {
      const byName = await load(input);
      const rows = [
        ...new Set([
          ...(byName.get(input.name) ?? []),
          ...(byName.get(`\u0000${looseName(input.name)}`) ?? []),
        ]),
      ]
        .filter((p) => !input.setCode || p.setCode === input.setCode)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return pickSame(rows, input);
    },
    async add(product: Product) {
      const group = groups.get(groupKey(product));
      if (group) index(await group, product);
    },
  };
}
