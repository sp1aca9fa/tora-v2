// `pnpm valuate`: rebuilds the valuation snapshots behind the value-over-time chart.
// `pnpm collect` already does this after collecting; use this to refresh without collecting.
import { createDb } from '../client';
import { dbConfigFromEnv, loadRootEnv } from '../env';
import { exitIfUnmigrated } from '../migrate';
import { runSnapshots } from '../valuation';

loadRootEnv();
const db = createDb(dbConfigFromEnv());
await exitIfUnmigrated(db);
const r = await runSnapshots(db);
console.log(`snapshots: ${r.days} day(s), ${r.rows} row(s) updated, ${r.removed} removed`);
