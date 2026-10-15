// `pnpm restore <file>`: loads a backup (`tora-YYYY-MM-DD.db.gz`) into the database in
// DATABASE_URL, which must be a new, empty one: a restore never overwrites data.
// docs/backups.md: making a new Turso database, restoring, and switching Vercel and the PC to it.
import { createClient } from '@libsql/client';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { restoreDatabase } from '../backup';
import { dbConfigFromEnv, loadRootEnv } from '../env';

loadRootEnv();
const arg = process.argv.slice(2).find((a) => !a.startsWith('-'));
if (!arg) {
  console.error('Usage: pnpm restore <backup file>   (into the empty database in DATABASE_URL)');
  process.exit(1);
}
const file = resolve(process.env.INIT_CWD ?? process.cwd(), arg);
if (!existsSync(file)) {
  console.error(`No such file: ${file}`);
  process.exit(1);
}
const config = dbConfigFromEnv();
console.log(`restoring ${file}\n     into ${config.url}`);
const target = createClient(config);
try {
  const started = Date.now();
  const r = await restoreDatabase(file, target);
  console.log(
    `restored: ${r.tables} tables, ${r.rows} rows (${Math.round((Date.now() - started) / 1000)} s)`,
  );
  console.log('Next: pnpm db:migrate (adds anything newer than the backup).');
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  target.close();
}
