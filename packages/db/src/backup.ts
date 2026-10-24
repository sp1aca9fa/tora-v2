// Backups of the whole database (requirements S6): a dated, compressed SQLite copy on the home PC
// after the daily collect, and a restore into an empty database. Not exported from the package
// index: the web app never needs it.
import { type Client, type InStatement, type ResultSet, createClient } from '@libsql/client';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readdir, rename, rm, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';

/** Rows read (and written) per request. */
const PAGE = 2000;
/** Rows per request for tables holding files (pictures of up to a few MB each). */
export const BLOB_PAGE = 10;

/** The backups folder: `BACKUP_DIR`, else `~/.local/share/tora/backups`. */
export function backupDir(env: Record<string, string | undefined> = process.env): string {
  const data = env.XDG_DATA_HOME?.trim() || join(homedir(), '.local', 'share');
  return env.BACKUP_DIR?.trim() || join(data, 'tora', 'backups');
}

export const backupName = (day: string) => `tora-${day}.db.gz`;

/**
 * The analysis copy (S19): the latest backup, unpacked, for Claude Code's heavy queries (the MCP
 * `query_sql` tool, analysis scripts), so they never read Turso. `TORA_ANALYSIS_DB`, else
 * `~/.local/share/tora/analysis/tora.db`.
 */
export function analysisCopyPath(env: Record<string, string | undefined> = process.env): string {
  const data = env.XDG_DATA_HOME?.trim() || join(homedir(), '.local', 'share');
  return env.TORA_ANALYSIS_DB?.trim() || join(data, 'tora', 'analysis', 'tora.db');
}
const NAME = /^tora-(\d{4}-\d{2}-\d{2})\.db\.gz$/;

interface SchemaEntry {
  type: string;
  name: string;
  sql: string;
}

/** The database's tables (parents before the tables pointing at them), then its indexes, triggers and views. */
async function schemaOf(c: Client): Promise<{ tables: SchemaEntry[]; rest: SchemaEntry[] }> {
  const rs = await c.execute(`SELECT type, name, sql FROM sqlite_master
    WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'
      AND name NOT LIKE 'libsql\\_%' ESCAPE '\\' AND name NOT LIKE '\\_litestream%' ESCAPE '\\'
    ORDER BY rowid`);
  const entries = rs.rows.map((r) => ({
    type: String(r.type),
    name: String(r.name),
    sql: String(r.sql),
  }));
  const tables = entries.filter((e) => e.type === 'table');
  const parents = new Map<string, string[]>();
  for (const t of tables) {
    const fk = await c.execute({
      sql: 'SELECT DISTINCT "table" AS parent FROM pragma_foreign_key_list(?)',
      args: [t.name],
    });
    parents.set(
      t.name,
      fk.rows.map((r) => String(r.parent)).filter((p) => p !== t.name),
    );
  }
  const ordered: SchemaEntry[] = [];
  const seen = new Set<string>();
  const visit = (t: SchemaEntry, path: Set<string>) => {
    if (seen.has(t.name) || path.has(t.name)) return;
    path.add(t.name);
    for (const p of parents.get(t.name) ?? []) {
      const parent = tables.find((x) => x.name === p);
      if (parent) visit(parent, path);
    }
    seen.add(t.name);
    ordered.push(t);
  };
  for (const t of tables) visit(t, new Set());
  return { tables: ordered, rest: entries.filter((e) => e.type !== 'table') };
}

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

async function count(c: Client, table: string): Promise<number> {
  const rs = await c.execute(`SELECT count(*) AS n FROM ${quote(table)}`);
  return Number(rs.rows[0]?.n ?? 0);
}

/** Copies a table's rows in pages, oldest first (a lot before the lots split from it). */
async function copyRows(from: Client, to: Client, table: string, page = PAGE): Promise<number> {
  let last: number | null = null;
  let copied = 0;
  for (;;) {
    const rs: ResultSet = await from.execute({
      sql: `SELECT rowid AS "__rowid", * FROM ${quote(table)}
        ${last === null ? '' : 'WHERE rowid > ?'} ORDER BY rowid LIMIT ${page}`,
      args: last === null ? [] : [last],
    });
    if (rs.rows.length === 0) return copied;
    const columns = rs.columns.slice(1);
    const insert = `INSERT INTO ${quote(table)} (${columns.map(quote).join(', ')})
      VALUES (${columns.map(() => '?').join(', ')})`;
    const statements: InStatement[] = rs.rows.map((r) => ({
      sql: insert,
      args: columns.map((_, i) => r[i + 1] ?? null),
    }));
    // References are checked at the end of each page, not row by row.
    await to.batch(['PRAGMA defer_foreign_keys = ON', ...statements], 'write');
    copied += rs.rows.length;
    last = Number(rs.rows[rs.rows.length - 1]![0]);
    if (rs.rows.length < page) return copied;
  }
}

/** Copies every table, then indexes, triggers and views; checks each table's row count. */
async function copyDatabase(from: Client, to: Client): Promise<{ tables: number; rows: number }> {
  const { tables, rest } = await schemaOf(from);
  let rows = 0;
  for (const t of tables) {
    await to.execute(t.sql);
    const copied = await copyRows(from, to, t.name, /\bblob\b/i.test(t.sql) ? BLOB_PAGE : PAGE);
    const expected = await count(from, t.name);
    const now = await count(to, t.name);
    if (copied !== expected || now !== expected) {
      throw new Error(`${t.name}: ${now} of ${expected} rows copied`);
    }
    rows += copied;
  }
  for (const e of rest) await to.execute(e.sql);
  return { tables: tables.length, rows };
}

export interface BackupResult {
  file: string;
  bytes: number;
  tables: number;
  rows: number;
}

/**
 * Writes a compressed SQLite copy of the database to `file` (the whole file appears at once: a
 * copy cut short never looks complete).
 */
export async function backupDatabase(source: Client, file: string): Promise<BackupResult> {
  const work = await mkdtemp(join(tmpdir(), 'tora-backup-'));
  try {
    const copy = join(work, 'tora.db');
    const target = createClient({ url: `file:${copy}` });
    let result: { tables: number; rows: number };
    try {
      result = await copyDatabase(source, target);
      const check = await target.execute('PRAGMA integrity_check');
      if (String(check.rows[0]?.[0]) !== 'ok') throw new Error('the copy failed its check');
    } finally {
      target.close();
    }
    const part = `${file}.part`;
    await pipeline(createReadStream(copy), createGzip({ level: 9 }), createWriteStream(part));
    await rename(part, file);
    return { file, bytes: (await stat(file)).size, ...result };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/**
 * Loads a backup (`.db.gz`, or a plain SQLite file) into `target`, which must be empty (no tables):
 * a restore never overwrites data.
 */
export async function restoreDatabase(
  file: string,
  target: Client,
): Promise<{ tables: number; rows: number }> {
  const existing = await target.execute(`SELECT count(*) AS n FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'
      AND name NOT LIKE 'libsql\\_%' ESCAPE '\\' AND name NOT LIKE '\\_litestream%' ESCAPE '\\'`);
  if (Number(existing.rows[0]?.n ?? 0) > 0) {
    throw new Error(
      'The target database is not empty. Restore into a new, empty database (see docs/backups.md).',
    );
  }
  const work = await mkdtemp(join(tmpdir(), 'tora-restore-'));
  try {
    let copy = file;
    if (file.endsWith('.gz')) {
      copy = join(work, 'tora.db');
      await pipeline(createReadStream(file), createGunzip(), createWriteStream(copy));
    }
    // Whole numbers read exactly, however large.
    const source = createClient({ url: `file:${copy}`, intMode: 'bigint' });
    try {
      return await copyDatabase(source, target);
    } finally {
      source.close();
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/** Day arithmetic on `YYYY-MM-DD`. */
const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * The backups kept on `today`: the last 30 days, plus the first of each month for 12 months
 * (this month included).
 */
export function backupsToKeep(days: string[], today: string): Set<string> {
  const keep = new Set(days.filter((d) => d > addDays(today, -30) && d <= today));
  const [y, m] = today.split('-').map(Number) as [number, number];
  const oldestMonth = new Date(Date.UTC(y, m - 12, 1)).toISOString().slice(0, 7);
  const firstOfMonth = new Map<string, string>();
  for (const d of [...days].sort()) {
    const month = d.slice(0, 7);
    if (month >= oldestMonth && d <= today && !firstOfMonth.has(month)) firstOfMonth.set(month, d);
  }
  for (const d of firstOfMonth.values()) keep.add(d);
  return keep;
}

/** Day of each backup in the folder. */
export async function listBackups(dir: string): Promise<string[]> {
  const names = await readdir(dir).catch(() => [] as string[]);
  return names.flatMap((n) => n.match(NAME)?.[1] ?? []).sort();
}

/** Deletes the backups no longer kept; returns how many. */
export async function pruneBackups(dir: string, today: string): Promise<number> {
  const days = await listBackups(dir);
  const keep = backupsToKeep(days, today);
  let removed = 0;
  for (const d of days) {
    if (keep.has(d)) continue;
    await rm(join(dir, backupName(d)), { force: true });
    removed++;
  }
  return removed;
}

/**
 * Unpacks the latest backup to `target` when it is newer than the copy there (the file is
 * replaced whole). Returns the backup's day, or null when there is no backup.
 */
export async function refreshAnalysisCopy(dir: string, target: string): Promise<string | null> {
  const day = (await listBackups(dir)).at(-1);
  if (!day) return null;
  const file = join(dir, backupName(day));
  const [backup, copy] = await Promise.all([stat(file), stat(target).catch(() => null)]);
  if (copy && copy.mtimeMs >= backup.mtimeMs) return day;
  await mkdir(dirname(target), { recursive: true });
  const part = `${target}.part`;
  await pipeline(createReadStream(file), createGunzip(), createWriteStream(part));
  await rename(part, target);
  return day;
}

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}
