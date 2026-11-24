import { type Db, createDb, createUser, saveSetting, saveSourceInfos } from '@tora/db';
import { migrateDb } from '@tora/db/migrate';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { SECRET_COLUMNS, SECRET_SETTINGS, querySql, readOnlyRows, withoutSources } from './tools';

const scrubScript = () =>
  readFile(join(import.meta.dirname, '../../../ops/scrub-analysis.sql'), 'utf8');

/** Values for the columns a row needs besides its secrets (the rest take a plain 'x' or 1). */
const GIVEN: Record<string, Record<string, string | number>> = {
  account_setups: { kind: 'both', expires_at: '2026-12-01T00:00:00.000+09:00' },
  alert_channels: { kind: 'discord' },
  login_attempts: { success: 0, attempted_at: '2026-11-24T00:00:00.000+09:00' },
};

/** One row in a table, every column filled, the secret ones with a recognizable value. */
async function fill(db: Db, table: string, userId: string) {
  const info = await db.$client.execute({
    sql: 'select name, type from pragma_table_info(?)',
    args: [table],
  });
  const values: Record<string, string | number> = {};
  for (const c of info.rows) {
    const name = String(c.name);
    if (SECRET_COLUMNS[table]!.includes(name)) values[name] = `secret-${table}-${name}`;
    else if (name === 'user_id' || name === 'created_by') values[name] = userId;
    else if (GIVEN[table]?.[name] !== undefined) values[name] = GIVEN[table][name]!;
    else values[name] = /int/i.test(String(c.type)) ? 1 : `x-${name}`;
  }
  const names = Object.keys(values);
  await db.$client.execute({
    sql: `insert or replace into ${table} (${names.join(', ')}) values (${names.map(() => '?').join(', ')})`,
    args: names.map((n) => values[n]!),
  });
}

describe('what signs a person in or reaches them, through query_sql and in the analysis copy', () => {
  let db: Db;
  let userId: string;
  let probe: string;
  let file: string;

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tora-secrets-'));
    probe = join(dir, 'probe.txt');
    await writeFile(probe, 'secret-file');
    file = join(dir, 'test.db');
    db = createDb({ url: `file:${file}` });
    await migrateDb(db);
    userId = (
      await createUser(db, 'a', {
        passwordHash: 'secret-users-password_hash',
        totpSecretEnc: 'secret-users-totp_secret_enc',
        backupCodeHashes: ['secret-users-backup_code_hashes'],
      })
    ).user.id;
    for (const table of Object.keys(SECRET_COLUMNS)) {
      if (table !== 'users') await fill(db, table, userId);
    }
    await saveSetting(db, 'telegramBot', { tokenEnc: 'secret-setting', username: 'bot' });
    await saveSetting(db, 'statusToken', { hash: 'secret-setting', createdAt: 'x' });
    await saveSetting(db, 'timeZone', 'Asia/Tokyo');
  });

  const rows = async (sql: string) => {
    const r = await querySql(db, sql);
    if ('error' in r) throw new Error(r.error);
    return r.rows as Record<string, unknown>[];
  };
  const noSecret = (value: unknown) => expect(JSON.stringify(value)).not.toContain('secret-');

  for (const noAi of [false, true]) {
    describe(noAi ? 'with a source kept from AI' : 'with no source kept from AI', () => {
      beforeEach(async () => {
        await saveSourceInfos(db, [
          { key: 'ebay', label: 'E', ...(noAi && { noAi: true }) },
          { key: 'mercari', label: 'M' },
        ]);
      });

      for (const [table, columns] of Object.entries(SECRET_COLUMNS)) {
        it(`reads ${table} without ${columns.join(', ')}`, async () => {
          const all = await rows(`select * from ${table}`);
          expect(all).toHaveLength(1);
          for (const c of columns) expect(all[0]![c], c).toBeNull();
          noSecret(all);
          // The other columns are still there.
          expect(Object.values(all[0]!).some((v) => v !== null)).toBe(true);
          for (const c of columns) {
            noSecret(await rows(`select ${c} from ${table}`));
            noSecret(await rows(`select t."${c}" as x from "${table}" t`));
            noSecret(await rows(`select group_concat(${c}) as x from [${table}]`));
            noSecret(await rows(`with y as (select * from ${table}) select * from y`));
          }
        });
      }

      it('reaches no table past its guard', async () => {
        for (const sql of [
          'select * from main.users',
          'select * from "main"."users"',
          'select * from main . account_setups',
          'select * from temp.users',
          'with users as (select * from main.users) select * from users',
          'with users as (select 1) select * from users',
          // A closing parenthesis must not take the rest of the query out of the guards' reach.
          'select 1 as k, 1 as v) union all select key, value from app_settings where (1',
          'select 1 as k) union all select password_hash from users where (1',
          // The shared column of such a join is built without the connection being asked.
          'select * from users natural full join (select null as password_hash) x',
          'select password_hash from users full join (select null as password_hash) x using (password_hash)',
          "select count(*) from users join (select 'x' as password_hash) y using (password_hash)",
          'select * from feed_tokens natural join users',
          'select * from main.app_settings',
          'select * from "main"."app_settings"',
          'select * from main . app_settings',
          'select * from temp.app_settings',
          'with app_settings as (select 1) select * from app_settings',
          'select * from sqlite_dbpage',
          'select * from sqlite_stat1',
          'select * from sqlite_stat4',
          'select * from dbstat',
          'select * from pragma_database_list',
          "select * from pragma_journal_mode('delete')",
          // A parameter token swallows a comment opener, hiding what follows from a text check.
          'select $a(/*) as x, value from main.app_settings /**/',
          'select :a(--) as x, value from main.app_settings',
          "select @a(') as x, value from main/**/.app_settings /*'*/",
          'select #a(/*) as x, quote(data) as d from sqlite_dbpage /**/',
          'select ?1 as x, value from app_settings',
          // Files: nothing is read, written or listed.
          `select readfile('${probe}') as x`,
          `select writefile('${probe}.new', 'x') as x`,
          `select name from fsdir('${dirname(probe)}')`,
          "select load_extension('x')",
        ]) {
          expect(await querySql(db, sql), sql).toHaveProperty('error');
        }
        expect(existsSync(`${probe}.new`)).toBe(false);
      });

      it('answers null for a secret however the query reads the table', async () => {
        for (const sql of [
          'select u.* from users u, users v',
          'select (select group_concat(token_hash) from account_setups) as x',
          'select hex(password_hash) as x, length(totp_secret_enc) as n from users',
          'select * from users u left join account_setups a on a.user_id = u.id',
          'select * from (select * from (select * from users))',
          'select password_hash from users union all select totp_secret_enc from users',
          'select max(password_hash) as x, min(target_enc) as y from users, alert_channels',
          'select * from users order by password_hash',
        ]) {
          const all = await rows(sql);
          expect(all.length, sql).toBeGreaterThan(0);
          noSecret(all);
        }
        // Nothing can be learned by testing a secret either: it compares as null.
        expect(
          await rows("select count(*) as n from users where password_hash like 'secret%'"),
        ).toEqual([{ n: 0 }]);
      });

      it('reads at most the rows asked for', async () => {
        const many =
          'with recursive n(i) as (select 1 union all select i + 1 from n where i < 5000) select i from n';
        const some = await querySql(db, many, 3);
        expect('rows' in some && some.rows).toEqual([{ i: 1 }, { i: 2 }, { i: 3 }]);
        const most = await querySql(db, many, 100000);
        expect('rows' in most && most.rows.length).toBe(1000);
      });

      it('reads no setting holding a token, and still the readable ones', async () => {
        const settings = await rows('select key, value from app_settings');
        noSecret(settings);
        for (const key of SECRET_SETTINGS) {
          expect(settings.find((s) => s.key === key)).toMatchObject({ value: null });
        }
        expect(settings.find((s) => s.key === 'timeZone')?.value).toContain('Asia/Tokyo');
        noSecret(await rows("select json_extract(value, '$.tokenEnc') as x from app_settings"));
      });

      it('still reads the shape of a table', async () => {
        const columns = await rows("select name from pragma_table_info('users')");
        expect(columns.map((c) => c.name)).toContain('password_hash');
        expect(await rows("select count(*) as n from sqlite_master where name = 'users'")).toEqual([
          { n: 1 },
        ]);
      });

      it('still counts accounts, devices and attempts', async () => {
        expect(await rows('select count(*) as n, max(username) as name from users')).toEqual([
          { n: 1, name: 'a' },
        ]);
        expect(await rows('select count(*) as n from login_attempts')).toEqual([{ n: 1 }]);
      });
    });
  }

  it('keeps every column when two share a name', async () => {
    const r = await querySql(db, 'select 1 as id, 2 as id, 3 as x, 4 as id');
    expect(r).toEqual({
      columns: ['id', 'id:1', 'x', 'id:2'],
      rows: [{ id: 1, 'id:1': 2, x: 3, 'id:2': 4 }],
    });
  });

  it('gives blobs as their size and large integers whole', async () => {
    expect(await rows("select x'0102' as b, 9007199254740993 as big, 7 as n, 1.5 as f")).toEqual([
      { b: '(blob, 2 bytes)', big: '9007199254740993', n: 7, f: 1.5 },
    ]);
  });

  it('passes a query naming none of these tables through unchanged', () => {
    for (const sql of ['select 1 from products', 'select count(*) from user_devices']) {
      expect(withoutSources(sql, [])).toEqual({ sql });
    }
  });

  describe('the connection alone, without the rewritten query', () => {
    const direct = (sql: string, limit = 50) => readOnlyRows(file, sql, limit);

    it('refuses every secret column of the real tables', async () => {
      for (const [table, columns] of Object.entries(SECRET_COLUMNS)) {
        for (const c of columns) {
          for (const sql of [
            `select ${c} from ${table}`,
            `select * from ${table}`,
            `select count(*) from ${table} where ${c} is not null`,
            `select 1 from ${table} order by ${c}`,
          ]) {
            expect(await direct(sql), sql).toMatchObject({
              error: expect.stringMatching(/prohibited|not authorized/),
            });
          }
        }
        expect(await direct(`select count(*) as n from ${table}`), table).toMatchObject({
          rows: [{ n: 1 }],
        });
      }
    });

    it('refuses everything but reading tables', async () => {
      for (const sql of [
        'select * from dbstat',
        'select * from pragma_database_list',
        'pragma journal_mode',
        "pragma journal_mode = 'wal'",
        'delete from products',
        'create table x (a)',
        'create temp table x (a)',
        "attach database ':memory:' as other",
        'vacuum',
        "select load_extension('x')",
        `select readfile('${probe}')`,
      ]) {
        expect(await direct(sql), sql).toHaveProperty('error');
      }
      expect(await direct("select name from pragma_table_info('users')")).toHaveProperty('rows');
      expect(await direct('select username from users')).toMatchObject({
        rows: [{ username: 'a' }],
      });
    });

    // The second connection is safe only while libSQL holds no lock between statements (see
    // `readOnlyRows`): with WAL it would, and closing the reader would drop it.
    it('rests on a rollback journal', async () => {
      const mode = await db.$client.execute('pragma journal_mode');
      expect(String(mode.rows[0]?.journal_mode)).toBe('delete');
    });
  });

  it('knows every column that looks like a secret', async () => {
    // Reviewed: fingerprints of an item's rules or of a level's inputs, and the migrations' own.
    const notSecret = new Set([
      'item_checks.rules_hash',
      'item_rule_state.applied_hash',
      'wish_levels.inputs_hash',
      '__drizzle_migrations.hash',
    ]);
    const rs = await db.$client.execute(
      "select m.name as tbl, p.name as col from sqlite_master m, pragma_table_info(m.name) p where m.type = 'table'",
    );
    const unknown = rs.rows
      .map((r) => ({ table: String(r.tbl), column: String(r.col) }))
      .filter(({ column }) => /hash|_enc$|secret|token|password/i.test(column))
      .filter(({ table, column }) => !SECRET_COLUMNS[table]?.includes(column))
      .map(({ table, column }) => `${table}.${column}`)
      .filter((name) => !notSecret.has(name));
    expect(unknown).toEqual([]);
  });

  it('the analysis copy holds none of them, whatever the sources', async () => {
    const scrub = await scrubScript();
    for (const table of Object.keys(SECRET_COLUMNS)) {
      expect(scrub, table).toContain(`update ${table} set`);
    }
    await db.$client.executeMultiple(scrub);
    for (const table of Object.keys(SECRET_COLUMNS)) {
      const direct = await db.$client.execute(`select * from ${table}`);
      expect(direct.rows, table).toHaveLength(1);
      noSecret(direct.rows);
    }
    const settings = await db.$client.execute('select key, value from app_settings');
    noSecret(settings.rows);
    expect(settings.rows.map((r) => r.key)).toEqual(['timeZone']);
  });
});
