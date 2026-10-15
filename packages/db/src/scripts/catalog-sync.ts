// `pnpm catalog:sync`: loads packages/catalog/data/*.json into tcg_sets (idempotent).
import { loadCatalogFiles, syncCatalog } from '../catalog';
import { createDb } from '../client';
import { loadTimeZone } from '../registry';
import { dbConfigFromEnv, loadRootEnv } from '../env';

loadRootEnv();
const config = dbConfigFromEnv();
const entries = await loadCatalogFiles();
if (entries.length === 0) {
  console.error('No catalog files found. Run `pnpm catalog:fetch` first.');
  process.exit(1);
}
console.log(
  `Syncing ${entries.length} sets into ${config.url.startsWith('file:') ? 'local DB' : config.url}`,
);
const db = createDb(config);
// Times written follow the admin's time zone (S16 part 5).
await loadTimeZone(db);
const r = await syncCatalog(db, entries);
console.log(
  `Done: ${r.upserted} sets loaded, ${r.removed} obsolete removed (${r.remapped} re-pointed), ${r.kept} obsolete kept (in use, no match).`,
);
