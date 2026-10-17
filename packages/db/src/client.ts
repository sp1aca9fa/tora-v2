import { type Client, type Config, createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { type DbConfig, dbConfigFromEnv } from './env';
import * as schema from './schema';
import { UsageMeter, defaultOrigin } from './usage';

const meters = new WeakMap<object, UsageMeter>();

/**
 * A libsql client; a hosted database's counts the rows its replies report, per day and `origin`
 * (see `UsageMeter`; a local file has no such counts), saved on the way out of a program that
 * ends by itself.
 */
export function createMeteredClient(config: Config, origin = defaultOrigin()): Client {
  if (config.url.startsWith('file:')) return createClient(config);
  const meter = new UsageMeter(origin);
  const client = createClient({ ...config, fetch: meter.fetch });
  meter.client = client;
  meters.set(client, meter);
  process.once('beforeExit', () => void meter.save().catch(() => {}));
  return client;
}

export function createDb(config: DbConfig, origin = defaultOrigin()) {
  return drizzle(createMeteredClient(config, origin), { schema });
}

export type Db = ReturnType<typeof createDb>;

/** Saves the rows counted so far (programs that call process.exit call it first). */
export async function saveUsage(db: Db): Promise<void> {
  await meters
    .get(db.$client)
    ?.save()
    .catch(() => {});
}

let shared: Db | undefined;

/** Process-wide DB from DATABASE_URL / DATABASE_AUTH_TOKEN, created on first use (the app's pages). */
export function getDb(): Db {
  shared ??= createDb(dbConfigFromEnv(), 'pages');
  return shared;
}
