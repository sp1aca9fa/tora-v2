// `pnpm import-uploads`: reads purchase files uploaded in the app (Imports > Upload) with the
// Claude login of the home PC (`claude -p`), the same way as `pnpm import-ai`; new lots wait in
// Imports > Review. Quick when nothing waits: fine to schedule every few minutes. `pnpm collect`
// does this too.
import { createDb } from '@tora/db';
import { dbConfigFromEnv, loadRootEnv } from '@tora/db/env';
import { exitIfUnmigrated } from '@tora/db/migrate';
import { readWaitingUploads } from '../ai-import-run';
import { askClaude } from '../claude';
import { loadAndRegister } from '../registry';

if (process.env.VERCEL || process.env.CI) {
  console.error('Runs on the home PC only.');
  process.exit(1);
}
loadRootEnv();
const db = createDb(dbConfigFromEnv());
await exitIfUnmigrated(db);
await loadAndRegister(db);
const read = await readWaitingUploads(db, askClaude, { log: (m) => console.log(m) });
if (read) console.log(`${read} upload batch(es) read: check Imports > Review.`);
process.exit(0);
