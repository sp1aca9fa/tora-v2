// `pnpm valuate`: rebuilds the valuation snapshots behind the value-over-time chart.
// `pnpm collect` already does this after collecting; use this to refresh without collecting.
import { createDb } from '../client';
import { dbConfigFromEnv, loadRootEnv } from '../env';
import { inferLotSizes } from '../lot-sizes';
import { exitIfUnmigrated } from '../migrate';
import { runSnapshots } from '../valuation';

loadRootEnv();
const db = createDb(dbConfigFromEnv());
await exitIfUnmigrated(db);
const lots = await inferLotSizes(db);
console.log(`lot sizes: ${lots.checked} estimated trade(s) checked, ${lots.updated} updated`);
const r = await runSnapshots(db);
console.log(`snapshots: ${r.days} day(s), ${r.rows} row(s) updated, ${r.removed} removed`);
