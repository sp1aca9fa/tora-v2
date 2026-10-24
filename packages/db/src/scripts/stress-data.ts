// `pnpm stress-data <medium|large> --out <new.db> [--from <db>]` (requirements S14 step 2): a
// copy of a local database grown to a size, for timing pages and the nightly steps on more data
// than any install has today. Never touches the database it copies (read only; the default is
// DATABASE_URL's file) and refuses a hosted one. Items are cloned with their sources and sales
// (prices shifted per copy, sales sampled to the size's count), lots cloned onto the cloned items,
// members added; large adds a third market (a made-up euro source with its sales and rates). The
// person with the most lots keeps 40 % of the new ones, so their pages carry the weight. Then every
// saved result is rebuilt as `pnpm rebuild` does: run it with DATABASE_URL set to the copy.
import { toLocalIso } from '@tora/core';
import { createClient } from '@libsql/client';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { dbConfigFromEnv, isRemoteUrl, loadRootEnv } from '../env';

const SIZES = {
  medium: { users: 5, items: 1_000, lots: 2_000, prices: 1_000_000, thirdMarket: false },
  large: { users: 20, items: 5_000, lots: 10_000, prices: 5_000_000, thirdMarket: true },
};
/** The owner's share of the lots added. */
const OWNER_SHARE = 0.4;
/** The made-up third market's source. */
const EU_SOURCE = 'stresseu';

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const sizeName = process.argv[2] as keyof typeof SIZES;
const size = SIZES[sizeName];
const out = arg('out');
if (!size || !out) {
  console.error('Usage: pnpm stress-data <medium|large> --out <new.db> [--from <db>]');
  process.exit(1);
}
const here = (p: string) => resolve(process.env.INIT_CWD ?? process.cwd(), p);
loadRootEnv();
const fromArg = arg('from');
const fromUrl = fromArg ? `file:${here(fromArg)}` : dbConfigFromEnv().url;
if (isRemoteUrl(fromUrl)) {
  console.error('Only a local database file can be copied (never a hosted one).');
  process.exit(1);
}
const target = here(out);
if (existsSync(target)) {
  console.error(`${target} exists: give a new file.`);
  process.exit(1);
}

const started = Date.now();
const step = (what: string) =>
  console.log(`${what} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
const source = createClient({ url: fromUrl });
await source.execute({ sql: 'VACUUM INTO ?', args: [target] });
source.close();
step(`copied to ${target}`);

const db = createClient({ url: `file:${target}` });
// A throwaway copy: no rollback journal or disk syncs (millions of rows written in a few minutes).
await db.execute('PRAGMA journal_mode = OFF');
await db.execute('PRAGMA synchronous = OFF');
const one = async (sql: string, args: (string | number)[] = []) =>
  Number(Object.values((await db.execute({ sql, args })).rows[0] ?? {})[0] ?? 0);
const now = toLocalIso();

const items = await one('SELECT count(*) FROM products');
const lots = await one('SELECT count(*) FROM holdings');
const prices = await one('SELECT count(*) FROM price_observations');
if (!items || !lots) {
  console.error('The database has no items or no lots to clone.');
  process.exit(1);
}
const owner = (
  await db.execute(
    `SELECT u.id FROM users u LEFT JOIN holdings h ON h.user_id = u.id
     GROUP BY u.id ORDER BY count(h.id) DESC LIMIT 1`,
  )
).rows[0]!.id as string;

// Members, with the owner's preferences (language, area).
const users = await one('SELECT count(*) FROM users');
for (let i = users; i < size.users; i++) {
  await db.execute({
    sql: `INSERT INTO users (id, username, role, backup_code_hashes, preferences, created_at, updated_at)
          SELECT ?, ?, 'member', '[]', preferences, ?, ? FROM users WHERE id = ?`,
    args: [`stress-user-${i}`, `stress${i}`, now, now, owner],
  });
}
const others = (await db.execute('SELECT id FROM users WHERE id <> ?', [owner])).rows.map(
  (r) => r.id as string,
);
step(`${Math.max(0, size.users - users)} member(s) added`);

if (size.thirdMarket) {
  await db.execute({
    sql: `INSERT INTO sources (key, info, created_at, updated_at) VALUES (?, ?, ?, ?)`,
    args: [
      EU_SOURCE,
      JSON.stringify({
        key: EU_SOURCE,
        label: 'Stress EU',
        badge: 'E',
        market: 'fr',
        currency: 'EUR',
        priceKinds: ['sold'],
        roles: { card: 'supporting', sealed: 'supporting' },
        priority: 60,
      }),
      now,
      now,
    ],
  });
  await db.execute(
    `INSERT INTO fx_rates (id, date, pair, rate, created_at, updated_at)
     SELECT id || '-eur', date, 'EURJPY', rate * 1.08, created_at, updated_at
     FROM fx_rates WHERE pair = 'USDJPY'`,
  );
}

// Copies of every item until the size's count: round k suffixes ids with "-sk".
const rounds = Math.ceil((size.items - items) / items);
const perRound = prices / items;
const share = Math.min(1, (size.prices - prices) / Math.max(1, perRound * (size.items - items)));
const lotRounds = Math.ceil((size.lots - lots) / lots);
for (let k = 1; k <= Math.max(rounds, lotRounds); k++) {
  const sfx = `-s${k}`;
  if (k <= rounds) {
    // The last round copies only what is left.
    const limit = Math.min(items, size.items - items * k);
    await db.execute('DROP TABLE IF EXISTS temp.round');
    await db.execute({
      sql: 'CREATE TEMP TABLE round AS SELECT id FROM products WHERE id NOT LIKE ? LIMIT ?',
      args: ['%-s%', limit],
    });
    await db.execute({
      sql: `INSERT INTO products SELECT id || ?1, category, kind, item_type, name || ' (' || ?2 || ')',
              name_alias, franchise, region, platform, set_id, set_name, set_code, line, variant,
              card_number, rarity, release_date, retail_price_base, image_url, notes, fields,
              created_by, created_at, updated_at
            FROM products WHERE id IN (SELECT id FROM temp.round)`,
      args: [sfx, k],
    });
    await db.execute({
      sql: `INSERT INTO product_sources (id, product_id, source, external_id, query, active,
              last_success_at, created_at, updated_at, title, url, state, details_synced_at,
              recent_sales, image_url, failure)
            SELECT id || ?1, product_id || ?1, source, external_id || ?1, query, active,
              last_success_at, created_at, updated_at, title, url, state, details_synced_at,
              recent_sales, image_url, failure
            FROM product_sources WHERE product_id IN (SELECT id FROM temp.round)`,
      args: [sfx],
    });
    // Each copy's prices shifted by its own factor (0.75 to 1.24), so items differ.
    const factor = 0.75 + ((k * 37) % 50) / 100;
    await db.execute({
      sql: `INSERT INTO price_observations (id, product_id, source, observation_type, bucket,
              price_base, price_original, currency, fx_rate, observed_at, fetched_at, external_ref,
              title, url, raw, excluded, excluded_reason, created_at, updated_at, quantity_inferred)
            SELECT id || ?1, product_id || ?1, source, observation_type, bucket,
              CAST(price_base * ?2 AS INTEGER), CAST(price_original * ?2 AS INTEGER), currency,
              fx_rate, observed_at, fetched_at, external_ref || ?1, title, url, NULL, excluded,
              excluded_reason, created_at, updated_at, quantity_inferred
            FROM price_observations
            WHERE product_id IN (SELECT id FROM temp.round) AND abs(random()) % 10000 < ?3`,
      args: [sfx, factor, Math.round(share * 10_000)],
    });
    // The third market: a share of the copies' sales again, in euros.
    if (size.thirdMarket && k % 3 === 0) {
      await db.execute({
        sql: `INSERT INTO product_sources (id, product_id, source, external_id, active,
                created_at, updated_at)
              SELECT id || ?1 || '-eu', id || ?1, ?2, id || ?1, 1, created_at, updated_at
              FROM products WHERE id IN (SELECT id FROM temp.round)`,
        args: [sfx, EU_SOURCE],
      });
      await db.execute({
        sql: `INSERT INTO price_observations (id, product_id, source, observation_type, bucket,
                price_base, price_original, currency, fx_rate, observed_at, fetched_at,
                external_ref, excluded, created_at, updated_at, quantity_inferred)
              SELECT id || ?1 || '-eu', product_id || ?1, ?2, 'sold', bucket,
                CAST(price_base * ?3 AS INTEGER), CAST(price_base * ?3 / 162 * 100 AS INTEGER),
                'EUR', 162, observed_at, fetched_at, external_ref || ?1 || '-eu', 0, created_at,
                updated_at, 0
              FROM price_observations
              WHERE product_id IN (SELECT id FROM temp.round) AND observation_type = 'sold'
                AND abs(random()) % 10000 < ?4`,
        args: [sfx, EU_SOURCE, factor * 1.1, Math.round(share * 3_000)],
      });
    }
  }
  if (k <= lotRounds) {
    // Lots onto this round's copies of their items (the originals once copies run out); the
    // owner keeps OWNER_SHARE of the rounds, the others share the rest in turn.
    const user = (k % 10) / 10 < OWNER_SHARE || !others.length ? owner : others[k % others.length]!;
    const product =
      k <= rounds
        ? `CASE WHEN EXISTS (SELECT 1 FROM products p WHERE p.id = h.product_id || ?1)
                     THEN h.product_id || ?1 ELSE h.product_id END`
        : 'h.product_id';
    const limit = Math.min(lots, size.lots - lots * k);
    await db.execute({
      sql: `INSERT INTO holdings (id, user_id, product_id, quantity, cost_total_base, acquired_at,
              acquired_from, acquisition_type, parent_holding_id, condition, packaging_state,
              grading, raw_grade, grader, grade, cert_number, status, notes, created_at,
              updated_at, order_source, order_id, review_pending, review_reason, import_run_id,
              count_in_cost, count_in_value, condition_value)
            SELECT h.id || ?1, ?2, ${product}, quantity, cost_total_base, acquired_at,
              acquired_from, acquisition_type, CASE WHEN parent_holding_id IS NULL THEN NULL
              ELSE parent_holding_id || ?1 END, condition, packaging_state, grading, raw_grade,
              grader, grade, cert_number, status, notes, created_at, updated_at, order_source,
              CASE WHEN order_id IS NULL THEN NULL ELSE order_id || ?1 END, review_pending,
              review_reason, NULL, count_in_cost, count_in_value, condition_value
            FROM holdings h WHERE h.id NOT LIKE '%-s%'
            ORDER BY parent_holding_id IS NOT NULL, rowid LIMIT ?3`,
      args: [sfx, user, limit],
    });
    // A lot cut by the limit leaves its parent link dangling: dropped.
    await db.execute({
      sql: `UPDATE holdings SET parent_holding_id = NULL WHERE id LIKE '%' || ?1
              AND parent_holding_id IS NOT NULL
              AND parent_holding_id NOT IN (SELECT id FROM holdings)`,
      args: [sfx],
    });
    await db.execute({
      sql: `INSERT INTO holding_events (id, holding_id, type, occurred_at, amount_base, fees_base,
              payload, created_at, updated_at)
            SELECT e.id || ?1, e.holding_id || ?1, type, occurred_at, amount_base, fees_base,
              payload, e.created_at, e.updated_at
            FROM holding_events e WHERE e.holding_id || ?1 IN (SELECT id FROM holdings)`,
      args: [sfx],
    });
  }
  step(`round ${k}`);
}

for (const [what, sql] of [
  ['users', 'SELECT count(*) FROM users'],
  ['items', 'SELECT count(*) FROM products'],
  ['lots', 'SELECT count(*) FROM holdings'],
  ['prices', 'SELECT count(*) FROM price_observations'],
] as const)
  console.log(`${what}: ${await one(sql)}`);
db.close();
console.log(
  `Next: DATABASE_URL=file:${target} pnpm rebuild (times the nightly results at this size).`,
);
