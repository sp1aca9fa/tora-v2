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

  expect(await downloadProductImages(db, http())).toEqual({ saved: 1, failed: 0, blocked: null });
  const image = await getProductImage(db, product.id);
  expect(image).toMatchObject({ contentType: 'image/webp', width: 400, height: 267 });
  expect((await sharp(image!.bytes).metadata()).format).toBe('webp');

  // Nothing new to fetch; a changed URL is fetched again.
  expect(await downloadProductImages(db, http())).toEqual({ saved: 0, failed: 0, blocked: null });
  await db
    .update(schema.products)
    .set({ imageUrl: 'https://cdn.example/b.png' })
    .where(eq(schema.products.id, product.id));
  expect(await downloadProductImages(db, http())).toEqual({ saved: 1, failed: 0, blocked: null });
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
  expect(await downloadProductImages(db, http())).toEqual({ saved: 1, failed: 0, blocked: null });
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

it('leaves refused sites out, takes each site lock, and stops at a refusal (K15)', async () => {
  const png = await sharp({ create: { width: 50, height: 50, channels: 3, background: '#000' } })
    .png()
    .toBuffer();
  const requested: string[] = [];
  const fetchImpl = (async (url: string) => {
    requested.push(url);
    if (url.includes('shopa'))
      return new Response('<html>Just a moment...</html>', { status: 503 });
    return new Response(png, { headers: { 'content-type': 'image/png' } });
  }) as unknown as typeof fetch;
  const http = () =>
    new PoliteHttp({ minDelayMs: 0, maxDelayMs: 0, sleep: async () => {}, fetchImpl });
  const item = async (name: string, source: string) => {
    const p = await createProduct(db, uid, { category: 'tcg', kind: 'booster_box', name });
    await linkSource(
      db,
      p.id,
      { source, externalId: name },
      `https://${source}.example/${name}.png`,
    );
    return p;
  };
  await item('one', 'shopa');
  await item('two', 'shopa');
  await item('three', 'shopb');
  await item('four', 'shopc');
  const taken: string[] = [];
  const released: string[] = [];
  const lock = async (source: string) => {
    taken.push(source);
    // Another run reads shopc.
    return source === 'shopc' ? null : { release: () => void released.push(source) };
  };

  // shopb was refused earlier today: left out. shopa refuses: one request, then nothing more.
  const first = await downloadProductImages(db, http(), { leave: new Set(['shopb']), lock });
  expect(first.blocked).toBe('shopa');
  expect(requested.filter((u) => u.includes('shopa'))).toHaveLength(1);
  expect(requested.some((u) => u.includes('shopb'))).toBe(false);
  expect(released).toEqual(taken.filter((s) => s !== 'shopc'));

  // With shopa left out too, shopc's lock held by another run: nothing is read.
  requested.length = 0;
  taken.length = 0;
  const second = await downloadProductImages(db, http(), {
    leave: new Set(['shopa', 'shopb']),
    lock,
  });
  expect(second).toEqual({ saved: 0, failed: 0, blocked: null });
  expect(taken).toEqual(['shopc']);
  expect(requested).toEqual([]);
});

it("names the site of a product's own picture by its host (K15)", async () => {
  const png = await sharp({ create: { width: 50, height: 50, channels: 3, background: '#000' } })
    .png()
    .toBuffer();
  const requested: string[] = [];
  const fetchImpl = (async (url: string) => {
    requested.push(url);
    return new Response(png, { headers: { 'content-type': 'image/png' } });
  }) as unknown as typeof fetch;
  const http = () =>
    new PoliteHttp({ minDelayMs: 0, maxDelayMs: 0, sleep: async () => {}, fetchImpl });
  // A listing of marketa has its picture on marketa's picture host.
  const listed = await createProduct(db, uid, { category: 'tcg', kind: 'booster_box', name: 'L' });
  await linkSource(
    db,
    listed.id,
    { source: 'marketa', externalId: 'm1' },
    'https://img.marketa.example/m1.jpg',
  );
  // A purchase import's product: its own picture on the same host, no listing behind it.
  await createProduct(db, uid, {
    category: 'tcg',
    kind: 'booster_box',
    name: 'Imported',
    imageUrl: 'https://img.marketa.example/photo.jpg',
  });
  const taken: string[] = [];
  const lock = async (source: string) => {
    taken.push(source);
    return { release: () => {} };
  };

  // marketa refused today: both pictures wait, nothing is sent.
  expect(await downloadProductImages(db, http(), { leave: new Set(['marketa']), lock })).toEqual({
    saved: 0,
    failed: 0,
    blocked: null,
  });
  expect(requested).toEqual([]);

  // Not refused: the imported picture takes marketa's lock too.
  expect(await downloadProductImages(db, http(), { lock })).toMatchObject({ saved: 2 });
  expect(taken).toEqual(['marketa']);
  expect(requested).toHaveLength(2);
});

it('takes every lock of a shared picture host and names no site on its refusal', async () => {
  const png = await sharp({ create: { width: 50, height: 50, channels: 3, background: '#000' } })
    .png()
    .toBuffer();
  const requested: string[] = [];
  const fetchImpl = (async (url: string) => {
    requested.push(url);
    if (url.endsWith('photo.jpg')) return new Response('', { status: 403 });
    return new Response(png, { headers: { 'content-type': 'image/png' } });
  }) as unknown as typeof fetch;
  const http = () =>
    new PoliteHttp({ minDelayMs: 0, maxDelayMs: 0, sleep: async () => {}, fetchImpl });
  // shopb and shopc show their pictures on one shop platform's host.
  for (const source of ['shopb', 'shopc']) {
    const p = await createProduct(db, uid, { category: 'tcg', kind: 'booster_box', name: source });
    await linkSource(
      db,
      p.id,
      { source, externalId: source },
      `https://img.platform.example/${source}.jpg`,
    );
  }
  // A product's own picture on that host: either site may serve it.
  await createProduct(db, uid, {
    category: 'tcg',
    kind: 'booster_box',
    name: 'Imported',
    imageUrl: 'https://img.platform.example/photo.jpg',
  });
  const taken: string[] = [];
  const lock = async (source: string) => {
    taken.push(source);
    // Another run reads shopc.
    return source === 'shopc' ? null : { release: () => {} };
  };

  // shopc's lock held: its picture and the shared one wait; shopb's is read.
  expect(await downloadProductImages(db, http(), { lock })).toEqual({
    saved: 1,
    failed: 0,
    blocked: null,
  });
  expect(requested).toEqual(['https://img.platform.example/shopb.jpg']);
  expect(taken.sort()).toEqual(['shopb', 'shopc']);

  // shopc refused today: the shared picture waits too.
  requested.length = 0;
  expect(await downloadProductImages(db, http(), { leave: new Set(['shopc']) })).toMatchObject({
    saved: 0,
    blocked: null,
  });
  expect(requested).toEqual([]);

  // Both free: the shared picture refuses; the pictures stop, no site is named.
  taken.length = 0;
  const free = async (source: string) => (taken.push(source), { release: () => {} });
  const result = await downloadProductImages(db, http(), { lock: free });
  expect(result.blocked).toBeNull();
  expect(requested.at(-1)).toBe('https://img.platform.example/photo.jpg');
  expect(taken.sort()).toEqual(['shopb', 'shopc']);
});

it('takes no lock and records no site for a picture on a host no listing uses', async () => {
  const requested: string[] = [];
  const fetchImpl = (async (url: string) => {
    requested.push(url);
    return new Response('', { status: 403 });
  }) as unknown as typeof fetch;
  const http = new PoliteHttp({ minDelayMs: 0, maxDelayMs: 0, sleep: async () => {}, fetchImpl });
  for (const name of ['a', 'b'])
    await createProduct(db, uid, {
      category: 'tcg',
      kind: 'booster_box',
      name,
      imageUrl: `https://unknown.example/${name}.jpg`,
    });
  const taken: string[] = [];
  const result = await downloadProductImages(db, http, {
    lock: async (source) => {
      taken.push(source);
      return { release: () => {} };
    },
  });
  // The refusal stops the pictures, names no site, and nothing more is sent.
  expect(result).toEqual({ saved: 0, failed: 0, blocked: null });
  expect(taken).toEqual([]);
  expect(requested).toHaveLength(1);
});
