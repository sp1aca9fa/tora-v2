import { TEST_SOURCES } from '@tora/db/testing';
import {
  saveSourceInfos,
  type Db,
  addPurchaseLinks,
  createDb,
  createHolding,
  createUser,
  importRunDetail,
  importRunsOf,
  linksIn,
  listProductSources,
  purchaseLinksOf,
  schema,
} from '@tora/db';
import { migrateDb } from '@tora/db/migrate';
import { eq } from 'drizzle-orm';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { BlockedError, PoliteHttp } from './http';
import { importPurchaseLinks } from './links';
import type { Collector, LinkRead, PurchaseImporter, PurchaseReceipt } from './types';

let dir: string;
let db: Db;
let userId: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tora-links-'));
  db = createDb({ url: `file:${join(dir, 'test.db')}` });
  await migrateDb(db);
  await saveSourceInfos(db, TEST_SOURCES);
  userId = (
    await createUser(db, 'alice', { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] })
  ).user.id;
  return () => rm(dir, { recursive: true, force: true });
});

const receipt = (id: string, title: string, price: number): PurchaseReceipt => ({
  orderId: id,
  orderedAt: '2026-09-01T12:00:00.000+09:00',
  title,
  quantity: 1,
  totalBase: price,
  listing: null,
  reference: `https://shop.example/item/${id}`,
  dateApprox: true,
});

/** A shop whose links are "https://shop.example/item/<id>". */
function shop(reads: Record<string, LinkRead | Error>): PurchaseImporter {
  return {
    source: 'shop',
    label: 'Shop',
    matchesLink: (url) => url.startsWith('https://shop.example/'),
    readLink: async (url) => {
      const read = reads[url.split('/').pop()!];
      if (!read || read instanceof Error) throw read ?? new Error('missing');
      return read;
    },
    productFor: (r) => ({ category: 'game', kind: 'other', name: r.title }),
  };
}

const collector: Collector = {
  source: 'shop',
  label: 'Shop',
  supports: () => true,
  findCandidates: async () => [],
  collect: async () => ({ state: null, complete: true }),
  defaultQuery: (p) => ({ keywords: [p.name], extra: { auto: true, v: 1 } }),
};

const http = new PoliteHttp({ minDelayMs: 0, maxDelayMs: 0 });

describe('linksIn', () => {
  it('finds links in pasted text and drops tracking', () => {
    expect(
      linksIn(
        'https://jp.mercari.com/item/m111?utm_source=x\n買った！ https://jp.mercari.com/item/m222/ \nhttps://jp.mercari.com/item/m111',
      ),
    ).toEqual(['https://jp.mercari.com/item/m111', 'https://jp.mercari.com/item/m222']);
    expect(linksIn('no links here')).toEqual([]);
  });
});

describe('importPurchaseLinks', () => {
  it('imports, skips and fails links, then never reads them again', async () => {
    await addPurchaseLinks(db, userId, [
      'https://shop.example/item/a1',
      'https://shop.example/item/a2',
      'https://shop.example/item/a3',
      'https://elsewhere.example/x',
    ]);
    const importer = shop({
      a1: { kind: 'purchase', receipt: receipt('a1', 'Retro Station', 22000) },
      a2: { kind: 'skip', reason: 'Not a collectible category (家具).' },
      a3: new Error('HTTP 500'),
    });
    const summary = await importPurchaseLinks(db, [importer], [collector], http);
    expect(summary.counts).toEqual({
      imported: 1,
      matched: 0,
      duplicate: 0,
      skipped: 1,
      failed: 2,
    });

    const links = new Map(
      (await purchaseLinksOf(db, userId)).map((l) => [l.url.split('/').pop(), l]),
    );
    expect(links.get('a1')!.status).toBe('imported');
    expect(links.get('a2')!.message).toContain('家具');
    expect(links.get('a3')!.message).toContain('HTTP 500');
    expect(links.get('x')!.message).toContain('No importer');

    const [lot] = await db.select().from(schema.holdings).where(eq(schema.holdings.orderId, 'a1'));
    expect(lot).toMatchObject({
      costTotalBase: 22000,
      acquiredFrom: 'Shop',
      reviewPending: true,
      reviewReason: 'date_approx,new_product',
    });
    expect(links.get('a1')!.holdingId).toBe(lot!.id);
    // The item's own listing becomes a reference sale on the product's new search.
    const [search] = await listProductSources(db, lot!.productId);
    expect(search).toMatchObject({ externalId: 'search', source: 'shop' });
    expect(search!.query?.extra).toMatchObject({
      auto: true,
      references: ['https://shop.example/item/a1'],
    });

    // One run in the Imports history, with the lot and the links it read.
    const [run] = await importRunsOf(db, userId);
    expect(run).toMatchObject({
      method: 'links',
      source: 'shop',
      counts: { imported: 1, skipped: 1, failed: 2 },
    });
    const detail = await importRunDetail(db, userId, run!.id);
    expect(detail!.lots.map((l) => l.holding.id)).toEqual([lot!.id]);
    expect(detail!.links).toHaveLength(4);

    const again = await importPurchaseLinks(db, [importer], [collector], http);
    expect(again.read).toBe(0);
  });

  it('matches an entry added by hand and reports one already registered', async () => {
    await createHolding(
      db,
      userId,
      { product: { category: 'game', kind: 'other', name: 'Retro Station' } },
      {
        quantity: 1,
        costTotalBase: 22000,
        acquiredAt: '2026-08-30T10:00:00.000+09:00',
        acquiredFrom: 'Shop',
      },
    );
    await createHolding(
      db,
      userId,
      { product: { category: 'game', kind: 'other', name: 'Joy-Con' } },
      {
        quantity: 1,
        costTotalBase: 5000,
        acquiredAt: '2026-08-01T10:00:00.000+09:00',
        acquiredFrom: 'Shop',
        orderId: 'b2',
      },
    );
    await addPurchaseLinks(db, userId, [
      'https://shop.example/item/b1',
      'https://shop.example/item/b2',
    ]);
    const importer = shop({
      b1: { kind: 'purchase', receipt: receipt('b1', 'Retro Station', 22000) },
      b2: {
        kind: 'purchase',
        receipt: { ...receipt('b2', 'Joy-Con', 5000), orderedAt: '2026-08-01T10:00:00.000+09:00' },
      },
    });
    const summary = await importPurchaseLinks(db, [importer], [collector], http);
    expect(summary.counts).toMatchObject({ imported: 0, matched: 1, duplicate: 1 });
    const lots = await db.select().from(schema.holdings);
    expect(lots).toHaveLength(2);
    expect(lots.find((h) => h.costTotalBase === 22000)!.orderId).toBe('b1');
  });

  it('leaves the rest pending when the site blocks', async () => {
    await addPurchaseLinks(db, userId, [
      'https://shop.example/item/c1',
      'https://shop.example/item/c2',
    ]);
    const importer = shop({ c1: new BlockedError('403'), c2: new BlockedError('403') });
    const summary = await importPurchaseLinks(db, [importer], [collector], http);
    expect(summary.left).toBe(2);
    expect((await purchaseLinksOf(db, userId)).every((l) => l.status === 'pending')).toBe(true);
  });
});
