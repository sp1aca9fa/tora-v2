import {
  type Db,
  createDb,
  createProduct,
  createUser,
  insertObservations,
  linkSource,
  saveSourceInfos,
  schema,
} from '@tora/db';
import { migrateDb } from '@tora/db/migrate';
import { eq } from 'drizzle-orm';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { querySql, withoutSources } from './tools';

describe('sources kept from AI models (query_sql guard)', () => {
  const ok = (sql: string) => {
    const r = withoutSources(sql, ['ebay']);
    if ('error' in r) throw new Error(r.error);
    return r.sql;
  };
  const refused = (sql: string) => expect(withoutSources(sql, ['ebay'])).toHaveProperty('error');

  it('shadows each mentioned table with a version without them', () => {
    expect(ok('select count(*) from price_observations')).toBe(
      "with price_observations as (select * from main.price_observations where source is null or source not in ('ebay')) select count(*) from price_observations",
    );
    expect(ok('select 1 from products')).toBe('select 1 from products');
    expect(withoutSources('select * from item_sales', [])).toEqual({
      sql: 'select * from item_sales',
    });
    // A query's own WITH list (recursive or not) gets the guards first.
    expect(ok('WITH RECURSIVE n(i) as (select 1) select * from n, supply')).toBe(
      "WITH RECURSIVE supply as (select * from main.supply where source is null or source not in ('ebay')), n(i) as (select 1) select * from n, supply",
    );
    expect(ok('with x as (select * from signals) select * from x')).toMatch(
      /^with signals as \(.*\), x as \(select \* from signals\) select \* from x$/,
    );
  });

  it('refuses the schema prefix, raw pages and the tables mixing sources', () => {
    refused('select * from main.price_observations');
    refused('select * from "main"."price_observations"');
    refused('select * from [main] . price_observations');
    refused('select * from main/* x */.price_observations');
    refused('select * from temp.supply');
    refused('select * from item_sales');
    refused('select * from holding_values');
    refused('select * from sqlite_dbpage');
    // A comment marker inside a literal does not hide what follows.
    refused("select '--', * from main.price_observations");
    refused("select '/*', * from main.price_observations -- */");
    // Names that only contain the words are fine.
    expect(ok('select domain.x from products domain')).toBe('select domain.x from products domain');
  });
});

describe('query_sql on a database holding a noAi source', () => {
  let db: Db;
  let productId: string;
  const at = '2026-10-10T03:00:00.000Z';

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tora-noai-'));
    db = createDb({ url: `file:${join(dir, 'test.db')}` });
    await migrateDb(db);
    const uid = (
      await createUser(db, 'a', { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] })
    ).user.id;
    await saveSourceInfos(db, [
      { key: 'ebay', label: 'E', noAi: true },
      { key: 'mercari', label: 'M' },
    ]);
    productId = (
      await createProduct(db, uid, {
        category: 'tcg',
        kind: 'single',
        name: 'p',
        cardNumber: '1',
        franchise: 'pokemon',
      })
    ).id;
    const sale = (source: string, ref: string, price: number) => ({
      productId,
      source,
      observationType: 'sold' as const,
      bucket: 'raw:A',
      priceBase: price,
      currency: 'JPY',
      observedAt: at,
      fetchedAt: at,
      externalRef: ref,
      excluded: false,
      excludedReason: null,
      raw: {},
    });
    await insertObservations(db, [sale('mercari', 'm1', 1000), sale('ebay', 'e1', 5000)]);
    for (const source of ['mercari', 'ebay']) {
      const link = await linkSource(db, productId, { source, externalId: `${source}-1` });
      await db
        .update(schema.productSources)
        .set({
          recentSales: [{ bucket: 'raw:A', priceBase: 7, observedAt: at }],
          state: { cursor: 1 },
        })
        .where(eq(schema.productSources.id, link.id));
    }
    const last = (source: string) => ({
      source,
      priceBase: 1,
      observedAt: at,
      approximate: false,
    });
    const value = (source: string) => ({
      valuation: { unitBase: 1000, method: 'median', source },
      last: last('ebay'),
      buylist: null,
      sources: [
        { source: 'mercari', last: last('mercari'), medianBase: 1000 },
        { source: 'ebay', last: last('ebay'), medianBase: 5000 },
      ],
    });
    await db.insert(schema.bucketValues).values([
      { productId, bucket: 'raw:A', computedAt: at, value: value('mercari') },
      { productId, bucket: 'raw:B', computedAt: at, value: value('ebay') },
    ]);
    return () => rm(dir, { recursive: true, force: true });
  });

  const rows = async (sql: string) => {
    const r = await querySql(db, sql);
    if ('error' in r) throw new Error(String(r.error));
    return r.rows;
  };

  it('reads the sales without them, however the table is named', async () => {
    expect(await rows('select source from price_observations')).toEqual([{ source: 'mercari' }]);
    // Qualified columns, a comma join, a subquery, quoted names and a trailing comment.
    expect(
      await rows(
        'select price_observations.source from price_observations, products where products.id = price_observations.product_id',
      ),
    ).toEqual([{ source: 'mercari' }]);
    expect(
      await rows('select count(*) as n from "price_observations" a, [price_observations] b -- end'),
    ).toEqual([{ n: 1 }]);
    expect(
      await rows('select (select max(price_base) from PRICE_OBSERVATIONS) as top from products'),
    ).toEqual([{ top: 1000 }]);
    expect(
      await rows(
        'with recursive n(i) as (select 1 union all select i + 1 from n where i < 2) select count(*) as c from n, price_observations',
      ),
    ).toEqual([{ c: 2 }]);
    // An unrelated literal, and an unaliased qualified column of an empty table.
    expect(await rows("select count(*) as n from products where name like '%supply%'")).toEqual([
      { n: 0 },
    ]);
    expect(await rows('select signals.day from signals')).toEqual([]);
    expect(await querySql(db, 'select * from main.price_observations')).toHaveProperty('error');
    expect(await querySql(db, 'select * from holding_values')).toHaveProperty('error');
  });

  it('keeps every listing but not their recent trades or progress', async () => {
    expect(
      await rows('select source, recent_sales, state from product_sources order by source'),
    ).toEqual([
      { source: 'ebay', recent_sales: null, state: null },
      {
        source: 'mercari',
        recent_sales: JSON.stringify([{ bucket: 'raw:A', priceBase: 7, observedAt: at }]),
        state: JSON.stringify({ cursor: 1 }),
      },
    ]);
    expect(await rows("select * from product_sources where source = 'ebay'")).toEqual([
      expect.objectContaining({ external_id: 'ebay-1', recent_sales: null }),
    ]);
  });

  it('leaves out values from them and their parts of the others', async () => {
    const got = await rows('select bucket, value from bucket_values');
    expect(got.map((r) => r.bucket)).toEqual(['raw:A']);
    const value = JSON.parse(String(got[0]!.value));
    expect(value.valuation.source).toBe('mercari');
    expect(value.last).toBeNull();
    expect(value.sources).toEqual([
      expect.objectContaining({
        source: 'mercari',
        last: expect.objectContaining({ priceBase: 1 }),
      }),
    ]);
    expect(JSON.stringify(value)).not.toContain('ebay');
  });
});
