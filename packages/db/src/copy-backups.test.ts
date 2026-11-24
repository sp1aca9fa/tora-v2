import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '../../..');
const SCRIPT = join(ROOT, 'ops/copy-backups.sh');

// Fake ssh: runs the remote command here, in the folder standing in for the server.
const FAKE_SSH = `#!/usr/bin/env bash
cd "$FAKE_DIR/server" && bash -c "\${@: -1}"
`;
// Fake rsync: records its arguments and copies nothing; each test puts the local files in place.
const FAKE_RSYNC = `#!/usr/bin/env bash
printf '%s\\n' "$@" >"$FAKE_DIR/rsync-args"
`;

// Just the tables the scrub touches; no-ai.test.ts in @tora/mcp checks it on the real schema.
const SCHEMA = `
  create table marks (mark text);
  create table sources (key text, info text, quality text);
  create table price_observations (source text);
  create table price_days_dirty (source text);
  create table supply (source text);
  create table signals (source text);
  create table source_candidates (source text);
  create table rankings (source text);
  create table opening_cards (source text);
  create table opening_sets (source text);
  create table stores (source text);
  create table store_posts (source text);
  create table tcg_sets (source text);
  create table collector_runs (source text);
  create table not_item_marks (source text);
  create table sale_coverage (source text);
  create table sale_spans (source text);
  create table market_jobs (source text);
  create table market_days (source text);
  create table market_state (source text);
  create table item_checks (source text, counts text, note text);
  create table item_rule_state (held text);
  create table wish_levels (series text, record text);
  create table item_sales (sales text);
  create table bucket_values (value text);
  create table product_sources (source text, recent_sales text, state text, failure text,
    title text, image_url text, last_success_at text, details_synced_at text, facts text);
  create table activity (kind text, detail text);
  create table alert_log (kind text, text text);
  create table app_settings (key text, value text);
  create table watches (alert_state text);
  create table users (id text, password_hash text, totp_secret_enc text,
    backup_code_hashes text not null);
  create table account_setups (id text, token_hash text not null unique, totp_secret_enc text);
  create table feed_tokens (user_id text primary key, token_hash text not null);
  create table alert_channels (id text, target_enc text not null);
  create table login_attempts (ip_hash text not null, username_hash text);
`;

let dir: string;
let backups: string;
let server: string;
let analysis: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tora-copy-'));
  backups = join(dir, 'backups');
  server = join(dir, 'server');
  analysis = join(dir, 'analysis', 'tora.db');
  mkdirSync(join(dir, 'bin'));
  mkdirSync(backups);
  mkdirSync(server);
  for (const [name, body] of [
    ['ssh', FAKE_SSH],
    ['rsync', FAKE_RSYNC],
  ] as const) {
    writeFileSync(join(dir, 'bin', name), body);
    chmodSync(join(dir, 'bin', name), 0o755);
  }
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function run(script = SCRIPT) {
  return spawnSync('bash', [script, 'server-host', backups], {
    encoding: 'utf8',
    env: {
      PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
      FAKE_DIR: dir,
      HOME: dir,
      XDG_STATE_HOME: join(dir, 'state'),
      XDG_DATA_HOME: join(dir, 'data'),
      REMOTE_BACKUP_DIR: '.',
      TORA_ANALYSIS_DB: analysis,
    },
  });
}
const rsyncArgs = () => readFileSync(join(dir, 'rsync-args'), 'utf8').trim().split('\n');
const log = () => readFileSync(join(dir, 'state', 'tora', 'copy-backups.log'), 'utf8');
const empty = (folder: string, ...names: string[]) => {
  for (const name of names) writeFileSync(join(folder, name), '');
};
// A backup's copy: a real database, since the sources kept from AI models are taken out of it.
const database = (mark: string, more = '') => {
  const file = join(dir, `${mark}.db`);
  const db = new DatabaseSync(file);
  db.exec(`${SCHEMA} insert into marks values ('${mark}'); ${more}`);
  db.close();
  const bytes = gzipSync(readFileSync(file));
  rmSync(file);
  return bytes;
};
const mark = () => {
  const db = new DatabaseSync(analysis, { readOnly: true });
  const row = db.prepare('select mark from marks').get() as { mark: string };
  db.close();
  return row.mark;
};
const copiedBefore = () => writeFileSync(join(backups, 'tora-2026-11-01.db.gz'), database('old'));

describe('a backup kept by name (`pnpm backup --keep`)', () => {
  it('does not count as one of the server dated backups: 2 dated ones delete nothing here', () => {
    empty(server, 'tora-2026-11-05.db.gz', 'tora-2026-11-06.db.gz', 'pre-recheck.db.gz');
    copiedBefore();
    expect(run().status).toBe(0);
    expect(rsyncArgs()).not.toContain('--delete');
    expect(log()).toContain('the server holds 2 backup(s)');
  });

  it('three dated ones still mirror the folder', () => {
    empty(server, 'tora-2026-11-04.db.gz', 'tora-2026-11-05.db.gz', 'tora-2026-11-06.db.gz');
    copiedBefore();
    expect(run().status).toBe(0);
    expect(rsyncArgs()).toContain('--delete');
  });

  it('is copied here, and the analysis copy still follows the newest dated backup', () => {
    writeFileSync(join(backups, 'tora-2026-11-06.db.gz'), database('dated'));
    // Sorts after every dated name, and it is the newest file too.
    writeFileSync(join(backups, 'zz-kept.db.gz'), database('kept'));
    const later = new Date(Date.now() + 60_000);
    utimesSync(join(backups, 'zz-kept.db.gz'), later, later);
    expect(run().status).toBe(0);
    expect(rsyncArgs()).toContain('--include=*.db.gz');
    expect(mark()).toBe('dated');
    expect(log()).toContain('newest tora-2026-11-06.db.gz');
  });

  it('alone leaves the analysis copy unmade', () => {
    writeFileSync(join(backups, 'pre-recheck.db.gz'), database('kept'));
    run();
    expect(existsSync(analysis)).toBe(false);
  });
});

describe('the analysis copy', () => {
  it('keeps the old copy when the sources kept from AI cannot be taken out of the new one', () => {
    writeFileSync(join(backups, 'tora-2026-11-05.db.gz'), database('old'));
    run();
    expect(mark()).toBe('old');
    const later = new Date(Date.now() + 60_000);
    // Not a database: the scrub fails.
    writeFileSync(join(backups, 'tora-2026-11-06.db.gz'), gzipSync('x'.repeat(5000)));
    utimesSync(join(backups, 'tora-2026-11-06.db.gz'), later, later);
    run();
    expect(mark()).toBe('old');
    expect(readdirSync(join(dir, 'analysis'))).toEqual(['tora.db']);
    expect(log()).toContain('analysis copy NOT refreshed');
  });

  const SOLD = `insert into sources values ('ebay', '{"noAi":true}', null), ('mercari', '{}', null);
    insert into price_observations values ('ebay'), ('mercari');`;
  const sold = () => {
    const db = new DatabaseSync(analysis, { readOnly: true });
    const rows = db.prepare('select source from price_observations').all() as { source: string }[];
    db.close();
    return rows.map((r) => r.source);
  };

  it('is published without them', () => {
    writeFileSync(join(backups, 'tora-2026-11-06.db.gz'), database('new', SOLD));
    expect(run().status).toBe(0);
    expect(mark()).toBe('new');
    expect(sold()).toEqual(['mercari']);
  });

  it('is published without what signs a person in, with or without such a source', () => {
    const ACCOUNTS = `insert into users values ('u', 'secret-1', 'secret-2', '["secret-3"]');
      insert into account_setups values ('a', 'secret-4', 'secret-5'), ('b', 'secret-6', null);
      insert into feed_tokens values ('u', 'secret-7');
      insert into alert_channels values ('c', 'secret-8');
      insert into login_attempts values ('secret-9', 'secret-10');
      insert into app_settings values ('telegramBot', '{"tokenEnc":"secret-11"}'),
        ('statusToken', '{"hash":"secret-12"}'), ('timeZone', '"Asia/Tokyo"');`;
    for (const [day, sql] of [
      ['2026-11-05', ACCOUNTS],
      ['2026-11-06', `${SOLD} ${ACCOUNTS}`],
    ] as const) {
      const file = join(backups, `tora-${day}.db.gz`);
      writeFileSync(file, database(day, sql));
      // The second one is newer than the copy made from the first.
      if (sql !== ACCOUNTS) {
        const later = new Date(Date.now() + 60_000);
        utimesSync(file, later, later);
      }
      expect(run().status).toBe(0);
      expect(mark()).toBe(day);
      // Every statement ran: none was left out for a table this schema lacks.
      expect(/no table/.test(log())).toBe(false);
      const db = new DatabaseSync(analysis, { readOnly: true });
      const all = [
        'users',
        'account_setups',
        'feed_tokens',
        'alert_channels',
        'login_attempts',
        'app_settings',
      ].map((table) => db.prepare(`select * from ${table}`).all());
      db.close();
      expect(all.map((rows) => rows.length)).toEqual([1, 2, 1, 1, 1, 1]);
      expect(JSON.stringify(all)).not.toContain('secret-');
    }
  });

  it('is not published when one statement fails partway', () => {
    writeFileSync(join(backups, 'tora-2026-11-05.db.gz'), database('old', SOLD));
    run();
    expect(mark()).toBe('old');
    const later = new Date(Date.now() + 60_000);
    // The sales go first and commit never comes: it stops at the table with no such column.
    writeFileSync(
      join(backups, 'tora-2026-11-06.db.gz'),
      database('new', `${SOLD} drop table supply; create table supply (other text);`),
    );
    utimesSync(join(backups, 'tora-2026-11-06.db.gz'), later, later);
    run();
    expect(mark()).toBe('old');
    expect(log()).toContain('analysis copy NOT refreshed');
    expect(readdirSync(join(dir, 'analysis'))).toEqual(['tora.db']);
  });

  it('is published from a backup older than the scrub file: a table not there yet is left out', () => {
    // The server's backup before a migration this folder already has: two tables the scrub names
    // (one statement on one line, one over two lines) are not in it. The statements after each
    // of them still run.
    writeFileSync(
      join(backups, 'tora-2026-11-06.db.gz'),
      database(
        'new',
        `${SOLD} drop table not_item_marks; drop table wish_levels;
         insert into sale_coverage values ('ebay'), ('mercari');
         insert into product_sources (source, title) values ('ebay', 'kept from AI'), ('mercari', 'fine');`,
      ),
    );
    expect(run().status).toBe(0);
    expect(mark()).toBe('new');
    expect(sold()).toEqual(['mercari']);
    const db = new DatabaseSync(analysis, { readOnly: true });
    expect(db.prepare('select source from sale_coverage').all()).toEqual([{ source: 'mercari' }]);
    expect(db.prepare('select source, title from product_sources order by source').all()).toEqual([
      { source: 'ebay', title: null },
      { source: 'mercari', title: 'fine' },
    ]);
    db.close();
    expect(log()).toContain('no table not_item_marks in this backup yet');
    expect(log()).toContain('no table wish_levels in this backup yet');
    expect(log()).toContain('analysis copy refreshed');
  });

  // The script beside a made-up scrub file (it reads the one in its own folder).
  const scriptWith = (scrub: string) => {
    mkdirSync(join(dir, 'ops'));
    writeFileSync(join(dir, 'ops', 'copy-backups.sh'), readFileSync(SCRIPT));
    writeFileSync(join(dir, 'ops', 'scrub-analysis.sql'), scrub);
    return join(dir, 'ops', 'copy-backups.sh');
  };
  const HIDDEN = `begin;
create temp table hidden as select key from sources where json_extract(info, '$.noAi');`;

  it('refuses a scrub file with text after a semicolon (the next statement would go with it)', () => {
    const script = scriptWith(`${HIDDEN}
delete from not_item_marks where source in hidden; -- a new table
delete from price_observations where source in hidden;
drop table hidden;
commit;
`);
    writeFileSync(
      join(backups, 'tora-2026-11-06.db.gz'),
      database('new', `${SOLD} drop table not_item_marks;`),
    );
    run(script);
    expect(existsSync(analysis)).toBe(false);
    expect(log()).toContain('text after a semicolon');
    expect(log()).toContain('analysis copy NOT refreshed');
  });

  it('leaves out only the plain shapes: any other statement is kept and run', () => {
    const script = scriptWith(`${HIDDEN}
delete from hidden where key = 'mercari';
delete from main.price_observations where source in hidden;
update or replace supply set source = source where source in hidden;
delete from not_item_marks where source in hidden;
drop table hidden;
commit;
`);
    writeFileSync(
      join(backups, 'tora-2026-11-06.db.gz'),
      database('new', `${SOLD} drop table not_item_marks;`),
    );
    expect(run(script).status).toBe(0);
    expect(sold()).toEqual(['mercari']);
    // A table the file made itself is there: its statement ran too.
    expect(log()).not.toContain('no table hidden');
    expect(log()).not.toContain('no table or ');
    expect(log()).not.toContain('mainprice_observations');
    expect(log()).toContain('no table not_item_marks in this backup yet');
  });

  it('a statement of another shape on a missing table fails the scrub', () => {
    const script = scriptWith(`${HIDDEN}
delete from main.not_item_marks where source in hidden;
drop table hidden;
commit;
`);
    writeFileSync(
      join(backups, 'tora-2026-11-06.db.gz'),
      database('new', `${SOLD} drop table not_item_marks;`),
    );
    run(script);
    expect(existsSync(analysis)).toBe(false);
    expect(log()).toContain('analysis copy NOT refreshed');
  });

  it('is not published when a table a kept statement reads is missing', () => {
    writeFileSync(join(backups, 'tora-2026-11-05.db.gz'), database('old', SOLD));
    run();
    const later = new Date(Date.now() + 60_000);
    // No registry of sources: which ones are kept from AI cannot be known.
    writeFileSync(
      join(backups, 'tora-2026-11-06.db.gz'),
      database('new', `${SOLD} drop table sources;`),
    );
    utimesSync(join(backups, 'tora-2026-11-06.db.gz'), later, later);
    run();
    expect(mark()).toBe('old');
    expect(log()).toContain('analysis copy NOT refreshed');
  });

  it('is not published when it fails its integrity check', () => {
    writeFileSync(join(backups, 'tora-2026-11-05.db.gz'), database('old', SOLD));
    run();
    const later = new Date(Date.now() + 60_000);
    writeFileSync(join(backups, 'tora-2026-11-06.db.gz'), database('new', SOLD));
    utimesSync(join(backups, 'tora-2026-11-06.db.gz'), later, later);
    const real = spawnSync('which', ['sqlite3'], { encoding: 'utf8' }).stdout.trim();
    writeFileSync(
      join(dir, 'bin', 'sqlite3'),
      `#!/usr/bin/env bash\ncase "$*" in *integrity_check*) echo bad ;; *) exec ${real} "$@" ;; esac\n`,
    );
    chmodSync(join(dir, 'bin', 'sqlite3'), 0o755);
    run();
    expect(mark()).toBe('old');
    expect(log()).toContain('analysis copy NOT refreshed');
  });

  it("removes an interrupted run's full file once it is old, and leaves another run's", () => {
    mkdirSync(join(dir, 'analysis'));
    const old = new Date(Date.now() - 2 * 3_600_000);
    writeFileSync(`${analysis}.part.1`, 'full');
    utimesSync(`${analysis}.part.1`, old, old);
    writeFileSync(`${analysis}.part.2`, 'another run');
    writeFileSync(join(backups, 'tora-2026-11-06.db.gz'), database('new', SOLD));
    run();
    expect(mark()).toBe('new');
    expect(readdirSync(join(dir, 'analysis')).sort()).toEqual(['tora.db', 'tora.db.part.2']);
    // Also when no refresh is due.
    writeFileSync(`${analysis}.part.3`, 'full');
    utimesSync(`${analysis}.part.3`, old, old);
    run();
    expect(existsSync(`${analysis}.part.3`)).toBe(false);
  });
});
