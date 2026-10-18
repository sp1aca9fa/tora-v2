import { createDb } from '../client';
import { dbConfigFromEnv, isRemoteUrl, loadRootEnv } from '../env';
import { migrateDb } from '../migrate';
import { refreshItemSales } from '../item-sales';

loadRootEnv();
const config = dbConfigFromEnv();
console.log(`Migrating ${isRemoteUrl(config.url) ? config.url : config.url.replace('file:', '')}`);
const db = createDb(config);
await migrateDb(db);
// The packed item sales the pages read: built the first time, then the days a migration changed.
const days = await refreshItemSales(db, { marksOnly: true });
if (days.items) console.log(`Item sales: ${days.items} item(s) written.`);
console.log('Done.');
