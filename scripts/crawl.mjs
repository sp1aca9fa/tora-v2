/* global console, process, document, window, getComputedStyle, URL */
// The page crawler (S15, built before S10 part B): signs in, follows every in-app link from the
// home page and opens each page at phone and wide widths, then reports pages with a server error,
// a console error, a raw text key or {placeholder}, or that scroll sideways. Only opens pages
// (GET); presses nothing. Run it against a test copy, not the real app.
//   pnpm crawl [--base http://localhost:3200] [--max 150] [--per-pattern 2] [--only /settings]
//              [--shots <dir>] [--out <report.json>]
// Sign-in from the environment or `.env`: CRAWL_USER, CRAWL_PASSWORD, and CRAWL_TOTP_KEY (base32)
// or CRAWL_TOTP_KEY_FILE.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { BASE, arg, session } from './session.mjs';

const MAX = Number(arg('max', '150'));
const PER_PATTERN = Number(arg('per-pattern', '2'));
const ONLY = arg('only');
const SHOTS = arg('shots');
const OUT = arg('out');
const WIDTHS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'wide', width: 1280, height: 900 },
];
// Links that do something, download a file or leave the app's pages.
const SKIP = /^\/(api|logout|_next)\b|\/(export|download)\b|\.(csv|json|xlsx|zip|png|jpg|webp)$/;

/** Every message key path ("alerts.title"), to spot a text shown as its key. */
function messageKeys() {
  const keys = new Set();
  const walk = (o, path) => {
    for (const [k, v] of Object.entries(o)) {
      const p = path ? `${path}.${k}` : k;
      if (v && typeof v === 'object') walk(v, p);
      else keys.add(p);
    }
  };
  walk(JSON.parse(readFileSync('apps/web/messages/en.json', 'utf8')), '');
  return keys;
}

/** A path's shape: ids and numbers replaced, so a list of items is opened only a few times. */
const patternOf = (path) =>
  path
    .split('/')
    .map((s) => (/^[0-9a-f-]{8,}$|^\d+$|^[A-Za-z0-9_-]{20,}$/.test(s) ? ':id' : s))
    .join('/');

/** What is wrong with the open page, by the checks above. */
async function inspect(page, keys) {
  const found = await page.evaluate(() => {
    const text = document.body?.innerText ?? '';
    // Text meant literally (placeholders explained, commands) is shown as code.
    const literal = [...document.querySelectorAll('code, kbd, pre')].map((el) => el.innerText);
    const width = document.documentElement.clientWidth;
    const sideways = document.documentElement.scrollWidth > width + 1;
    // The outermost elements reaching past the right edge (not inside a scrolling box).
    const wide = [];
    if (sideways) {
      for (const el of document.body.querySelectorAll('*')) {
        const r = el.getBoundingClientRect();
        if (r.right <= width + 1 || r.width === 0) continue;
        let p = el.parentElement;
        let clipped = false;
        while (p && p !== document.body) {
          const s = getComputedStyle(p);
          if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) clipped = true;
          if (wide.includes(p)) clipped = true;
          p = p.parentElement;
        }
        if (!clipped) wide.push(el);
        if (wide.length >= 3) break;
      }
    }
    const describe = (el) =>
      `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${
        typeof el.className === 'string' && el.className
          ? `.${el.className.trim().split(/\s+/).slice(0, 3).join('.')}`
          : ''
      } "${(el.innerText ?? '').trim().slice(0, 40)}"`;
    return {
      text,
      literal,
      sideways: sideways ? `${document.documentElement.scrollWidth}px > ${width}px` : null,
      wide: wide.map(describe),
      // The dev server's tools are always on the page; only an error adds its issues badge or
      // opens its dialog.
      issues: (() => {
        const root = document.querySelector('nextjs-portal')?.shadowRoot;
        if (!root?.querySelector('[data-issues], [data-nextjs-dialog-root]')) return null;
        return root.querySelector('[data-issues-count]')?.textContent?.trim() || '?';
      })(),
      links: [...document.querySelectorAll('a[href]')]
        .filter((a) => !a.hasAttribute('download') && a.target !== '_blank')
        .map((a) => a.href),
      origin: window.location.origin,
    };
  });
  const problems = [];
  const raw = new Set();
  for (const m of found.text.matchAll(/\b[a-zA-Z]+(?:\.[a-zA-Z0-9_]+)+\b/g))
    if (keys.has(m[0])) raw.add(m[0]);
  if (raw.size) problems.push(`raw text keys: ${[...raw].slice(0, 5).join(', ')}`);
  let prose = found.text;
  // An empty code element would split the text into single characters.
  for (const l of found.literal) if (l.trim()) prose = prose.split(l).join(' ');
  const placeholders = [...new Set(prose.match(/\{[a-zA-Z]\w*\}/g) ?? [])];
  if (placeholders.length) problems.push(`placeholders: ${placeholders.slice(0, 5).join(', ')}`);
  if (/Application error|Internal Server Error|Unhandled Runtime Error/.test(found.text))
    problems.push('error page');
  if (found.issues) problems.push(`Next.js issues: ${found.issues}`);
  if (found.sideways)
    problems.push(`scrolls sideways (${found.sideways}): ${found.wide.join('; ') || '?'}`);
  return { problems, links: found.links, origin: found.origin };
}

const browser = await chromium.launch();
const state = await session(browser);
const keys = messageKeys();
const contexts = await Promise.all(
  WIDTHS.map((w) =>
    browser.newContext({
      storageState: state,
      viewport: { width: w.width, height: w.height },
      isMobile: w.name === 'phone',
      hasTouch: w.name === 'phone',
    }),
  ),
);
// Amounts shown (hidden by default): real widths for the sideways check, numbers in screenshots.
for (const context of contexts)
  await context.addCookies([{ name: 'tora_amounts', value: 'shown', url: BASE }]);
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const queue = [ONLY ?? '/'];
const seen = new Set(queue);
const perPattern = new Map();
const report = [];
while (queue.length && report.length < MAX) {
  const path = queue.shift();
  const entry = { path, problems: [] };
  for (const [i, context] of contexts.entries()) {
    const width = WIDTHS[i].name;
    const page = await context.newPage();
    const errors = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text().slice(0, 200));
    });
    page.on('pageerror', (e) => errors.push(`page error: ${String(e.message).slice(0, 200)}`));
    page.on('response', (r) => {
      if (r.status() >= 500) errors.push(`${r.status()} ${new URL(r.url()).pathname}`);
    });
    try {
      const res = await page.goto(`${BASE}${path}`, { waitUntil: 'load', timeout: 120_000 });
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
      if (new URL(page.url()).pathname.startsWith('/login')) {
        entry.problems.push(`${width}: sent to sign-in`);
      } else {
        if (res && res.status() >= 400) entry.problems.push(`${width}: HTTP ${res.status()}`);
        const { problems, links, origin } = await inspect(page, keys);
        for (const p of problems) entry.problems.push(`${width}: ${p}`);
        for (const e of [...new Set(errors)]) entry.problems.push(`${width}: console: ${e}`);
        if (SHOTS) {
          const file = `${path.replace(/[^\w-]+/g, '_') || 'home'}.${width}.png`;
          await page.screenshot({ path: join(SHOTS, file), fullPage: true });
        }
        for (const href of links) {
          const u = new URL(href);
          if (u.origin !== origin || SKIP.test(u.pathname)) continue;
          if (ONLY && !u.pathname.startsWith(ONLY)) continue;
          const next = u.pathname + u.search;
          if (seen.has(next)) continue;
          seen.add(next);
          const pattern = patternOf(u.pathname);
          const count = perPattern.get(pattern) ?? 0;
          if (count >= PER_PATTERN) continue;
          perPattern.set(pattern, count + 1);
          queue.push(next);
        }
      }
    } catch (error) {
      entry.problems.push(`${width}: did not load (${String(error.message).split('\n')[0]})`);
    }
    await page.close();
  }
  report.push(entry);
  console.log(`${entry.problems.length ? 'PROBLEM' : 'ok     '} ${path}`);
  for (const p of entry.problems) console.log(`          ${p}`);
}
await browser.close();

const bad = report.filter((e) => e.problems.length);
console.log(
  `\n${report.length} pages at ${WIDTHS.map((w) => w.width).join(' and ')} px; ${bad.length} with problems${
    queue.length ? `; ${queue.length} not opened (--max ${MAX})` : ''
  }.`,
);
if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 2));
process.exit(bad.length ? 1 : 0);
