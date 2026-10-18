import { TEST_SOURCES } from '@tora/db/testing';
import {
  type Db,
  createDb,
  createProduct,
  createUser,
  getProductImage,
  linkSource,
  saveSourceInfos,
  schema,
  unlinkSource,
} from '@tora/db';
import { migrateDb } from '@tora/db/migrate';
import { eq } from 'drizzle-orm';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { beforeEach, expect, it } from 'vitest';
import { PoliteHttp } from './http';
import { downloadProductImages } from './images';

let db: Db;
let uid: string;

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-img-'));
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  uid = (await createUser(db, 'a', { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] }))
    .user.id;
  return () => rm(dir, { recursive: true, force: true });
});

it('stores a WebP thumbnail once per image URL', async () => {
  const png = await sharp({
    create: { width: 1200, height: 800, channels: 3, background: '#2a78d6' },
  })
    .png()
    .toBuffer();
  const requested: string[] = [];
  const fetchImpl = (async (url: string) => {
    requested.push(url);
    return new Response(png, { headers: { 'content-type': 'image/png' } });
  }) as unknown as typeof fetch;
  const http = () =>
    new PoliteHttp({ minDelayMs: 0, maxDelayMs: 0, sleep: async () => {}, fetchImpl });
  const product = await createProduct(db, uid, {
    category: 'tcg',
    kind: 'booster_box',
    name: 'Box',
    imageUrl: 'https://cdn.example/a.png',
  });
  await createProduct(db, uid, { category: 'tcg', kind: 'booster_box', name: 'No image' });

  expect(await downloadProductImages(db, http())).toEqual({ saved: 1, failed: 0 });
  const image = await getProductImage(db, product.id);
  expect(image).toMatchObject({ contentType: 'image/webp', width: 400, height: 267 });
  expect((await sharp(image!.bytes).metadata()).format).toBe('webp');

  // Nothing new to fetch; a changed URL is fetched again.
  expect(await downloadProductImages(db, http())).toEqual({ saved: 0, failed: 0 });
  await db
    .update(schema.products)
    .set({ imageUrl: 'https://cdn.example/b.png' })
    .where(eq(schema.products.id, product.id));
  expect(await downloadProductImages(db, http())).toEqual({ saved: 1, failed: 0 });
  expect(requested).toEqual(['https://cdn.example/a.png', 'https://cdn.example/b.png']);
});

it('takes the picture from the linked listing, and follows a relink', async () => {
  const png = await sharp({ create: { width: 50, height: 50, channels: 3, background: '#000' } })
    .png()
    .toBuffer();
  const fetchImpl = (async () =>
    new Response(png, { headers: { 'content-type': 'image/png' } })) as unknown as typeof fetch;
  const http = () =>
    new PoliteHttp({ minDelayMs: 0, maxDelayMs: 0, sleep: async () => {}, fetchImpl });
  // A product image URL is only the fallback; the confirmed listing's picture wins.
  const product = await createProduct(db, uid, {
    category: 'tcg',
    kind: 'single',
    name: 'ピカチュウ',
    imageUrl: 'https://cdn.example/own.png',
  });
  const wrong = await linkSource(
    db,
    product.id,
    { source: 'snkrdunk', externalId: '1' },
    'https://cdn.example/wrong.png',
  );
  await downloadProductImages(db, http());
  expect((await getProductImage(db, product.id))?.sourceUrl).toBe('https://cdn.example/wrong.png');

  await unlinkSource(db, wrong.id);
  await linkSource(
    db,
    product.id,
    { source: 'snkrdunk', externalId: '2' },
    'https://cdn.example/right.png',
  );
  expect(await downloadProductImages(db, http())).toEqual({ saved: 1, failed: 0 });
  expect((await getProductImage(db, product.id))?.sourceUrl).toBe('https://cdn.example/right.png');
});

it('prefers the identity source and a plain listing over a variant, whatever was linked first', async () => {
  await saveSourceInfos(db, TEST_SOURCES);
  const png = await sharp({ create: { width: 50, height: 50, channels: 3, background: '#000' } })
    .png()
    .toBuffer();
  const fetchImpl = (async () =>
    new Response(png, { headers: { 'content-type': 'image/png' } })) as unknown as typeof fetch;
  const http = new PoliteHttp({ minDelayMs: 0, maxDelayMs: 0, sleep: async () => {}, fetchImpl });
  const box = await createProduct(db, uid, {
    category: 'tcg',
    kind: 'booster_box',
    name: 'Box',
    imageUrl: 'https://cdn.example/seller.png',
  });
  await linkSource(
    db,
    box.id,
    { source: 'surugaya', externalId: '9', title: 'Box' },
    'https://cdn.example/shop.png',
  );
  await linkSource(
    db,
    box.id,
    { source: 'snkrdunk', externalId: '1', title: '【シュリンクなし】 Box' },
    'https://cdn.example/no-shrink.png',
  );
  await linkSource(
    db,
    box.id,
    { source: 'snkrdunk', externalId: '2', title: 'Box' },
    'https://cdn.example/shrink.png',
  );
  await downloadProductImages(db, http, { isVariant: (_s, t) => !!t?.startsWith('【') });
  expect((await getProductImage(db, box.id))?.sourceUrl).toBe('https://cdn.example/shrink.png');
});
