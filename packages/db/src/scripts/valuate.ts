// `pnpm valuate`: rebuilds the value history behind the value-over-time chart, and today's values.
// `pnpm collect` already does this after collecting; use this to refresh without collecting.
import { createDb } from '../client';
import { dbConfigFromEnv, loadRootEnv } from '../env';
import { inferLotSizes } from '../lot-sizes';
import { exitIfUnmigrated } from '../migrate';
import { refreshItemSales } from '../item-sales';
import { checkSourceQuality, loadTimeZone } from '../registry';
import { clearAllBucketValues, refreshBucketValues, runSnapshots } from '../valuation';

loadRootEnv();
const db = createDb(dbConfigFromEnv());
await exitIfUnmigrated(db);
// Times written follow the admin's time zone (S16 part 5).
await loadTimeZone(db);
const lots = await inferLotSizes(db, { full: true });
console.log(`lot sizes: ${lots.checked} estimated trade(s) checked, ${lots.updated} updated`);
const days = await refreshItemSales(db);
console.log(`item sales: ${days.items} item(s) updated${days.full ? ' (full rebuild)' : ''}`);
const quality = await checkSourceQuality(db);
if (quality.length) {
  console.log(`source quality changed: ${quality.join(', ')}`);
  await clearAllBucketValues(db);
}
const r = await runSnapshots(db);
console.log(`snapshots: ${r.days} day(s), ${r.rows} row(s) updated, ${r.removed} removed`);
const v = await refreshBucketValues(db);
console.log(`values: ${v.values} saved, ${v.removed} removed`);
