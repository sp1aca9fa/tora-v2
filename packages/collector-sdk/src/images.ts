// Downloads product pictures once and stores them as small WebP thumbnails (requirements S5c), so
// the web app serves them itself. Runs on the home PC after the collectors, at the polite pace.
import { type Db, type VariantListing, productsNeedingImages, saveProductImage } from '@tora/db';
import sharp from 'sharp';
import { BlockedError, type PoliteHttp, RequestCapError, errorText } from './http';

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

/** A source's lock, or null when another run holds it (`lockSourceWaiting`). */
export type SourceLock = (source: string) => Promise<{ release: () => void } | null>;

/**
 * Pictures are a read of the collect ("Refusals"): a site refused today (`leave`) is left out,
 * each site's lock is taken before its first picture (one held by another run waits for the next
 * collect), and a refusal stops the pictures at once (the client sends nothing more) and names
 * the site, which the caller records as a blocked run. A picture on a host several sites share
 * takes every one's lock, and its refusal stops the pictures naming none (which one refused is
 * not known). A picture on a host no listing uses takes no lock and names no site.
 */
export async function downloadProductImages(
  db: Db,
  http: PoliteHttp,
  options: {
    limit?: number;
    log?: (message: string) => void;
    /** Listings never preferred for the picture (the collectors' `variantListing`). */
    isVariant?: VariantListing;
    /** Sources left alone for the rest of the day (a refusal today). */
    leave?: ReadonlySet<string>;
    lock?: SourceLock;
  } = {},
): Promise<{ saved: number; failed: number; blocked: string | null }> {
  const log = options.log ?? (() => {});
  let saved = 0;
  let failed = 0;
  const locks = new Map<string, { release: () => void } | null>();
  const wanted = await productsNeedingImages(
    db,
    options.limit ?? 30,
    options.isVariant,
    options.leave,
  );
  try {
    for (const product of wanted) {
      if (!/^https:\/\//.test(product.imageUrl)) continue;
      const { sources } = product;
      if (options.lock) {
        let held = false;
        for (const source of sources) {
          if (!locks.has(source)) {
            const lock = await options.lock(source);
            locks.set(source, lock);
            if (!lock) log(`${source}: another run is reading it, its pictures wait`);
          }
          if (!locks.get(source)) held = true;
        }
        if (held) continue;
      }
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
        if (error instanceof BlockedError) {
          log(`image for ${product.id}: refused (${errorText(error)}), pictures stopped`);
          // One site: it refused. Several on one host: which one is not known, none is named.
          return { saved, failed, blocked: sources.length === 1 ? sources[0]! : null };
        }
        if (error instanceof RequestCapError) throw error;
        failed++;
        log(`image for ${product.id} failed: ${String(error)}`);
      }
    }
  } finally {
    for (const lock of locks.values()) lock?.release();
  }
  return { saved, failed, blocked: null };
}
