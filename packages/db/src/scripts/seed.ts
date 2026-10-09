import { count } from 'drizzle-orm';
import { loadCatalogFiles, syncCatalog } from '../catalog';
import { createDb } from '../client';
import { dbConfigFromEnv, isRemoteUrl, loadRootEnv } from '../env';
import { users } from '../schema';
import {
  DEMO_PASSWORD,
  DEMO_TOTP_SECRET,
  DEMO_USERNAME,
  seedCollection,
  seedDemoUser,
} from '../seed';

loadRootEnv();
const config = dbConfigFromEnv();

if (isRemoteUrl(config.url)) {
  console.error(`Refusing to seed a remote database (${config.url}). Seed is for local DBs only.`);
  process.exit(1);
}
const authSecret = process.env.AUTH_SECRET?.trim();
if (!authSecret) {
  console.error('AUTH_SECRET is required (it encrypts the demo account 2FA secret).');
  process.exit(1);
}

const db = createDb(config);
const [existing] = await db.select({ n: count() }).from(users);
if (existing && existing.n > 0) {
  console.error('Database already has accounts; seed only runs on an empty DB.');
  process.exit(1);
}

await syncCatalog(db, await loadCatalogFiles());
const { user, backupCodes } = await seedDemoUser(db, authSecret);
await seedCollection(db, user.id);
console.log(`Seeded demo account "${DEMO_USERNAME}" / "${DEMO_PASSWORD}".`);
console.log(`Authenticator secret (demo only): ${DEMO_TOTP_SECRET}`);
console.log(`Backup codes: ${backupCodes.join(' ')}`);
