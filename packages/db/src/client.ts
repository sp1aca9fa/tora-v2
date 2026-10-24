import { type Client, type Config, createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { type DbConfig, dbConfigFromEnv } from './env';
import * as schema from './schema';
import { UsageMeter, defaultOrigin } from './usage';

const meters = new WeakMap<object, UsageMeter>();

/** How long a local file's writer waits for another one to finish. */
const LOCAL_BUSY_MS = 60_000;

/** Database round trips and the time spent waiting on them, kept for `pnpm perf` (S14). */
export interface DbTimings {
  calls: number;
  ms: number;
}

const timings: DbTimings = ((globalThis as { __toraDbTimings?: DbTimings }).__toraDbTimings ??= {
  calls: 0,
  ms: 0,
});

/** The round trips since the process started; counted only with TORA_PERF set. */
export function dbTimings(): DbTimings {
  return { ...timings };
}

/** Counts each statement or batch sent, when TORA_PERF is set. */
function timed(client: Client): Client {
  if (!process.env.TORA_PERF) return client;
  for (const name of ['execute', 'batch'] as const) {
    const run = (client[name] as (...args: unknown[]) => Promise<unknown>).bind(client);
    Object.assign(client, {
      [name]: async (...args: unknown[]) => {
        const start = performance.now();
        try {
          return await run(...args);
        } finally {
          timings.calls += 1;
          timings.ms += performance.now() - start;
        }
      },
    });
  }
  return client;
}

/**
 * A libsql client; a hosted database's counts the rows its replies report, per day and `origin`
 * (see `UsageMeter`; a local file has no such counts), saved on the way out of a program that
 * ends by itself.
 */
export function createMeteredClient(config: Config, origin = defaultOrigin()): Client {
  // A local file takes one writer at a time: the app, a collect and a manual run wait their turn
  // instead of failing at once with SQLITE_BUSY (the driver's default wait is none).
  if (config.url.startsWith('file:'))
    return timed(createClient({ timeout: LOCAL_BUSY_MS, ...config }));
  const meter = new UsageMeter(origin);
  const client = timed(createClient({ ...config, fetch: meter.fetch }));
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
