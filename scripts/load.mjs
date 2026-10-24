/* global console, process, Buffer, URL, performance, fetch */
// Many people at once (S15): `pnpm perf --load <people> [--seconds 60] [--base <url>]`, from an
// install's folder whose .env names a local database file (a test copy, never the real app).
// Signs in that many accounts (those that can sign in, most lots first, taken in turn when fewer)
// by adding a device to each and signing its session with AUTH_SECRET, as a sign-in would; each
// then opens its pages over and over, one at a time, for the given time. Prints requests per
// second, failed requests and the slowest times per page; fails on any failed request. The
// devices are removed at the end.
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { BASE, arg } from './session.mjs';

/** The pages each person opens, `{lot}` and `{item}` one of theirs. */
const PAGES = [
  ['Portfolio', '/'],
  ['Items', '/items'],
  ['Item', '/products/{item}'],
  ['Lot', '/holdings/{lot}'],
  ['Actions', '/actions'],
  ['Imports', '/imports'],
  ['Opportunities', '/opportunities'],
  ['Watchlist', '/watchlist'],
  ['Stores', '/stores'],
];

function dotenv() {
  const env = {};
  if (!existsSync('.env')) return env;
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*(DATABASE_URL|AUTH_SECRET)\s*=\s*"?([^"]*?)"?\s*$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

const b64 = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');

/** A session token as the app signs one (HS256, audience `session`). */
function sessionToken(secret, userId, deviceId, fingerprint) {
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: 'HS256' })}.${b64({ dev: deviceId, fp: fingerprint, sub: userId, aud: 'session', iat: now, exp: now + 86_400 })}`;
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}

const percentile = (sorted, p) =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

export async function runLoad() {
  const people = Number(arg('load'));
  const seconds = Number(arg('seconds', '60'));
  const { DATABASE_URL: url, AUTH_SECRET: secret } = dotenv();
  if (!url?.startsWith('file:') || !secret) {
    console.error(
      'Run it from a test install: its .env needs a local DATABASE_URL (file:) and AUTH_SECRET.',
    );
    process.exit(1);
  }
  const require = createRequire(new URL('../packages/db/package.json', import.meta.url));
  const { createClient } = await import(pathToFileURL(require.resolve('@libsql/client')).href);
  const db = createClient({ url, timeout: 60_000 });

  const users = (
    await db.execute(
      `SELECT u.id, u.password_hash, u.totp_secret_enc FROM users u JOIN holdings h ON h.user_id = u.id
       WHERE u.disabled_at IS NULL AND u.password_hash IS NOT NULL GROUP BY u.id ORDER BY count(*) DESC`,
    )
  ).rows;
  const at = new Date().toISOString();
  const sessions = [];
  for (let i = 0; i < people; i++) {
    const user = users[i % users.length];
    const device = `load${randomBytes(10).toString('hex')}`;
    await db.execute({
      sql: `INSERT INTO user_devices (id, user_id, label, last_seen_at, created_at, updated_at) VALUES (?, ?, 'load test', ?, ?, ?)`,
      args: [device, user.id, at, at, at],
    });
    const fingerprint = createHash('sha256')
      .update(`${user.password_hash ?? ''}|${user.totp_secret_enc ?? ''}`)
      .digest('base64url')
      .slice(0, 16);
    const pick = async (sql) => (await db.execute({ sql, args: [user.id] })).rows[0]?.id ?? null;
    sessions.push({
      device,
      cookie: `tora_session=${sessionToken(secret, user.id, device, fingerprint)}`,
      item: await pick(
        `SELECT product_id AS id FROM holdings WHERE user_id = ? AND status = 'owned' LIMIT 1`,
      ),
      lot: await pick(`SELECT id FROM holdings WHERE user_id = ? AND status = 'owned' LIMIT 1`),
    });
  }

  console.log(
    `${people} people (${Math.min(people, users.length)} accounts) for ${seconds} s on ${BASE}`,
  );
  const times = new Map(PAGES.map(([name]) => [name, []]));
  const failed = new Map();
  const end = Date.now() + seconds * 1000;
  const started = performance.now();
  await Promise.all(
    sessions.map(async (s, n) => {
      for (let i = n; Date.now() < end; i++) {
        const [name, path] = PAGES[i % PAGES.length];
        const href = path.replace('{item}', s.item).replace('{lot}', s.lot);
        const t = performance.now();
        let status;
        try {
          const response = await fetch(BASE + href, {
            headers: { cookie: s.cookie },
            redirect: 'manual',
          });
          await response.text();
          // A page sending people elsewhere (Stores to pick an area first) is fine; to sign in is not.
          const login = response.headers.get('location')?.includes('/login');
          status = response.status < 400 && !login ? 200 : response.status;
        } catch (e) {
          status = e.cause?.code ?? e.message;
        }
        if (status === 200) times.get(name).push(performance.now() - t);
        else failed.set(`${name} ${status}`, (failed.get(`${name} ${status}`) ?? 0) + 1);
      }
    }),
  );
  const elapsed = (performance.now() - started) / 1000;

  for (const s of sessions)
    await db.execute({ sql: 'DELETE FROM user_devices WHERE id = ?', args: [s.device] });
  db.close();

  const all = [...times.values()].flat();
  console.log(
    `${all.length} pages in ${elapsed.toFixed(0)} s: ${(all.length / elapsed).toFixed(1)} a second, ${[...failed.values()].reduce((a, b) => a + b, 0)} failed`,
  );
  console.log(
    'page'.padEnd(14),
    'count'.padStart(6),
    'median'.padStart(8),
    'p95'.padStart(8),
    'max'.padStart(8),
  );
  for (const [name, list] of times) {
    const sorted = list.toSorted((a, b) => a - b);
    const ms = (v) => (v === undefined ? '-' : `${Math.round(v)}`).padStart(8);
    console.log(
      name.padEnd(14),
      String(sorted.length).padStart(6),
      ms(percentile(sorted, 0.5)),
      ms(percentile(sorted, 0.95)),
      ms(sorted.at(-1)),
    );
  }
  for (const [what, count] of failed) console.log(`failed: ${what} x${count}`);
  if (failed.size) process.exitCode = 1;
}
