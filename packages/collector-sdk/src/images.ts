// Downloads product pictures once and stores them as small WebP thumbnails (requirements S5c), so
// the web app serves them itself. Runs on the home PC after the collectors, at the polite pace.
import { type Db, productsNeedingImages, saveProductImage } from '@tora/db';
import sharp from 'sharp';
import { BlockedError, type PoliteHttp, RequestCapError } from './http';

/** Longest side of a stored thumbnail, in pixels. */
export const THUMBNAIL_SIZE = 400;

/** Any image -> WebP of at most THUMBNAIL_SIZE px per side (never enlarged). */
export async function toThumbnail(input: Buffer) {
  const { data, info } = await sharp(input)
    .rotate()
    .resize({
      width: THUMBNAIL_SIZE,
      height: THUMBNAIL_SIZE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: 78 })
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

export async function downloadProductImages(
  db: Db,
  http: PoliteHttp,
  options: { limit?: number; log?: (message: string) => void } = {},
): Promise<{ saved: number; failed: number }> {
  const log = options.log ?? (() => {});
  let saved = 0;
  let failed = 0;
  for (const product of await productsNeedingImages(db, options.limit ?? 30)) {
    if (!/^https:\/\//.test(product.imageUrl)) continue;
    try {
      const { data } = await http.bytes(product.imageUrl);
      const thumb = await toThumbnail(data);
      await saveProductImage(db, {
        productId: product.id,
        bytes: thumb.data,
        contentType: 'image/webp',
        width: thumb.width,
        height: thumb.height,
        sourceUrl: product.imageUrl,
      });
      saved++;
    } catch (error) {
      if (error instanceof BlockedError || error instanceof RequestCapError) throw error;
      failed++;
      log(`image for ${product.id} failed: ${String(error)}`);
    }
  }
  return { saved, failed };
}
