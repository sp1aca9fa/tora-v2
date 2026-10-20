// `pnpm rebuild`: every saved result again from the raw sales (requirements S19 part 2): the packed
// item sales, lot sizes, today's values, the value history and charts, trade counts and buy
// timing. The nightly collect keeps them current; this is for after a restore, or when the
// self-check reports differences.
import { INSIGHT_PERIODS } from '@tora/core';
import { createDb } from '../client';
import { dbConfigFromEnv, loadRootEnv } from '../env';
import { refreshItemSales } from '../item-sales';
import { inferLotSizes } from '../lot-sizes';
import { exitIfUnmigrated } from '../migrate';
import { checkSourceQuality, loadTimeZone } from '../registry';
import { portfolioCharts } from '../schema';
import { refreshOpportunities } from '../opportunities';
import { refreshSignals } from '../signals';
import {
  clearAllBucketValues,
  refreshBucketValues,
  refreshTradeCounts,
  runSnapshots,
} from '../valuation';

loadRootEnv();
const db = createDb(dbConfigFromEnv());
await exitIfUnmigrated(db);
await loadTimeZone(db);
const sales = await refreshItemSales(db, { full: true });
console.log(`item sales: ${sales.items} item(s) rebuilt`);
const lots = await inferLotSizes(db, { full: true });
console.log(`lot sizes: ${lots.checked} estimated trade(s) checked, ${lots.updated} updated`);
// The days the lot sizes changed.
await refreshItemSales(db, { marksOnly: true });
await checkSourceQuality(db);
await clearAllBucketValues(db);
await db.delete(portfolioCharts);
const snap = await runSnapshots(db);
console.log(
  `value history: ${snap.days} day(s), ${snap.rows} lot-day(s) updated, ${snap.removed} removed`,
);
const values = await refreshBucketValues(db);
console.log(`values: ${values.values} saved`);
await refreshTradeCounts(db, INSIGHT_PERIODS);
const signals = await refreshSignals(db);
console.log(`buy timing: ${signals.saved} item(s) and condition(s)`);
const opportunities = await refreshOpportunities(db);
console.log(`opportunities: ${opportunities.items.length} item(s)`);
console.log('Done.');
