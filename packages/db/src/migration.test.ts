// Upgrading a database created before accounts/taxonomy (migration 0001) keeps its data.
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createDb } from './client';
import { MIGRATIONS_FOLDER, migrateDb, pendingMigrations } from './migrate';

it('maps old products and assigns old holdings to the placeholder owner', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-mig-'));
  try {
    // Migrations folder containing only 0000.
    const v0 = join(dir, 'v0');
    await cp(MIGRATIONS_FOLDER, v0, { recursive: true });
    const journalPath = join(v0, 'meta', '_journal.json');
    const journal = JSON.parse(await readFile(journalPath, 'utf8'));
    journal.entries = journal.entries.slice(0, 1);
    await writeFile(journalPath, JSON.stringify(journal));

    const client = createClient({ url: `file:${join(dir, 'db.sqlite')}` });
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: v0 });

    const ts = '2026-10-01T00:00:00.000+09:00';
    await client.batch([
      `INSERT INTO products (id, type, name_ja, name_en, franchise, language, created_at, updated_at)
       VALUES ('P1', 'sealed_tcg', '30周年 BOX', 'Anniversary BOX', 'Pokemon', 'JP', '${ts}', '${ts}')`,
      `INSERT INTO products (id, type, name_en, franchise, created_at, updated_at)
       VALUES ('P2', 'game_ce', 'Fire Emblem CE', 'Fire Emblem', '${ts}', '${ts}')`,
      `INSERT INTO holdings (id, product_id, quantity, cost_total_jpy, acquired_at, packaging_state, created_at, updated_at)
       VALUES ('H1', 'P1', 1, 5400, '${ts}', 'box_opened_contents_sealed', '${ts}', '${ts}')`,
      `INSERT INTO holding_events (id, holding_id, type, occurred_at, created_at, updated_at)
       VALUES ('E1', 'H1', 'acquired', '${ts}', '${ts}', '${ts}')`,
    ]);

    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    const products = (await client.execute('SELECT * FROM products ORDER BY id')).rows;
    expect(products[0]).toMatchObject({
      category: 'tcg',
      kind: 'booster_box',
      name: '30周年 BOX',
      name_alias: 'Anniversary BOX',
      franchise: 'pokemon',
      region: 'jp',
    });
    expect(products[1]).toMatchObject({
      category: 'game',
      kind: 'collectors_edition',
      name: 'Fire Emblem CE',
      name_alias: null,
      franchise: 'Fire Emblem',
    });
    const [holding] = (await client.execute('SELECT * FROM holdings')).rows;
    expect(holding).toMatchObject({
      id: 'H1',
      user_id: '00000000000000000000000000',
      cost_total_base: 5400,
    });
    const [owner] = (await client.execute('SELECT * FROM users')).rows;
    expect(owner).toMatchObject({ username: 'owner', password_hash: null, role: 'admin' });
    expect((await client.execute('SELECT count(*) n FROM holding_events')).rows[0]?.n).toBe(1);
    const fk = await client.execute('PRAGMA foreign_key_check');
    expect(fk.rows).toHaveLength(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('creates no placeholder on an empty database', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-mig-'));
  try {
    const client = createClient({ url: `file:${join(dir, 'db.sqlite')}` });
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
    expect((await client.execute('SELECT count(*) n FROM users')).rows[0]?.n).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('lists migrations the database has not applied', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-mig-'));
  try {
    const db = createDb({ url: `file:${join(dir, 'db.sqlite')}` });
    const all = (
      JSON.parse(await readFile(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8')) as {
        entries: { tag: string }[];
      }
    ).entries.map((e) => e.tag);
    expect(await pendingMigrations(db)).toEqual(all);
    await migrateDb(db);
    expect(await pendingMigrations(db)).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('renames yen amounts to base ones, in columns and inside saved JSON (0023)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-mig-'));
  try {
    const before = join(dir, 'v22');
    await cp(MIGRATIONS_FOLDER, before, { recursive: true });
    const journalPath = join(before, 'meta', '_journal.json');
    const journal = JSON.parse(await readFile(journalPath, 'utf8'));
    journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 22);
    await writeFile(journalPath, JSON.stringify(journal));
    const client = createClient({ url: `file:${join(dir, 'db.sqlite')}` });
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: before });
    const ts = '2026-10-01T00:00:00.000+09:00';
    await client.batch([
      `INSERT INTO products (id, category, kind, name, created_at, updated_at) VALUES ('P1', 'tcg', 'booster_box', 'Box', '${ts}', '${ts}')`,
      `INSERT INTO product_sources (id, product_id, source, external_id, recent_sales, created_at, updated_at)
       VALUES ('S1', 'P1', 'shop', '1', '[{"bucket":null,"priceJpy":5400,"observedAt":"${ts}"}]', '${ts}', '${ts}')`,
      `INSERT INTO bucket_values (id, product_id, bucket, computed_at, value, created_at, updated_at)
       VALUES ('B1', 'P1', 'sealed:shrink', '${ts}', '{"valuation":{"unitJpy":5400,"method":"median"}}', '${ts}', '${ts}')`,
      `INSERT INTO price_observations (id, product_id, source, observation_type, price_jpy, observed_at, fetched_at, external_ref, created_at, updated_at)
       VALUES ('O1', 'P1', 'shop', 'sold', 5400, '${ts}', '${ts}', 'r', '${ts}', '${ts}')`,
    ]);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    const one = async (q: string) => (await client.execute(q)).rows[0];
    expect(await one('SELECT recent_sales v FROM product_sources')).toMatchObject({
      v: `[{"bucket":null,"priceBase":5400,"observedAt":"${ts}"}]`,
    });
    expect(await one('SELECT value v FROM bucket_values')).toMatchObject({
      v: '{"valuation":{"unitBase":5400,"method":"median"}}',
    });
    expect(await one('SELECT price_base v FROM price_observations')).toMatchObject({ v: 5400 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('gives items their type and games their own roles, keeping every row (0024)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tora-mig-'));
  try {
    const before = join(dir, 'v23');
    await cp(MIGRATIONS_FOLDER, before, { recursive: true });
    const journalPath = join(before, 'meta', '_journal.json');
    const journal = JSON.parse(await readFile(journalPath, 'utf8'));
    journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 23);
    await writeFile(journalPath, JSON.stringify(journal));
    const client = createClient({ url: `file:${join(dir, 'db.sqlite')}` });
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: before });
    const ts = '2026-10-01T00:00:00.000+09:00';
    const product = (id: string, category: string, kind: string) =>
      `INSERT INTO products (id, category, kind, name, created_at, updated_at) VALUES ('${id}', '${category}', '${kind}', 'x', '${ts}', '${ts}')`;
    await client.batch([
      product('P1', 'tcg', 'single'),
      product('P2', 'tcg', 'booster_box'),
      product('P3', 'tcg', 'supply'),
      product('P4', 'game', 'software'),
      `INSERT INTO price_observations (id, product_id, source, observation_type, price_base, observed_at, fetched_at, external_ref, created_at, updated_at)
       VALUES ('O1', 'P4', 'shop', 'sold', 5400, '${ts}', '${ts}', 'r', '${ts}', '${ts}')`,
      `INSERT INTO sources (key, info, roles, created_at, updated_at) VALUES ('shop', '{"key":"shop","label":"Shop","roles":{"item":"reference"},"identity":["item"]}', '{"item":"supporting"}', '${ts}', '${ts}')`,
      `INSERT INTO app_settings (key, value, created_at, updated_at) VALUES ('sourceOrder', '{"item":["shop"]}', '${ts}', '${ts}')`,
      `INSERT INTO app_settings (key, value, created_at, updated_at) VALUES ('markets', '{"primary":"jp","identity":{"jp":{"item":"shop","card":null}}}', '${ts}', '${ts}')`,
    ]);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    const all = async (q: string) => (await client.execute(q)).rows;
    expect(
      (await all('SELECT id, item_type FROM products ORDER BY id')).map((r) => r.item_type),
    ).toEqual(['card', 'sealed', 'item', 'game']);
    expect(await all('SELECT product_id FROM price_observations')).toHaveLength(1);
    const [source] = await all('SELECT info, roles FROM sources');
    expect(JSON.parse(String(source!.roles))).toEqual({ item: 'supporting', game: 'supporting' });
    expect(JSON.parse(String(source!.info))).toMatchObject({
      roles: { item: 'reference', game: 'reference' },
      identity: ['item', 'game'],
    });
    const settings = Object.fromEntries(
      (await all('SELECT key, value FROM app_settings')).map((r) => [
        r.key,
        JSON.parse(String(r.value)),
      ]),
    );
    expect(settings.sourceOrder).toEqual({ item: ['shop'], game: ['shop'] });
    expect(settings.markets.identity.jp).toEqual({ item: 'shop', card: null, game: 'shop' });
    // Category and kind are no longer limited to the built-in ones.
    await client.execute(product('P5', 'watch', 'wrist'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
