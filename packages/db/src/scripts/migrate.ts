import { createDb } from '../client';
import { dbConfigFromEnv, isRemoteUrl, loadRootEnv } from '../env';
import { migrateDb } from '../migrate';
import { refreshItemSales } from '../item-sales';
import { holdingValues } from '../schema';
import { runSnapshots } from '../valuation';

loadRootEnv();
const config = dbConfigFromEnv();
console.log(`Migrating ${isRemoteUrl(config.url) ? config.url : config.url.replace('file:', '')}`);
const db = createDb(config);
await migrateDb(db);
// The packed item sales the pages read: built the first time, then the days a migration changed.
const days = await refreshItemSales(db, { marksOnly: true });
if (days.items) console.log(`Item sales: ${days.items} item(s) written.`);
// The packed value history, the first time (rebuilt from the sales by every collect after).
const [anyValues] = await db.select({ id: holdingValues.holdingId }).from(holdingValues).limit(1);
if (!anyValues) {
  const snap = await runSnapshots(db);
  console.log(`Value history: ${snap.days} day(s), ${snap.rows} lot-day(s) written.`);
}
console.log('Done.');
