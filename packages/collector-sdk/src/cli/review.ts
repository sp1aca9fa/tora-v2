// `pnpm review [--user <username>] [--dry-run]`
// Automated data review (requirements S4d): Haiku judges what the checks flagged (odd sales,
// weak searches), Sonnet the cases Haiku is unsure about, and the findings are filed as
// suggestions in the app (Imports). Nothing else changes. Runs on the home PC, with the Claude
// Code login; also run by `pnpm collect --review`.
import { createDb, getUserByUsername, listUsers } from '@tora/db';
import { dbConfigFromEnv, isRemoteUrl, loadRootEnv } from '@tora/db/env';
import { exitIfUnmigrated } from '@tora/db/migrate';
import { parseArgs } from 'node:util';
import { claudeJudge } from '../claude';
import { reviewUsers } from './review-run';

const { values } = parseArgs({
  options: { user: { type: 'string' }, 'dry-run': { type: 'boolean', default: false } },
});
loadRootEnv();
const config = dbConfigFromEnv();
const db = createDb(config);
await exitIfUnmigrated(db);
console.log(`Database: ${isRemoteUrl(config.url) ? config.url : 'local file'}`);
let users = await listUsers(db);
if (values.user) {
  const user = await getUserByUsername(db, values.user.trim().toLowerCase());
  if (!user) {
    console.error(`No user "${values.user}".`);
    process.exit(1);
  }
  users = [user];
}
await reviewUsers(db, users, claudeJudge, { dryRun: values['dry-run'], log: console.log });
