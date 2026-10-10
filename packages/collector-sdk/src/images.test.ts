import { type Db, createDb, createProduct, createUser, getProductImage, schema } from '@tora/db';
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
