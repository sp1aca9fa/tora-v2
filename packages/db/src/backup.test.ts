import { createClient } from '@libsql/client';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { beforeEach, expect, it } from 'vitest';
import {
  BLOB_PAGE,
  backupDatabase,
  backupName,
  backupsToKeep,
  listBackups,
  pruneBackups,
  refreshAnalysisCopy,
  restoreDatabase,
} from './backup';
import { type Db, createDb } from './client';
import { migrateDb } from './migrate';
import { seedCollection } from './seed';
import { insertObservations } from './sources';
import { createUser } from './users';
import { portfolioValuation } from './valuation';

let dir: string;
let db: Db;
let userId: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tora-backup-test-'));
  db = createDb({ url: `file:${join(dir, 'live.db')}` });
  await migrateDb(db);
  userId = (
    await createUser(db, 'a', { passwordHash: 'x', totpSecretEnc: 'y', backupCodeHashes: [] })
  ).user.id;
  return () => rm(dir, { recursive: true, force: true });
});

/** Every row of every table, in order. */
async function contents(d: Db) {
  const tables = await d.all<{ name: string }>(
    sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
  );
  const out: Record<string, unknown[]> = {};
  for (const { name } of tables) {
    out[name] = await d.all(sql.raw(`SELECT * FROM "${name}" ORDER BY rowid`));
  }
  return out;
}

it('restores a backup into an empty database exactly (scenario 8)', async () => {
  // Lots with history and pulls from a box (a lot pointing at another), and a collected price.
  await seedCollection(db, userId);
  const [lot] = await db.all<{ product_id: string }>(sql`SELECT product_id FROM holdings LIMIT 1`);
  await insertObservations(db, [
    {
      productId: lot!.product_id,
      source: 'shop',
      observationType: 'sold',
      bucket: null,
      priceBase: 21_000,
      priceOriginal: 21_000,
      currency: 'JPY',
      observedAt: '2026-10-01T12:00:00.000+09:00',
      fetchedAt: '2026-10-01T12:00:00.000+09:00',
      externalRef: 'a',
      raw: { title: 'ﾃｽﾄ "quoted"', n: 1.5 },
    },
  ]);
  // Pictures, over more than one page of rows holding files.
  const at = '2026-10-01T12:00:00.000+09:00';
  await db.run(sql`INSERT INTO stores (id, source, source_key, chain, name, codes, created_at, updated_at)
    VALUES ('s', 'board', 'k', 'megastore', 'Megastore', '[]', ${at}, ${at})`);
  await db.run(sql`INSERT INTO store_posts (id, source, external_id, text, posted_at, received_at, store_ids)
    VALUES ('p', 'board', '1', 'In stock', ${at}, ${at}, '["s"]')`);
  for (let i = 0; i < BLOB_PAGE * 2 + 1; i++) {
    await db.run(sql`INSERT INTO store_post_images (id, post_id, position, bytes, content_type, created_at)
      VALUES (${`i${i}`}, 'p', ${i}, ${Buffer.from([0xff, 0xd8, i])}, 'image/jpeg', ${at})`);
  }
  const file = join(dir, backupName('2026-10-16'));
  const backup = await backupDatabase(createClient({ url: `file:${join(dir, 'live.db')}` }), file);
  expect(backup.rows).toBeGreaterThan(10);
  expect(backup.bytes).toBeGreaterThan(0);

  const target = createClient({ url: `file:${join(dir, 'restored.db')}` });
  // As on Turso: references are enforced.
  await target.execute('PRAGMA foreign_keys = ON');
  const restored = await restoreDatabase(file, target);
  expect(restored).toEqual({ tables: backup.tables, rows: backup.rows });
  const copy = createDb({ url: `file:${join(dir, 'restored.db')}` });
  expect(await contents(copy)).toEqual(await contents(db));
  expect((await portfolioValuation(copy, userId)).totals).toEqual(
    (await portfolioValuation(db, userId)).totals,
  );
  // Indexes came along; nothing is pending for the restored database.
  const indexes = sql`SELECT count(*) AS n FROM sqlite_master WHERE type = 'index'`;
  expect(await copy.all(indexes)).toEqual(await db.all(indexes));

  await expect(
    target.execute(
      "INSERT INTO holdings (id, user_id, product_id, acquired_at, created_at, updated_at) VALUES ('x', 'no', 'no', '', '', '')",
    ),
  ).rejects.toThrow(/FOREIGN KEY/);

  // A database with data is never overwritten.
  await expect(restoreDatabase(file, target)).rejects.toThrow(/not empty/);
});

it('unpacks the latest backup as the analysis copy, only when newer', async () => {
  const backups = join(dir, 'backups');
  const target = join(dir, 'analysis', 'tora.db');
  expect(await refreshAnalysisCopy(backups, target)).toBeNull();
  await mkdir(backups);
  const live = createClient({ url: `file:${join(dir, 'live.db')}` });
  await backupDatabase(live, join(backups, backupName('2026-10-17')));
  expect(await refreshAnalysisCopy(backups, target)).toBe('2026-10-17');
  const copy = createDb({ url: `file:${target}` });
  expect(await contents(copy)).toEqual(await contents(db));
  copy.$client.close();
  // Up to date: left alone.
  const before = (await stat(target)).mtimeMs;
  expect(await refreshAnalysisCopy(backups, target)).toBe('2026-10-17');
  expect((await stat(target)).mtimeMs).toBe(before);
});

it('keeps the last 30 days and the first backup of each month for a year', async () => {
  const days: string[] = [];
  for (let t = Date.parse('2025-06-01'); t <= Date.parse('2026-10-16'); t += 86_400_000) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  const keep = backupsToKeep(days, '2026-10-16');
  const monthly = [...keep].filter((d) => d < '2026-09-17');
  expect(monthly).toEqual([
    '2025-11-01',
    '2025-12-01',
    '2026-01-01',
    '2026-02-01',
    '2026-03-01',
    '2026-04-01',
    '2026-05-01',
    '2026-06-01',
    '2026-07-01',
    '2026-08-01',
    '2026-09-01',
  ]);
  expect([...keep].filter((d) => d >= '2026-09-17')).toHaveLength(30);

  // Gaps (the PC was off): the month's first copy is whichever came first.
  await writeFile(join(dir, backupName('2026-03-05')), '');
  await writeFile(join(dir, backupName('2026-03-20')), '');
  await writeFile(join(dir, backupName('2024-01-01')), '');
  await writeFile(join(dir, 'notes.txt'), '');
  expect(await pruneBackups(dir, '2026-10-16')).toBe(2);
  expect(await listBackups(dir)).toEqual(['2026-03-05']);
});
