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
  /** The costliest statements since the last reset, the costliest first. */
  statements: { sql: string; calls: number; ms: number }[];
}

const kept = ((globalThis as { __toraDbTimings?: unknown }).__toraDbTimings ??= {
  calls: 0,
  ms: 0,
  bySql: new Map<string, { calls: number; ms: number }>(),
}) as { calls: number; ms: number; bySql: Map<string, { calls: number; ms: number }> };

/** The round trips since the process started; counted only with TORA_PERF set. */
export function dbTimings(top = 15): DbTimings {
  return {
    calls: kept.calls,
    ms: kept.ms,
    statements: [...kept.bySql]
      .map(([sql, t]) => ({ sql, ...t }))
      .sort((a, b) => b.ms - a.ms)
      .slice(0, top),
  };
}

/** Starts the statement list afresh (the totals keep counting). */
export function resetDbStatements(): void {
  kept.bySql.clear();
}

/** A statement's text, short: a batch by its first statement. */
function sqlOf(name: string, args: unknown[]): string {
  const first = name === 'batch' ? (args[0] as unknown[])[0] : args[0];
  const sql = typeof first === 'string' ? first : ((first as { sql?: string })?.sql ?? '?');
  return `${name === 'batch' ? 'batch: ' : ''}${sql.replace(/\s+/g, ' ').slice(0, 300)}`;
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
          const ms = performance.now() - start;
          kept.calls += 1;
          kept.ms += ms;
          const sql = sqlOf(name, args);
          const t = kept.bySql.get(sql) ?? { calls: 0, ms: 0 };
          kept.bySql.set(sql, { calls: t.calls + 1, ms: t.ms + ms });
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
