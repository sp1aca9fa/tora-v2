// `pnpm backup`: a dated, compressed copy of the whole database on this PC (requirements S6).
// The daily schedule runs it after each collect; it makes one copy a day (`--force`: another).
// `--keep <name>`: a copy under that name, before a change made by hand. It stays until someone
// removes it: a second call exits 1 and leaves it, so `pnpm backup --keep x && <the change>` run again
// stops there rather than replace the copy from before the change.
// The folder: BACKUP_DIR in .env (e.g. a OneDrive or Google Drive folder, so copies also leave
// the PC), else ~/.local/share/tora/backups. Kept: the last 30 days and the first of each month
// for 12 months.
import { localDate, toLocalIso } from '@tora/core';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { recordActivity } from '../activity';
import {
  analysisCopyPath,
  backupDatabase,
  backupDir,
  backupName,
  ensureDir,
  keptBackupName,
  pruneBackups,
  refreshAnalysisCopy,
} from '../backup';
import { createDb, createMeteredClient } from '../client';
import { dbConfigFromEnv, loadRootEnv } from '../env';
import { loadTimeZone, setLastBackup } from '../registry';

loadRootEnv();
const config = dbConfigFromEnv();
// "Today" is the app's day (S16 part 5).
const db = createDb(config);
await loadTimeZone(db);
const dir = backupDir();
const today = localDate();
const keepAt = process.argv.indexOf('--keep');
const kept = keepAt < 0 ? null : keptBackupName(process.argv[keepAt + 1] ?? '');
if (keepAt >= 0 && !kept) {
  console.error(
    'backup: --keep needs a name of small letters, digits and dashes, not a dated one.',
  );
  process.exit(1);
}
const file = join(dir, kept ?? backupName(today));
await ensureDir(dir);
if (kept && existsSync(file)) {
  const { mtime, size } = statSync(file);
  const made = toLocalIso(mtime).slice(0, 16).replace('T', ' ');
  console.error(
    `backup: ${kept} is already there (made ${made}, ${(size / 1e6).toFixed(1)} MB) and stays as it is. Nothing written.`,
  );
  process.exit(1);
}
if (existsSync(file) && !process.argv.includes('--force')) {
  console.log(`backup: today's copy is already there (${file})`);
} else {
  const started = Date.now();
  const source = createMeteredClient({ ...config, intMode: 'bigint' });
  try {
    const r = await backupDatabase(source, file);
    const seconds = Math.round((Date.now() - started) / 1000);
    // The app shows when the last one ran (Settings > Collectors) and the activity log (S17).
    await setLastBackup(db, { at: toLocalIso(), file: r.file, bytes: r.bytes, rows: r.rows });
    await recordActivity(db, {
      kind: 'backup',
      detail: {
        file: r.file,
        bytes: r.bytes,
        tables: r.tables,
        rows: r.rows,
        orphans: r.orphans,
        seconds,
      },
      href: '/settings/collectors',
    });
    console.log(
      `backup: ${r.file} (${(r.bytes / 1024 / 1024).toFixed(1)} MB, ${r.tables} tables, ` +
        `${r.rows} rows, ${seconds} s)` +
        (r.orphans > 0 ? `; ${r.orphans} rows written mid-copy without their parent left out` : ''),
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
  console.log(
    `backup: analysis copy not updated (${error instanceof Error ? error.message : error})`,
  );
}
const removed = await pruneBackups(dir, today);
if (removed) console.log(`backup: ${removed} old copy(ies) deleted`);
