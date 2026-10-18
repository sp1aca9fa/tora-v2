// Product thumbnails (requirements S5c): downloaded by the home PC, served by the web app.
import { type ProductClass, identitySources, productClass, toLocalIso } from '@tora/core';
import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';
import type { Db } from './client';
import { loadSourceRegistry } from './registry';
import { productImages, productSources, products } from './schema';

/** Whether a listing shows the product in one condition only (e.g. a no-shrink box). */
export type VariantListing = (source: string, title: string | null) => boolean;

/**
 * The picture a product should show, the same for everyone (user, 2026-10-18): a confirmed
 * listing's (the user picked it, so it is the right product), first the item type's identity
 * source in its order (SNKRDUNK for cards and sealed, 駿河屋 for games and items: standard product
 * photos), variant listings last; else the product's own image URL (e.g. a seller's photo from a
 * purchase import).
 */
async function wantedImages(db: Db, isVariant: VariantListing): Promise<Map<string, string>> {
  const registry = await loadSourceRegistry(db);
  const orders = new Map<ProductClass, string[]>();
  const orderOf = (cls: ProductClass) => {
    if (!orders.has(cls)) orders.set(cls, identitySources(registry, cls));
    return orders.get(cls)!;
  };
  const best = new Map<string, { rank: number; url: string }>();
  const listings = await db
    .select({
      productId: productSources.productId,
      source: productSources.source,
      title: productSources.title,
      imageUrl: productSources.imageUrl,
      category: products.category,
      kind: products.kind,
      itemType: products.itemType,
    })
    .from(productSources)
    .innerJoin(products, eq(products.id, productSources.productId))
    .where(and(eq(productSources.active, true), isNotNull(productSources.imageUrl)))
    .orderBy(asc(productSources.createdAt));
  for (const l of listings) {
    if (!l.imageUrl) continue;
    const order = orderOf(productClass(l));
    const at = order.indexOf(l.source);
    const rank = (isVariant(l.source, l.title) ? 1000 : 0) + (at < 0 ? order.length : at);
    // Equal ranks: the first linked.
    if ((best.get(l.productId)?.rank ?? Infinity) > rank)
      best.set(l.productId, { rank, url: l.imageUrl });
  }
  const wanted = new Map([...best].map(([id, b]) => [id, b.url]));
  const own = await db
    .select({ id: products.id, imageUrl: products.imageUrl })
    .from(products)
    .where(isNotNull(products.imageUrl));
  for (const p of own) if (p.imageUrl && !wanted.has(p.id)) wanted.set(p.id, p.imageUrl);
  return wanted;
}

/** Products whose wanted picture is not stored yet (new, or the linked listing changed). */
export async function productsNeedingImages(
  db: Db,
  limit = 30,
  isVariant: VariantListing = () => false,
): Promise<{ id: string; imageUrl: string }[]> {
  const wanted = await wantedImages(db, isVariant);
  const stored = new Map(
    (
      await db
        .select({ productId: productImages.productId, sourceUrl: productImages.sourceUrl })
        .from(productImages)
    ).map((r) => [r.productId, r.sourceUrl]),
  );
  return [...wanted]
    .filter(([id, url]) => stored.get(id) !== url)
    .slice(0, limit)
    .map(([id, imageUrl]) => ({ id, imageUrl }));
}

export async function saveProductImage(
  db: Db,
  image: {
    productId: string;
    bytes: Buffer;
    contentType: string;
    width?: number | null;
    height?: number | null;
    sourceUrl: string | null;
  },
): Promise<void> {
  const { productId: _productId, ...rest } = image;
  await db
    .insert(productImages)
    .values(image)
    .onConflictDoUpdate({
      target: productImages.productId,
      set: { ...rest, updatedAt: toLocalIso() },
    });
}

export async function getProductImage(db: Db, productId: string) {
  const [row] = await db.select().from(productImages).where(eq(productImages.productId, productId));
  return row ?? null;
}

/** Product id -> image version (for cache-busting URLs), without loading the bytes. */
export async function imageVersions(db: Db, productIds: string[]): Promise<Map<string, string>> {
  if (productIds.length === 0) return new Map();
  const map = new Map<string, string>();
  for (let i = 0; i < productIds.length; i += 500) {
    const rows = await db
      .select({ productId: productImages.productId, updatedAt: productImages.updatedAt })
      .from(productImages)
      .where(inArray(productImages.productId, productIds.slice(i, i + 500)));
    for (const r of rows) map.set(r.productId, r.updatedAt);
  }
  return map;
}

/**
 * Stored thumbnails of the products already linked to these listings (`source|externalId` ->
 * product id + image version): a suggestion without its own picture can show the linked
 * product's.
 */
export async function linkedListingImages(
  db: Db,
  listings: { source: string; externalId: string }[],
): Promise<Map<string, { productId: string; version: string }>> {
  if (listings.length === 0) return new Map();
  const rows = await db
    .select({
      source: productSources.source,
      externalId: productSources.externalId,
      productId: productImages.productId,
      version: productImages.updatedAt,
    })
    .from(productSources)
    .innerJoin(productImages, eq(productImages.productId, productSources.productId))
    .where(
      and(
        eq(productSources.active, true),
        inArray(
          productSources.externalId,
          listings.map((l) => l.externalId),
        ),
      ),
    );
  const map = new Map<string, { productId: string; version: string }>();
  for (const r of rows) {
    const key = `${r.source}|${r.externalId}`;
    if (listings.some((l) => `${l.source}|${l.externalId}` === key) && !map.has(key)) {
      map.set(key, { productId: r.productId, version: r.version });
    }
  }
  return map;
}
