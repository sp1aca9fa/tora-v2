import { count } from 'drizzle-orm';
import { createDb } from '../client';
import { dbConfigFromEnv, isRemoteUrl, loadRootEnv } from '../env';
import { products } from '../schema';
import { seed } from '../seed';

loadRootEnv();
const config = dbConfigFromEnv();

if (isRemoteUrl(config.url) && !process.argv.includes('--allow-remote')) {
  console.error(
    `Refusing to seed a remote database (${config.url}). Pass --allow-remote to force.`,
  );
  process.exit(1);
}

const db = createDb(config);
const [existing] = await db.select({ n: count() }).from(products);
if (existing && existing.n > 0) {
  console.error(`Database already has ${existing.n} products; seed only runs on an empty DB.`);
  process.exit(1);
}

const rows = await seed(db);
console.log(
  `Seeded ${rows.products.length} products, ${rows.holdings.length} holdings, ${rows.holdingEvents.length} events.`,
);
