import {
  type Db,
  addWatch,
  createDb,
  createHolding,
  createProduct,
  createUser,
  insertObservations,
  linkSource,
  refreshItemSales,
  runDataCheck,
  saveSetting,
  saveSourceInfos,
  schema,
} from '@tora/db';
import { migrateDb } from '@tora/db/migrate';
import { localDate, toLocalIso } from '@tora/core';
import { eq } from 'drizzle-orm';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  REBUILT_TABLES,
  SALES_TABLES,
  SORTED_TABLES,
  collectorStatus,
  dataChecks,
  listProducts,
  portfolioSummary,
  productDetail,
  querySql,
  watchlist,
  withoutSources,
} from './tools';

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

const scrubScript = () =>
  readFile(join(import.meta.dirname, '../../../ops/scrub-analysis.sql'), 'utf8');

describe('query_sql on a database holding a noAi source', () => {
  let db: Db;
  let productId: string;
  let userId: string;
  const at = '2026-10-10T03:00:00.000Z';

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tora-noai-'));
    db = createDb({ url: `file:${join(dir, 'test.db')}` });
    await migrateDb(db);
    const uid = (
      await createUser(db, 'a', { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] })
    ).user.id;
    userId = uid;
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

  it('leaves them out of collector status and the data checks', async () => {
    const run = (source: string) => ({
      source,
      status: 'ok' as const,
      startedAt: at,
      finishedAt: at,
      error: `${source} said no`,
    });
    await db.insert(schema.collectorRuns).values([run('mercari'), run('ebay')]);

    const status = await collectorStatus(db);
    expect(status.health.map((h) => h.source)).toEqual(['mercari']);
    expect(status.recentRuns.map((r) => r.source)).toEqual(['mercari']);
    expect(JSON.stringify(status)).not.toContain('ebay');

    const checks = await dataChecks(db, userId, new Date(at));
    expect(checks.find((c) => c.check === 'collectors')).toBeDefined();
    expect(JSON.stringify(checks)).not.toContain('ebay');
  });

  describe('what names them or comes from them outside the sales', () => {
    beforeEach(async () => {
      const run = (source: string) => ({
        source,
        status: 'failed' as const,
        startedAt: at,
        finishedAt: at,
        error: `${source} said no`,
      });
      await db.insert(schema.collectorRuns).values([run('mercari'), run('ebay')]);
      await db
        .update(schema.productSources)
        .set({ failure: { error: 'ebay gone' } as never, title: 'site title' })
        .where(eq(schema.productSources.source, 'ebay'));
      await db.insert(schema.activity).values([
        { kind: 'collect', level: 'ok', detail: { sources: ['ebay'] }, occurredAt: at },
        { kind: 'backup', level: 'ok', detail: { mb: 1 }, occurredAt: at },
      ]);
      const sent = { userId, channelKind: 'discord', channelLabel: 'c', status: 'sent' };
      await db
        .insert(schema.alertLog)
        .values([
          { kind: 'admin', text: 'ebay failed', sentAt: at, ...sent } as never,
          { kind: 'store', text: 'a store post', sentAt: at, ...sent } as never,
        ]);
      await db
        .update(schema.sources)
        .set({ quality: { gap: 0.5 } })
        .where(eq(schema.sources.key, 'ebay'));
      // Another source's row, compared against it.
      await db
        .update(schema.sources)
        .set({ quality: { card: { against: 'ebay', pairs: 3 } } })
        .where(eq(schema.sources.key, 'mercari'));
      await db.insert(schema.appSettings).values([
        {
          key: 'opportunities',
          value: {
            items: [
              { source: 'ebay', listings: { now: 9, before: 12 } },
              { source: 'mercari', listings: { now: 3, before: 4 } },
              { source: 'mercari', buylist: { source: 'ebay', price: 1, day: 'x' } },
            ],
          },
        },
        { key: 'currency', value: 'JPY' },
      ]);
    });

    it('keeps them out of query_sql', async () => {
      expect((await rows('select source from collector_runs')).map((r) => r.source)).toEqual([
        'mercari',
      ]);
      expect(
        await rows(
          "select failure, title, last_success_at from product_sources where source = 'ebay'",
        ),
      ).toEqual([{ failure: null, title: null, last_success_at: null }]);
      expect(await rows('select kind, detail from activity order by kind')).toEqual([
        { kind: 'backup', detail: JSON.stringify({ mb: 1 }) },
        { kind: 'collect', detail: null },
      ]);
      expect(await rows('select kind, text from alert_log order by kind')).toEqual([
        { kind: 'admin', text: null },
        { kind: 'store', text: 'a store post' },
      ]);
      expect(await rows("select quality from sources where key = 'ebay'")).toEqual([
        { quality: null },
      ]);
      expect(await rows("select quality from sources where key = 'mercari'")).toEqual([
        { quality: null },
      ]);
      expect(await rows('select key, value from app_settings order by key')).toEqual(
        expect.arrayContaining([
          { key: 'currency', value: JSON.stringify('JPY') },
          { key: 'opportunities', value: null },
        ]),
      );
    });

    it('takes them out of the analysis copy (ops/scrub-analysis.sql)', async () => {
      await refreshItemSales(db, { full: true });
      await db.$client.executeMultiple(await scrubScript());
      const all = async (table: string) => {
        const rs = await db.$client.execute(`select * from ${table}`);
        return JSON.stringify(rs.rows);
      };
      expect(await all('price_observations')).not.toContain('ebay');
      expect(await all('collector_runs')).not.toContain('ebay');
      expect(await all('activity')).not.toContain('ebay');
      expect(await all('alert_log')).not.toContain('ebay');
      expect(await all('bucket_values')).not.toContain('ebay');
      expect(await all('item_sales')).not.toContain('ebay');
      // A saved opportunity on that source goes with its counts; the other source's stays.
      const [saved] = (
        await db.$client.execute("select value from app_settings where key = 'opportunities'")
      ).rows;
      expect(JSON.parse(String(saved!.value)).items).toEqual([
        { source: 'mercari', listings: { now: 3, before: 4 } },
        { source: 'mercari', buylist: null },
      ]);
      expect(await all('app_settings')).not.toContain('ebay');
      // The packed sales keep the other source's prices, and its daily counts.
      const [packed] = (await db.$client.execute('select sales from item_sales')).rows;
      const sales = JSON.parse(String(packed!.sales));
      expect(sales.groups.map((g: { s: string; p: number[] }) => [g.s, g.p])).toEqual([
        ['mercari', [1000]],
      ]);
      expect(Object.keys(sales.n)).toEqual(['mercari']);
      // A value from the other source stays, with its part; one from this source goes.
      const values = (await db.$client.execute('select bucket, value from bucket_values')).rows;
      expect(values.map((r) => r.bucket)).toEqual(['raw:A']);
      const value = JSON.parse(String(values[0]!.value));
      expect(value.valuation.source).toBe('mercari');
      expect(value.sources.map((x: { source: string }) => x.source)).toEqual(['mercari']);
      // A price of another source stays, and so does the item's link to the one left out.
      expect(await all('price_observations')).toContain('mercari');
      expect(await all('alert_log')).toContain('a store post');
      const [link] = (
        await db.$client.execute(
          "select title, failure, external_id from product_sources where source = 'ebay'",
        )
      ).rows;
      expect(link).toMatchObject({ title: null, failure: null, external_id: 'ebay-1' });
      expect(
        (await db.$client.execute("select quality from sources where key = 'ebay'")).rows[0],
      ).toMatchObject({ quality: null });
    });
  });

  it('the analysis copy loses what query_sql hides', async () => {
    const scrub = await scrubScript();
    for (const table of SALES_TABLES) {
      expect(scrub, table).toContain(`delete from ${table} where source in hidden;`);
    }
    // Hide lots by day and any other setting from Claude's tool; the scrub takes out what names such a source.
    const toolOnly = ['portfolio_charts', 'app_settings'];
    for (const table of REBUILT_TABLES.filter((t) => !toolOnly.includes(t))) {
      expect(scrub, table).toContain(`update ${table} set`);
    }
  });

  it('leaves a database without such sources as it is', async () => {
    await db.update(schema.sources).set({ info: { key: 'ebay', label: 'E' } as never });
    await db.insert(schema.activity).values({
      kind: 'collect',
      level: 'ok',
      detail: { sources: ['x'] },
      occurredAt: at,
    });
    await db.$client.executeMultiple(await scrubScript());
    const [entry] = (await db.$client.execute('select detail from activity')).rows;
    expect(entry!.detail).toBe(JSON.stringify({ sources: ['x'] }));
  });

  describe("Tora's self check", () => {
    const steady = { judged: 300, far: 3, kept: 300, found: 500 };
    const days = (sources: Record<string, typeof steady>) =>
      Object.fromEntries(
        Array.from({ length: 14 }, (_, i) => [
          localDate(new Date(Date.now() - (i + 1) * 86_400_000)),
          { sources, compared: 0 },
        ]),
      );
    const state = (sources: Record<string, typeof steady>) => ({
      days: days(sources),
      open: {},
      resets: {},
      lastRun: null,
      firstSeen: null,
      itemsToldOn: null,
    });
    const now = () => toLocalIso(new Date());

    beforeEach(async () => {
      await saveSourceInfos(db, [
        { key: 'ebay', label: 'E', market: 'jp', noAi: true, priceKinds: ['sold'] },
        { key: 'mercari', label: 'M', market: 'jp', priceKinds: ['sold'] },
      ]);
    });

    it('reads no sold row of such a source: no state, activity, message or `dataChecks` output', async () => {
      const row = (source: string, price: number, i: number) => ({
        productId,
        source,
        observationType: 'sold' as const,
        bucket: 'raw:A',
        priceBase: price,
        currency: 'JPY',
        observedAt: now(),
        fetchedAt: now(),
        externalRef: `${source}-day-${i}`,
        excluded: false,
        excludedReason: null,
        raw: {},
      });
      // Read together they would be 5x apart, so a leak here opens a finding that names it.
      await insertObservations(
        db,
        [1, 2, 3, 4, 5].flatMap((i) => [row('mercari', 1000, i), row('ebay', 5000, i)]),
      );
      await refreshItemSales(db, { full: true });
      await db.insert(schema.activity).values({
        kind: 'collect',
        level: 'ok',
        detail: {},
        occurredAt: now(),
      });
      await saveSetting(db, 'dataCheck', state({ mercari: steady }));

      expect(await runDataCheck(db)).toEqual([expect.objectContaining({ source: 'mercari' })]);
      const stored = await db.$client.execute(
        "select value from app_settings where key = 'dataCheck'",
      );
      expect(String(stored.rows[0]!.value)).toContain('mercari');
      expect(String(stored.rows[0]!.value)).not.toContain('ebay');
      const entries = await db.$client.execute(
        "select detail from activity where action = 'data_check'",
      );
      expect(entries.rows).toHaveLength(1);
      expect(JSON.stringify(entries.rows)).not.toContain('ebay');
      expect(JSON.stringify(await dataChecks(db, userId))).not.toContain('"ebay"');
      expect((await dataChecks(db, userId)).map((c) => c.check)).toContain('self_check');
    });

    it('`query_sql` reads the history, but not with such a source in it', async () => {
      await saveSetting(db, 'dataCheck', state({ mercari: steady }));
      const [fine] = await rows("select value from app_settings where key = 'dataCheck'");
      expect(String(fine!.value)).toContain('mercari');

      await saveSetting(db, 'dataCheck', state({ mercari: steady, ebay: steady }));
      expect(await rows("select value from app_settings where key = 'dataCheck'")).toEqual([
        { value: null },
      ]);
    });

    const keptOn = (source: string) => ({
      key: `kept:${source}`,
      kind: 'kept',
      source,
      kept: 1,
      usual: 300,
      openedOn: 'a',
    });

    it('`dataChecks` shows the same rows and findings as Settings', async () => {
      await saveSetting(db, 'dataCheck', {
        ...state({ mercari: steady }),
        lastRun: localDate(new Date(Date.now() - 86_400_000)),
        open: { 'kept:mercari': keptOn('mercari') },
      });
      const checks = await dataChecks(db, userId);
      const open = checks.find((c) => c.check === 'self_check')!;
      expect(open.items).toMatchObject([{ source: 'mercari' }]);
      expect(open.severity).toBe('warn');
      const sources = checks.find((c) => c.check === 'self_check_sources')!;
      expect(sources.items).toEqual([{ source: 'mercari', label: 'M', status: 'watching' }]);
    });

    it('a source that stopped appearing: `dataChecks` says not seen, with the date', async () => {
      const yesterday = localDate(new Date(Date.now() - 86_400_000));
      // The last night with numbers was 2 days back, and a night looks over its 7 days.
      const lastActive = localDate(new Date(Date.now() - 8 * 86_400_000));
      const seeded = state({ mercari: steady });
      await saveSetting(db, 'dataCheck', {
        ...seeded,
        lastRun: yesterday,
        days: { ...seeded.days, [yesterday]: { sources: {}, compared: 0 } },
      });
      const sources = (await dataChecks(db, userId)).find((c) => c.check === 'self_check_sources')!;
      expect(sources.items).toEqual([
        { source: 'mercari', label: 'M', status: 'notSeen', lastSeen: lastActive },
      ]);
    });

    it('`dataChecks` shows nothing shaped by one marked after it was stored', async () => {
      await saveSetting(db, 'dataCheck', {
        ...state({ mercari: steady, ebay: steady }),
        open: { 'kept:ebay': keptOn('ebay'), 'kept:mercari': keptOn('mercari') },
      });
      const checks = await dataChecks(db, userId);
      expect(JSON.stringify(checks.filter((c) => c.check.startsWith('self_check')))).not.toContain(
        '"ebay"',
      );
      const open = checks.find((c) => c.check === 'self_check')!;
      expect(open.items).toEqual([]);
      expect(open.severity).toBe('info');
      const sources = checks.find((c) => c.check === 'self_check_sources')!;
      expect(sources.items).toEqual([
        { source: 'mercari', label: 'M', status: 'learning', nights: 0 },
      ]);
    });

    it('the morning after, `query_sql` reads no number pooled against it, though its name is gone', async () => {
      const seeded = state({ mercari: steady, ebay: steady });
      await saveSetting(db, 'dataCheck', {
        ...seeded,
        days: Object.fromEntries(
          Object.entries(seeded.days).map(([day, night]) => [day, { ...night, compared: 40 }]),
        ),
        open: {
          'leans:mercari': {
            key: 'leans:mercari',
            kind: 'leans',
            source: 'mercari',
            high: 40,
            low: 0,
            openedOn: 'a',
          },
        },
      });
      await db.insert(schema.activity).values({
        kind: 'collect',
        level: 'ok',
        detail: {},
        occurredAt: now(),
      });
      await runDataCheck(db);

      const [stored] = await rows("select value from app_settings where key = 'dataCheck'");
      const value = JSON.parse(String(stored!.value)) as {
        days: Record<string, { compared: number }>;
        open: Record<string, unknown>;
      };
      expect(value.open).toEqual({});
      expect(Object.keys(value.days)).toEqual([localDate()]);
      expect(value.days[localDate()]!.compared).toBe(0);
    });

    it('the analysis copy loses a history naming such a source, and keeps one that does not', async () => {
      await saveSetting(db, 'dataCheck', state({ mercari: steady }));
      await db.$client.executeMultiple(await scrubScript());
      expect(
        (await db.$client.execute("select key from app_settings where key = 'dataCheck'")).rows,
      ).toHaveLength(1);

      await saveSetting(db, 'dataCheck', state({ mercari: steady, ebay: steady }));
      await db.$client.executeMultiple(await scrubScript());
      expect(
        (await db.$client.execute("select key from app_settings where key = 'dataCheck'")).rows,
      ).toHaveLength(0);
    });
  });

  it('every table is sorted for the guards (a new one must be, and go in the scrub if it holds a source)', async () => {
    const rs = await db.$client.execute(
      "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '\\_\\_%' escape '\\' and name not like 'libsql_%'",
    );
    const sorted = new Set(SORTED_TABLES());
    expect(rs.rows.map((r) => String(r.name)).filter((t) => !sorted.has(t))).toEqual([]);
  });

  describe('lots and watches valued from them', () => {
    const lot = (rawGrade: 'A' | 'B') =>
      createHolding(
        db,
        userId,
        { productId },
        { quantity: 1, costTotalBase: 100, acquiredAt: at, rawGrade },
      );
    /** Sales of the other source in grade B, so that lot is valued from it alone. */
    const valuedFromHidden = async () => {
      const now = new Date().toISOString();
      await insertObservations(
        db,
        [1, 2, 3, 4, 5].map((i) => ({
          productId,
          source: 'ebay',
          observationType: 'sold' as const,
          bucket: 'raw:B',
          priceBase: 7777,
          currency: 'JPY',
          observedAt: now,
          fetchedAt: now,
          externalRef: `b${i}`,
          excluded: false,
          excludedReason: null,
          raw: {},
        })),
      );
    };

    it('hides a sum holding such a lot, whichever lot comes first', async () => {
      await valuedFromHidden();
      await lot('A');
      await lot('B');
      const listed = await listProducts(db, userId);
      expect(listed[0]).toMatchObject({ valueBase: null, unrealizedBase: null });
      expect(JSON.stringify(listed)).not.toContain('7777');
      const summary = await portfolioSummary(db, userId);
      expect(summary.topByValue[0]).toMatchObject({ valueBase: null, unrealizedBase: null });
      expect(summary.biggestGains).toEqual([]);
      expect(summary.biggestLosses).toEqual([]);
    });

    it('leaves their value out of the odd sales, and their rows out of the estimated share', async () => {
      await valuedFromHidden();
      await lot('B');
      const now = new Date().toISOString();
      await insertObservations(db, [
        {
          productId,
          source: 'mercari',
          observationType: 'sold' as const,
          bucket: 'raw:B',
          priceBase: 10,
          currency: 'JPY',
          observedAt: now,
          fetchedAt: now,
          externalRef: 'odd',
          excluded: false,
          excludedReason: null,
          quantityInferred: true,
          raw: {},
        },
      ]);
      const checks = await dataChecks(db, userId);
      expect(checks.find((c) => c.check === 'odd_sales')?.items).toEqual([]);
      expect(JSON.stringify(checks)).not.toContain('7777');
      const estimated = checks.find((c) => c.check === 'estimated_lots')?.items as {
        of: number;
      }[];
      // The other source's rows (one in the fixture, and this one) are all it counts.
      expect(estimated.map((e) => e.of)).toEqual([2]);
    });

    it('leaves a signal out of a watch valued from them, though it names no source', async () => {
      await addWatch(db, userId, { productId }, { grading: 'raw', rawGrade: 'B' } as never);
      // Fresh, so the saved value (from the other source) and the signal are the ones read.
      const recent = toLocalIso(new Date());
      await db.update(schema.bucketValues).set({ computedAt: recent });
      await db.insert(schema.signals).values({
        productId,
        bucket: 'raw:B',
        day: recent.slice(0, 10),
        source: null,
        stats: { fair: 5000 } as never,
      });
      const [watch] = await watchlist(db, userId);
      expect(watch).toMatchObject({ market: null, buyTiming: null });
    });

    it('shows a link to them, not what came from the site, and no suggestion from them', async () => {
      await db
        .update(schema.productSources)
        .set({ title: 'site title', state: { references: 1 }, lastSuccessAt: at })
        .where(eq(schema.productSources.source, 'ebay'));
      await db.insert(schema.sourceCandidates).values({
        productId,
        source: 'ebay',
        externalId: 'c1',
        title: 'candidate title',
        score: 1,
      });
      const detail = await productDetail(db, userId, productId);
      if ('error' in detail) throw new Error(detail.error);
      const link = detail.sources.find((s) => s.source === 'ebay')!;
      expect(link.listing).toBe('ebay-1');
      for (const key of ['title', 'lastCollected', 'sales', 'latestSale', 'learned']) {
        expect(link).not.toHaveProperty(key);
      }
      expect(detail.pendingSuggestions).toEqual([]);
    });
  });

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

  it('leaves out lots per day, price-bearing messages, and rankings of those sources', async () => {
    const r = withoutSources(
      'select recent from portfolio_charts union all select text from alert_log',
      ['ebay'],
      { portfolio_charts: ['user_id', 'recent'], alert_log: ['kind', 'text'] },
    );
    if ('error' in r) throw new Error(r.error);
    expect(r.sql).toContain('null as "recent"');
    expect(r.sql).toMatch(/case when kind in \('store'.*then text end as "text"/);
    const ranked = withoutSources('select * from rankings', ['ebay']);
    expect(ranked).toHaveProperty('sql', expect.stringContaining('from main.rankings where'));
  });
});
