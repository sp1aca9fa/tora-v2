// `pnpm backup`: a dated, compressed copy of the whole database on this PC (requirements S6).
// The daily schedule runs it after each collect; it makes one copy a day (`--force`: another).
// The folder: BACKUP_DIR in .env (e.g. a OneDrive or Google Drive folder, so copies also leave
// the PC), else ~/.local/share/tora/backups. Kept: the last 30 days and the first of each month
// for 12 months.
import { createClient } from '@libsql/client';
import { localDate, toLocalIso } from '@tora/core';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { recordActivity } from '../activity';
import {
  analysisCopyPath,
  backupDatabase,
  backupDir,
  backupName,
  ensureDir,
  pruneBackups,
  refreshAnalysisCopy,
} from '../backup';
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
  try {
    const r = await backupDatabase(source, file);
    const seconds = Math.round((Date.now() - started) / 1000);
    // The app shows when the last one ran (Settings > Collectors) and the activity log (S17).
    await setLastBackup(db, { at: toLocalIso(), file: r.file, bytes: r.bytes, rows: r.rows });
    await recordActivity(db, {
      kind: 'backup',
      detail: { file: r.file, bytes: r.bytes, tables: r.tables, rows: r.rows, seconds },
      href: '/settings/collectors',
    });
    console.log(
      `backup: ${r.file} (${(r.bytes / 1024 / 1024).toFixed(1)} MB, ${r.tables} tables, ` +
        `${r.rows} rows, ${seconds} s)`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Sent to admins by `pnpm alerts after-run` (scripts/collect-cron.sh).
    await recordActivity(db, {
      kind: 'backup',
      level: 'failed',
      detail: { error: message.slice(0, 500) },
      href: '/settings/activity',
    }).catch(() => undefined);
    throw error;
  } finally {
    source.close();
  }
}
// Claude Code's heavy queries read this copy, never Turso (S19).
try {
  const day = await refreshAnalysisCopy(dir, analysisCopyPath());
  if (day) console.log(`backup: analysis copy as of ${day} (${analysisCopyPath()})`);
} catch (error) {
  console.log(`backup: analysis copy not updated (${error instanceof Error ? error.message : error})`);
}
const removed = await pruneBackups(dir, today);
if (removed) console.log(`backup: ${removed} old copy(ies) deleted`);
