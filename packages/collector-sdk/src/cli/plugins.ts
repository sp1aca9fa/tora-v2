// `pnpm plugins`: saves what the plug-in packages describe (sources, rate sources, store lists)
// without collecting anything, e.g. after adding stores; every collect and import does it too.
import { createDb, listStores, loadTimeZone } from '@tora/db';
import { dbConfigFromEnv, isRemoteUrl, loadRootEnv } from '@tora/db/env';
import { exitIfUnmigrated } from '@tora/db/migrate';
import { loadAndRegister } from '../registry';

loadRootEnv();
const config = dbConfigFromEnv();
const db = createDb(config);
await exitIfUnmigrated(db);
await loadTimeZone(db);
console.log(`Database: ${isRemoteUrl(config.url) ? config.url : 'local file'}`);
const loaded = await loadAndRegister(db);
for (const dir of loaded.missing) console.log(`Collector package not present: ${dir}/ (skipped)`);
console.log(
  `${loaded.collectors.length} collectors, ${loaded.sources.length} sources, ${loaded.stores.length} store list(s), ${(await listStores(db)).length} stores saved`,
);
process.exit(0);
