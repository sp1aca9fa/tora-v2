import { createDb } from '../client';
import { dbConfigFromEnv, isRemoteUrl, loadRootEnv } from '../env';
import { migrateDb } from '../migrate';
import { refreshPriceDays } from '../price-days';

loadRootEnv();
const config = dbConfigFromEnv();
console.log(`Migrating ${isRemoteUrl(config.url) ? config.url : config.url.replace('file:', '')}`);
const db = createDb(config);
await migrateDb(db);
// The sales per day the pages read: built the first time, then the days a migration changed.
const days = await refreshPriceDays(db, { marksOnly: true });
if (days.days) console.log(`Sales per day: ${days.days} row(s) written.`);
console.log('Done.');
