// Changing the base currency (requirements S16): the admin picks it in Settings > Markets; every
// stored amount is converted with the exchange rate of its own date.
import {
  type CurrencySettings,
  baseCurrency,
  currencyDigits,
  ratePair,
  localDate,
} from '@tora/core';
import { type SQL, eq, like, sql } from 'drizzle-orm';
import type { Db } from './client';
import { DomainError } from './mutations';
import { fxRateOn } from './fx';
import { refreshItemSales } from './item-sales';
import { runSnapshots } from './valuation';
import { loadSourceRegistry, setCurrencySettings } from './registry';
import { fxRates, holdingEvents, productSources } from './schema';

/** Tables and columns holding amounts in the base, with the date each amount belongs to. */
const AMOUNTS = [
  { table: 'holdings', columns: ['cost_total_base'], date: 'substr(acquired_at, 1, 10)' },
  {
    table: 'holding_events',
    columns: ['amount_base', 'fees_base'],
    date: 'substr(occurred_at, 1, 10)',
  },
  { table: 'price_observations', columns: ['price_base'], date: 'substr(observed_at, 1, 10)' },
  { table: 'manual_prices', columns: ['price_base'], date: 'substr(set_at, 1, 10)' },
  { table: 'source_candidates', columns: ['price_base'], date: 'substr(created_at, 1, 10)' },
  // No date of its own: today's rate.
  { table: 'products', columns: ['retail_price_base'], date: null },
] as const;

/** How many stored amounts a change of base converts. */
export async function storedAmounts(db: Db): Promise<number> {
  let n = 0;
  for (const { table, columns } of AMOUNTS) {
    const where = columns.map((c) => `${c} IS NOT NULL`).join(' OR ');
    const [row] = await db.all<{ n: number }>(
      sql.raw(`SELECT count(*) AS n FROM ${table} WHERE ${where}`),
    );
    n += Number(row?.n ?? 0);
  }
  return n;
}

/**
 * Currencies the base can change to: any while nothing is stored (setting up), else those with a
 * stored rate to the current base (another market's).
 */
export async function baseChoices(db: Db): Promise<string[]> {
  const base = baseCurrency(await loadSourceRegistry(db));
  if ((await storedAmounts(db)) === 0) return Intl.supportedValuesOf('currency');
  const rows = await db
    .selectDistinct({ pair: fxRates.pair })
    .from(fxRates)
    .where(like(fxRates.pair, `%${base}`));
  return rows
    .map((r) => r.pair.slice(0, -base.length))
    .filter((c) => /^[A-Z]{3}$/.test(c))
    .sort();
}

/**
 * Makes `to` the base. At setup (nothing stored) any currency; later, converts every stored amount from the current base to `to` with the rate of its date (the last
 * one on or before it, else the first after), then makes `to` the base. Exchange rates follow:
 * each currency's rates to the old base become rates to the new one. Saved values per condition
 * are not converted: the caller clears and rebuilds them.
 */
export async function changeBaseCurrency(db: Db, to: string, now = new Date()): Promise<number> {
  const registry = await loadSourceRegistry(db);
  const from = baseCurrency(registry);
  if (to === from) return 0;
  // Setting up (nothing stored yet): any currency, nothing to convert.
  if ((await storedAmounts(db)) === 0) {
    if (!Intl.supportedValuesOf('currency').includes(to)) throw new DomainError('no_rate');
    const { [to]: _, ...rates } = registry.currency?.rates ?? {};
    await setCurrencySettings(db, { base: to, rates });
    return 0;
  }
  // Units of the old base per unit of the new one.
  const pair = ratePair(to, from);
  if (!(await fxRateOn(db, pair, localDate(now)))) throw new DomainError('no_rate');
  const scale = 10 ** (currencyDigits(to) - currencyDigits(from));
  const rateOn = (date: SQL | string) => sql`coalesce(
    (SELECT r.rate FROM fx_rates r WHERE r.pair = ${pair} AND r.date <= ${date}
      ORDER BY r.date DESC LIMIT 1),
    (SELECT r.rate FROM fx_rates r WHERE r.pair = ${pair} ORDER BY r.date ASC LIMIT 1))`;
  const today = localDate(now);
  const convert = (column: string, date: string | null) =>
    sql`${sql.raw(column)} = CASE WHEN ${sql.raw(column)} IS NULL THEN NULL ELSE
      CAST(round(${sql.raw(column)} * ${scale} / ${rateOn(date ? sql.raw(date) : today)}) AS INTEGER)
      END`;
  const statements = AMOUNTS.map(({ table, columns, date }) => {
    const sets = sql.join(
      columns.map((c) => convert(c, date)),
      sql`, `,
    );
    return db.run(sql`UPDATE ${sql.raw(table)} SET ${sets}`);
  });
  // A price's rate is to the base: a price in the new base needs none, one in the old base now has
  // one (the inverse), others are divided by the new base's rate.
  statements.push(
    db.run(sql`UPDATE price_observations SET fx_rate = CASE
      WHEN currency = ${to} THEN NULL
      WHEN fx_rate IS NULL THEN 1.0 / ${rateOn(sql.raw('substr(observed_at, 1, 10)'))}
      ELSE fx_rate / ${rateOn(sql.raw('substr(observed_at, 1, 10)'))} END`),
  );
  // Rates to the new base: other currencies' through the old base, and the old base's own.
  statements.push(
    db.run(sql`INSERT INTO fx_rates (id, date, pair, rate, created_at, updated_at)
      SELECT lower(hex(randomblob(13))), x.date, substr(x.pair, 1, length(x.pair) - ${from.length}) || ${to},
        x.rate / ${rateOn(sql.raw('x.date'))}, x.created_at, x.updated_at
      FROM fx_rates x
      WHERE x.pair LIKE ${`%${from}`} AND x.pair <> ${pair}
      ON CONFLICT (date, pair) DO UPDATE SET rate = excluded.rate`),
    db.run(sql`INSERT INTO fx_rates (id, date, pair, rate, created_at, updated_at)
      SELECT lower(hex(randomblob(13))), date, ${ratePair(from, to)}, 1.0 / rate, created_at, updated_at
      FROM fx_rates WHERE pair = ${pair}
      ON CONFLICT (date, pair) DO UPDATE SET rate = excluded.rate`),
  );
  const [first, ...rest] = statements;
  await db.batch([first!, ...rest]);

  // Amounts kept inside JSON (recent sales, lot history), converted one by one.
  const factor = async (date: string) =>
    scale / ((await fxRateOn(db, pair, date.slice(0, 10)))?.rate ?? 1);
  for (const link of await db
    .select({ id: productSources.id, recentSales: productSources.recentSales })
    .from(productSources)
    .where(sql`${productSources.recentSales} IS NOT NULL`)) {
    const sales = [];
    for (const s of link.recentSales ?? []) {
      sales.push({ ...s, priceBase: Math.round(s.priceBase * (await factor(s.observedAt))) });
    }
    await db
      .update(productSources)
      .set({ recentSales: sales })
      .where(eq(productSources.id, link.id));
  }
  for (const e of await db
    .select({ id: holdingEvents.id, payload: holdingEvents.payload, at: holdingEvents.occurredAt })
    .from(holdingEvents)
    .where(like(holdingEvents.payload, '%Base%'))) {
    const f = await factor(e.at);
    const walk = (v: unknown, key = ''): unknown =>
      Array.isArray(v)
        ? v.map((x) => walk(x))
        : v && typeof v === 'object'
          ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k)]))
          : typeof v === 'number' && key.endsWith('Base')
            ? Math.round(v * f)
            : v;
    await db
      .update(holdingEvents)
      .set({ payload: walk(e.payload) as Record<string, unknown> })
      .where(eq(holdingEvents.id, e.id));
  }

  // Where rates come from: the new base needs none; the old base's comes from the same source
  // (a typed rate is inverted).
  const rates: CurrencySettings['rates'] = { ...registry.currency?.rates };
  const toSetting = rates[to];
  delete rates[to];
  if (toSetting) rates[from] = 'manual' in toSetting ? { manual: 1 / toSetting.manual } : toSetting;
  await setCurrencySettings(db, { base: to, rates });
  await refreshItemSales(db, { full: true });
  // The value history, from the converted sales (each at its own day's rate).
  await runSnapshots(db, now);
  return storedAmounts(db);
}
