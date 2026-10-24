/* global console, process, Buffer, URL */
// A signed-in browser session for the scripts that open the app's pages (crawl, perf). Sign-in
// from the environment or `.env`: CRAWL_USER, CRAWL_PASSWORD, and CRAWL_TOTP_KEY (base32) or
// CRAWL_TOTP_KEY_FILE; CRAWL_BASE the app's address.
import { createHash, createHmac } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};

export const env = { ...process.env };
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*(CRAWL_\w+)\s*=\s*"?([^"]*?)"?\s*$/);
    if (m && !env[m[1]]) env[m[1]] = m[2];
  }
}

export const BASE = (arg('base') ?? env.CRAWL_BASE ?? 'http://localhost:3200').replace(/\/$/, '');

// The session is kept between runs: each sign-in is a new device, and accounts allow few.
const SESSION = join(
  tmpdir(),
  `tora-crawl-${createHash('sha256').update(BASE).digest('hex').slice(0, 12)}.json`,
);

function totp(key, at = Date.now()) {
  const b32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of key.replace(/[\s=]/g, '').toUpperCase())
    bits += b32.indexOf(c).toString(2).padStart(5, '0');
  const bytes = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
  const h = createHmac('sha1', bytes).update(counter).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}

async function signIn(browser) {
  const user = env.CRAWL_USER;
  const password = env.CRAWL_PASSWORD;
  const key =
    env.CRAWL_TOTP_KEY ??
    (env.CRAWL_TOTP_KEY_FILE ? readFileSync(env.CRAWL_TOTP_KEY_FILE, 'utf8').trim() : null);
  if (!user || !password || !key) {
    console.error('Set CRAWL_USER, CRAWL_PASSWORD and CRAWL_TOTP_KEY or CRAWL_TOTP_KEY_FILE.');
    process.exit(2);
  }
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.fill('input[name="username"]', user);
  await page.fill('input[name="password"]', password);
  // Two steps: the password, then the code.
  await page.click('button[type="submit"]');
  await page.waitForSelector('input[name="code"]', { timeout: 60_000 }).catch(async () => {
    const alert = await page.locator('[role="alert"]').allInnerTexts();
    console.error(
      `Sign-in failed at the password step${alert.length ? `: ${alert.join(' ')}` : ''}.`,
    );
    process.exit(2);
  });
  await page.fill('input[name="code"]', totp(key));
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 }),
    page.click('button[type="submit"]'),
  ]).catch(() => {
    console.error('Sign-in failed (wrong details, or a code already used: wait 30 s).');
    process.exit(2);
  });
  const state = await context.storageState();
  await context.close();
  return state;
}

/** The saved session if it still opens the app, else a new sign-in (saved for next time). */
export async function session(browser) {
  if (existsSync(SESSION)) {
    const saved = JSON.parse(readFileSync(SESSION, 'utf8'));
    const context = await browser.newContext({ storageState: saved });
    const page = await context.newPage();
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    const valid = !new URL(page.url()).pathname.startsWith('/login');
    await context.close();
    if (valid) return saved;
  }
  const state = await signIn(browser);
  writeFileSync(SESSION, JSON.stringify(state), { mode: 0o600 });
  return state;
}
