// Product thumbnails (requirements S5c): downloaded by the home PC, served by the web app.
import { toTokyoIso } from '@tora/core';
import { and, eq, inArray, isNotNull, isNull, ne, or } from 'drizzle-orm';
import type { Db } from './client';
import { productImages, products } from './schema';

/** Products with an image URL but no stored thumbnail for it (new, or the URL changed). */
export async function productsNeedingImages(
  db: Db,
  limit = 30,
): Promise<{ id: string; imageUrl: string }[]> {
  const rows = await db
    .select({ id: products.id, imageUrl: products.imageUrl })
    .from(products)
    .leftJoin(productImages, eq(productImages.productId, products.id))
    .where(
      and(
        isNotNull(products.imageUrl),
        or(isNull(productImages.productId), ne(productImages.sourceUrl, products.imageUrl)),
      ),
    )
    .limit(limit);
  return rows.filter((r): r is { id: string; imageUrl: string } => Boolean(r.imageUrl));
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
      set: { ...rest, updatedAt: toTokyoIso() },
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

/** Sets a product's image URL when it has none (the linked listing's picture). */
export async function setProductImageUrlIfMissing(
  db: Db,
  productId: string,
  imageUrl: string,
): Promise<void> {
  await db
    .update(products)
    .set({ imageUrl })
    .where(and(eq(products.id, productId), isNull(products.imageUrl)));
}
