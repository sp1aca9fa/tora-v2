// Changing the app's time zone (requirements S16 part 5): the admin picks it in Settings; every
// stored time is rewritten with the new zone's offset, so a day stays its first 10 characters.
import { appTimeZone, isTimeZone, offsetPeriods, offsetText, toLocalIso } from '@tora/core';
import { type SQL, sql } from 'drizzle-orm';
import type { Db } from './client';
import { DomainError } from './mutations';
import { refreshItemSales } from './item-sales';
import { loadSourceRegistry, setTimeZoneSetting } from './registry';

/** JSON columns that may hold times (sale times, event payloads, a collector's progress). */
const JSON_TIMES = [
  { table: 'product_sources', column: 'recent_sales' },
  { table: 'product_sources', column: 'state' },
  { table: 'holding_events', column: 'payload' },
  { table: 'suggestions', column: 'payload' },
  { table: 'suggestions', column: 'evidence' },
] as const;

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const DAY_MS = 86_400_000;
const julian = (ms: number) => ms / DAY_MS + 2440587.5;

/** Every time column (`*_at`) of every table. */
async function timeColumns(db: Db): Promise<{ table: string; column: string }[]> {
  const rows = await db.all<{ table: string; column: string }>(sql`
    SELECT m.name AS "table", c.name AS "column"
    FROM sqlite_master m, pragma_table_info(m.name) c
    WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%' AND m.name NOT LIKE '__drizzle%'
      AND c.name LIKE '%\\_at' ESCAPE '\\'`);
  return rows;
}

/** Lots, events and prices stored (a change with none needs no confirmation). */
export async function storedTimes(db: Db): Promise<number> {
  const [row] = await db.all<{ n: number }>(sql`SELECT
    (SELECT count(*) FROM holdings) + (SELECT count(*) FROM holding_events)
      + (SELECT count(*) FROM price_observations) AS n`);
  return Number(row?.n ?? 0);
}

/** The column's times rewritten in `tz`, each with the zone's offset at its instant. */
function rewritten(column: string, periods: { until: number | null; offset: number }[]): SQL {
  const c = sql.raw(`"${column}"`);
  const at = (offset: number) =>
    sql`strftime('%Y-%m-%dT%H:%M:%f', julianday(${c}) + ${offset / 1440}) || ${offsetText(offset)}`;
  const branches = periods.map((p) =>
    p.until === null
      ? sql` ELSE ${at(p.offset)}`
      : sql` WHEN julianday(${c}) < ${julian(p.until)} THEN ${at(p.offset)}`,
  );
  return sql`CASE WHEN ${c} IS NULL OR ${c} NOT LIKE '____-__-__T%' OR julianday(${c}) IS NULL
    THEN ${c}${sql.join(branches, sql``)} END`;
}

/**
 * Makes `to` the app's time zone. Every stored time (`*_at` columns, and times inside JSON) is
 * rewritten as the same instant in the new zone; dates without a time (daily snapshots, exchange
 * rates, release dates) stay. Saved values and snapshots follow: the caller rebuilds them.
 * Returns the time columns rewritten.
 */
export async function changeTimeZone(db: Db, to: string, now = new Date()): Promise<number> {
  if (!isTimeZone(to)) throw new DomainError('invalid_time_zone');
  await loadSourceRegistry(db);
  if (to === appTimeZone()) return 0;
  const columns = await timeColumns(db);
  // The zone's offsets from the oldest stored time to a year ahead.
  let oldest = now.getTime();
  for (const { table, column } of columns) {
    const [row] = await db.all<{ t: number | null }>(
      sql.raw(`SELECT min(julianday("${column}")) AS t FROM "${table}"
        WHERE "${column}" LIKE '____-__-__T%'`),
    );
    if (row?.t != null) oldest = Math.min(oldest, (row.t - 2440587.5) * DAY_MS);
  }
  const periods = offsetPeriods(
    to,
    new Date(oldest - 2 * DAY_MS),
    new Date(now.getTime() + 366 * DAY_MS),
  );
  const statements = columns.map(({ table, column }) =>
    db.run(
      sql`UPDATE ${sql.raw(`"${table}"`)} SET ${sql.raw(`"${column}"`)} = ${rewritten(column, periods)}`,
    ),
  );
  const [first, ...rest] = statements;
  if (first) await db.batch([first, ...rest]);

  // Times inside JSON, one row at a time.
  const walk = (v: unknown): unknown =>
    typeof v === 'string' && ISO_TIME.test(v)
      ? toLocalIso(new Date(v), to)
      : Array.isArray(v)
        ? v.map(walk)
        : v && typeof v === 'object'
          ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
          : v;
  for (const { table, column } of JSON_TIMES) {
    const rows = await db.all<{ id: string; value: string }>(
      sql.raw(`SELECT id, "${column}" AS value FROM "${table}"
        WHERE "${column}" GLOB '*[0-9]T[0-9][0-9]:[0-9][0-9]*'`),
    );
    for (const row of rows) {
      let value: unknown;
      try {
        value = JSON.parse(row.value);
      } catch {
        continue;
      }
      const next = JSON.stringify(walk(value));
      if (next === row.value) continue;
      await db.run(
        sql`UPDATE ${sql.raw(`"${table}"`)} SET ${sql.raw(`"${column}"`)} = ${next} WHERE id = ${row.id}`,
      );
    }
  }
  await setTimeZoneSetting(db, to);
  // Sales may now fall on other days.
  await refreshItemSales(db, { full: true });
  return columns.length;
}
