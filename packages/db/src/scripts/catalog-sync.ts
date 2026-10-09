// `pnpm catalog:sync`: loads packages/catalog/data/*.json into tcg_sets (idempotent).
import { loadCatalogFiles, syncCatalog } from '../catalog';
import { createDb } from '../client';
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
await syncCatalog(createDb(config), entries);
console.log('Done.');
