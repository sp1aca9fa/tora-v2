import { createDb } from '../client';
import { dbConfigFromEnv, isRemoteUrl, loadRootEnv } from '../env';
import { migrateDb } from '../migrate';

loadRootEnv();
const config = dbConfigFromEnv();
console.log(`Migrating ${isRemoteUrl(config.url) ? config.url : config.url.replace('file:', '')}`);
await migrateDb(createDb(config));
console.log('Done.');
