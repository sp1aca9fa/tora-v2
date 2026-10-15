// `pnpm backup`: a dated, compressed copy of the whole database on this PC (requirements S6).
// The daily schedule runs it after each collect; it makes one copy a day (`--force`: another).
// The folder: BACKUP_DIR in .env (e.g. a OneDrive or Google Drive folder, so copies also leave
// the PC), else ~/.local/share/tora/backups. Kept: the last 30 days and the first of each month
// for 12 months.
import { createClient } from '@libsql/client';
import { localDate, toLocalIso } from '@tora/core';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { backupDatabase, backupDir, backupName, ensureDir, pruneBackups } from '../backup';
import { createDb } from '../client';
import { dbConfigFromEnv, loadRootEnv } from '../env';
import { loadTimeZone, setLastBackup } from '../registry';

loadRootEnv();
const config = dbConfigFromEnv();
// "Today" is the app's day (S16 part 5).
const db = createDb(config);
await loadTimeZone(db);
const dir = backupDir();
const today = localDate();
const file = join(dir, backupName(today));
await ensureDir(dir);
if (existsSync(file) && !process.argv.includes('--force')) {
  console.log(`backup: today's copy is already there (${file})`);
} else {
  const started = Date.now();
  const source = createClient({ ...config, intMode: 'bigint' });
  const r = await backupDatabase(source, file);
  source.close();
  // The app shows when the last one ran (Settings > Collectors).
  await setLastBackup(db, { at: toLocalIso(), file: r.file, bytes: r.bytes, rows: r.rows });
  console.log(
    `backup: ${r.file} (${(r.bytes / 1024 / 1024).toFixed(1)} MB, ${r.tables} tables, ` +
      `${r.rows} rows, ${Math.round((Date.now() - started) / 1000)} s)`,
  );
}
const removed = await pruneBackups(dir, today);
if (removed) console.log(`backup: ${removed} old copy(ies) deleted`);
