// `pnpm valuate`: writes valuation snapshots (today, the last week, and missing days up to 90).
// `pnpm collect` already does this after collecting; use this to refresh without collecting.
import { createDb } from '../client';
import { dbConfigFromEnv, loadRootEnv } from '../env';
import { runSnapshots } from '../valuation';

loadRootEnv();
const r = await runSnapshots(createDb(dbConfigFromEnv()));
console.log(`snapshots: ${r.days} day(s), ${r.rows} rows`);
