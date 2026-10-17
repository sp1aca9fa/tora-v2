// `pnpm valuate`: rebuilds the valuation snapshots behind the value-over-time chart.
// `pnpm collect` already does this after collecting; use this to refresh without collecting.
import { createDb } from '../client';
import { dbConfigFromEnv, loadRootEnv } from '../env';
import { inferLotSizes } from '../lot-sizes';
import { exitIfUnmigrated } from '../migrate';
import { refreshPriceDays } from '../price-days';
import { checkSourceQuality, loadTimeZone } from '../registry';
import { clearAllBucketValues, refreshBucketValues, runSnapshots } from '../valuation';

loadRootEnv();
const db = createDb(dbConfigFromEnv());
await exitIfUnmigrated(db);
// Times written follow the admin's time zone (S16 part 5).
await loadTimeZone(db);
const lots = await inferLotSizes(db);
console.log(`lot sizes: ${lots.checked} estimated trade(s) checked, ${lots.updated} updated`);
const days = await refreshPriceDays(db);
console.log(`sales per day: ${days.days} row(s) rebuilt${days.full ? ' (full)' : ''}`);
const quality = await checkSourceQuality(db);
if (quality.length) {
  console.log(`source quality changed: ${quality.join(', ')}`);
  await clearAllBucketValues(db);
}
const r = await runSnapshots(db);
console.log(`snapshots: ${r.days} day(s), ${r.rows} row(s) updated, ${r.removed} removed`);
const v = await refreshBucketValues(db);
console.log(`values: ${v.values} saved, ${v.removed} removed`);
