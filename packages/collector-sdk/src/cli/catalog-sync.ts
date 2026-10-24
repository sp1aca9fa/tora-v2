// `pnpm catalog:sync`: loads the plug-ins' set lists now (the collect does it by itself when they
// change): only the regions the admin's set categories list (S10).
import { createDb, loadTimeZone } from '@tora/db';
import { dbConfigFromEnv, isRemoteUrl, loadRootEnv } from '@tora/db/env';
import { syncCatalogs } from '../catalog';
import { loadCollectors } from '../registry';

loadRootEnv();
const config = dbConfigFromEnv();
const db = createDb(config);
// Times written follow the admin's time zone (S16 part 5).
await loadTimeZone(db);
const { catalogs } = await loadCollectors();
const r = await syncCatalogs(db, catalogs, { force: true });
if (!r) {
  console.error('No set lists found in the plug-ins (collectors-public/catalog/data).');
  process.exit(1);
}
console.log(
  `${isRemoteUrl(config.url) ? config.url : 'Local DB'}: ${r.sets} sets in use loaded, ${r.removed} no longer listed removed (${r.remapped} re-pointed), ${r.kept} kept (in use, no match).`,
);
