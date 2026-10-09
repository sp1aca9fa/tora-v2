import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { type DbConfig, dbConfigFromEnv } from './env';
import * as schema from './schema';

export function createDb(config: DbConfig) {
  const client = createClient(config);
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createDb>;

let shared: Db | undefined;

/** Process-wide DB from DATABASE_URL / DATABASE_AUTH_TOKEN, created on first use. */
export function getDb(): Db {
  shared ??= createDb(dbConfigFromEnv());
  return shared;
}
