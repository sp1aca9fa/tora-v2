// Products that are evidently the same item (requirements S5c follow-up): a pulled card typed with
// the same name and number as a card already registered reuses it, and a product without a price
// source is offered the listing of a linked look-alike right away, without searching the site.
import { and, eq } from 'drizzle-orm';
import type { Db } from './client';
import { type CandidateInput, saveCandidates } from './sources';
import { type Product, productSources, products } from './schema';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Name for comparison: width-normalized, lowercase, without spaces and middle dots. */
export function sameNameKey(name: string): string {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s・·]+/g, '');
}

/** Card number for comparison: "019/23" and "19 / 23" are the same number. */
export function cardNumberKey(number: string | null | undefined): string | null {
  const n = number?.normalize('NFKC').replace(/\s+/g, '').toUpperCase();
  if (!n) return null;
  return n.replace(/\d+/g, (d) => String(Number(d)));
}

const sameOrUnknown = (a: string | null | undefined, b: string | null | undefined) =>
  !a || !b || a === b;

/**
 * A single card already registered with this name and number (and no conflicting franchise or
 * region). Name and number together: a name alone is too weak (reprints, promos).
 */
export async function findSameCard(
  db: Db | Tx,
  card: Pick<Product, 'name' | 'franchise' | 'region'> & { cardNumber?: string | null },
): Promise<Product | null> {
  const number = cardNumberKey(card.cardNumber);
  if (!number) return null;
  const name = sameNameKey(card.name);
  const rows = await db
    .select()
    .from(products)
    .where(and(eq(products.category, 'tcg'), eq(products.kind, 'single')))
    .orderBy(products.createdAt);
  return (
    rows.find(
      (p) =>
        sameNameKey(p.name) === name &&
        cardNumberKey(p.cardNumber) === number &&
        sameOrUnknown(p.franchise, card.franchise) &&
        sameOrUnknown(p.region, card.region),
    ) ?? null
  );
}

/** Whether two products are evidently the same item (see the file comment). */
function looksSame(a: Product, b: Product): boolean {
  if (a.id === b.id || a.category !== b.category || a.kind !== b.kind) return false;
  if (!sameOrUnknown(a.franchise, b.franchise) || !sameOrUnknown(a.region, b.region)) return false;
  if (a.kind === 'single') {
    const number = cardNumberKey(a.cardNumber);
    if (!number || number !== cardNumberKey(b.cardNumber)) return false;
    const setCode = (p: Product) => p.setCode?.normalize('NFKC').toUpperCase() || null;
    return (
      sameNameKey(a.name) === sameNameKey(b.name) ||
      (setCode(a) !== null && setCode(a) === setCode(b))
    );
  }
  return sameNameKey(a.name) === sameNameKey(b.name);
}

/**
 * Offers a product without an active listing the listings of linked look-alikes, as pending
 * suggestions (shown at once; the site search waits while one is pending). Suggestions the user
 * dismissed stay dismissed. Returns how many new suggestions were added.
 */
export async function suggestFromKnownProducts(
  db: Db,
  productId: string,
  source?: string,
): Promise<number> {
  const [product] = await db.select().from(products).where(eq(products.id, productId));
  if (!product) return 0;
  const own = await db
    .select({ id: productSources.id })
    .from(productSources)
    .where(
      and(
        eq(productSources.productId, productId),
        eq(productSources.active, true),
        source ? eq(productSources.source, source) : undefined,
      ),
    );
  if (own.length) return 0;
  const listings = await db
    .select({ listing: productSources, product: products })
    .from(productSources)
    .innerJoin(products, eq(products.id, productSources.productId))
    .where(
      and(
        eq(productSources.active, true),
        eq(products.category, product.category),
        eq(products.kind, product.kind),
        source ? eq(productSources.source, source) : undefined,
      ),
    );
  const bySource = new Map<string, CandidateInput[]>();
  for (const { listing, product: other } of listings) {
    if (!listing.externalId || !looksSame(product, other)) continue;
    const list = bySource.get(listing.source) ?? [];
    if (list.some((c) => c.externalId === listing.externalId)) continue;
    list.push({
      externalId: listing.externalId,
      title: listing.title ?? other.name,
      url: listing.url,
      imageUrl: listing.imageUrl,
      score: 0.95,
    });
    bySource.set(listing.source, list);
  }
  let added = 0;
  for (const [s, candidates] of bySource)
    added += await saveCandidates(db, productId, s, candidates);
  return added;
}

/** Runs `suggestFromKnownProducts` for several products (e.g. everything still unmatched). */
export async function suggestForProducts(db: Db, productIds: string[], source?: string) {
  let added = 0;
  for (const id of productIds) added += await suggestFromKnownProducts(db, id, source);
  return added;
}
