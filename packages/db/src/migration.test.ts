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
      cost_total_jpy: 5400,
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
