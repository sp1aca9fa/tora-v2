/* global console, process, document, window, performance, PerformanceObserver, URL */
// Page timings (S14): signs in, opens each main page at phone width (4G, a 4 times slower CPU)
// and wide width, first with an empty browser cache, then --runs more times (the median kept),
// and prints a table: when the HTML finished streaming, the largest paint (LCP), layout shift
// (CLS), HTML and JavaScript sizes, and database round trips and their time per page. Values over
// a target, or over 30 % slower than --baseline (a former --out), are marked and fail the run.
// Run it against a production build started with TORA_PERF=1 (without it the round trips show
// as -), not `next dev`, and not the real app. --sql N lists each page's N costliest statements
// over its warm runs (time per visit); --out keeps the 5 costliest either way.
//   pnpm perf [--base http://localhost:3200] [--runs 3] [--only Item] [--out <perf.json>]
//             [--baseline <perf.json>] [--sql 3]
//   pnpm perf --load <people> [--seconds 60]: many people at once (load.mjs)
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { BASE, arg, session } from './session.mjs';

// `--load <people>`: many people at once instead (S15, load.mjs).
if (arg('load')) {
  await (await import('./load.mjs')).runLoad();
  process.exit();
}

const RUNS = Number(arg('runs', '3'));
const ONLY = arg('only');
const OUT = arg('out');
const BASELINE = arg('baseline');
const SQL = Number(arg('sql', '0'));
const WIDTHS = [
  { name: 'phone', width: 390, height: 844, slow: true },
  { name: 'wide', width: 1280, height: 900, slow: false },
];
// Chrome's "Fast 4G" preset, in bytes per second.
const FAST_4G = { latency: 60, downloadThroughput: 9e6 / 8, uploadThroughput: 1.5e6 / 8 };
/** Targets (S14): main content within 1 s warm and 2.5 s at first, no layout shift past 0.1. */
const TARGET = { warmLcp: 1000, lcp: 2500, cls: 0.1 };
/** Slower than the baseline by this share, and by more than NOISE_MS, is reported. */
const SLOWER = 1.3;
const NOISE_MS = 50;

const PAGES = [
  ['Portfolio', '/'],
  ['Items', '/items'],
  ['Item', null],
  ['Lot', null],
  ['Actions', '/actions'],
  ['Imports', '/imports'],
  ['Opportunities', '/opportunities'],
  ['Watchlist', '/watchlist'],
  ['Stores', '/stores'],
  ['Settings', '/settings'],
];

const median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];

/** The links on a page whose path matches. */
async function links(context, path, pattern) {
  const page = await context.newPage();
  await page.goto(`${BASE}${path}`, { waitUntil: 'load', timeout: 120_000 });
  const hrefs = await page.$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href')));
  await page.close();
  return [...new Set(hrefs.filter((h) => pattern.test(h ?? '')))];
}

/** The server's round trips so far (null when it runs without TORA_PERF); `reset` starts its
 * statement list afresh. */
async function dbNow(context, reset = false) {
  const res = await context.request
    .get(`${BASE}/api/perf${reset ? '?reset=1' : ''}`)
    .catch(() => null);
  return res?.ok() ? res.json() : null;
}

async function newContext(browser, state, width) {
  const context = await browser.newContext({
    storageState: state,
    viewport: { width: width.width, height: width.height },
    isMobile: width.slow,
    hasTouch: width.slow,
  });
  await context.addInitScript(() => {
    const seen = { lcp: 0, cls: 0, lcpEl: null };
    window.__perf = seen;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        seen.lcp = e.startTime;
        // What painted it, after the earlier candidates: time, tag, then the picture's path or
        // the start of its text.
        const el = e.element;
        const what = el
          ? `${el.tagName.toLowerCase()} "${e.url ? new URL(e.url).pathname : (el.textContent ?? '').trim().slice(0, 30)}"`
          : '?';
        seen.lcpEl = [seen.lcpEl, `${Math.round(e.startTime)} ${what}`].filter(Boolean).join(' > ');
      }
    }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (!e.hadRecentInput) seen.cls += e.value;
    }).observe({ type: 'layout-shift', buffered: true });
  });
  return context;
}

/** One visit's numbers. */
async function visit(context, path, width) {
  const page = await context.newPage();
  if (width.slow) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, ...FAST_4G });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  }
  // Links prefetching their pages would count those pages' round trips here.
  await page.route(
    (u) => u.searchParams.has('_rsc'),
    (r) => r.abort(),
  );
  const before = await dbNow(context);
  const res = await page.goto(`${BASE}${path}`, { waitUntil: 'load', timeout: 120_000 });
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  const m = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const js = performance
      .getEntriesByType('resource')
      .filter((r) => /\.js(\?|$)/.test(r.name))
      .reduce((n, r) => n + r.encodedBodySize, 0);
    const shown = !document.location.pathname.startsWith('/login');
    return {
      shown,
      html: nav.responseEnd,
      lcp: window.__perf.lcp,
      lcpEl: window.__perf.lcpEl,
      cls: window.__perf.cls,
      htmlKb: nav.encodedBodySize / 1024,
      jsKb: js / 1024,
    };
  });
  const after = await dbNow(context);
  await page.close();
  if (!m.shown) throw new Error(`${path} sent to sign-in`);
  if (!res || res.status() >= 400) throw new Error(`${path} answered HTTP ${res?.status()}`);
  return {
    ...m,
    dbCalls: before && after ? after.calls - before.calls : null,
    dbMs: before && after ? after.ms - before.ms : null,
  };
}

const browser = await chromium.launch();
const state = await session(browser);
const finder = await browser.newContext({ storageState: state });
// The first item listed, and the first lot of the first items that have one (on their Details).
const items = await links(finder, '/items', /^\/products\/[^/?]+$/);
const item = items[0] ?? null;
let lot = null;
for (const i of items.slice(0, 5)) {
  lot = (await links(finder, `${i}/details`, /^\/holdings\/(?!grades$)[^/?]+$/))[0] ?? null;
  if (lot) break;
}
await finder.close();
const paths = { Item: item, Lot: lot };

const baseline = BASELINE ? JSON.parse(readFileSync(BASELINE, 'utf8')) : [];
const results = [];
const flagged = [];
for (const [name, fixed] of PAGES) {
  if (ONLY && name !== ONLY) continue;
  const path = fixed ?? paths[name];
  if (!path) {
    console.log(`${name}: none found, left out`);
    continue;
  }
  for (const width of WIDTHS) {
    // An empty browser cache, then the same browser again.
    const context = await newContext(browser, state, width);
    const first = await visit(context, path, width);
    await dbNow(context, true);
    const warmRuns = [];
    for (let i = 0; i < RUNS; i++) warmRuns.push(await visit(context, path, width));
    const statements = ((await dbNow(context))?.statements ?? [])
      .slice(0, 5)
      .map((s) => ({ ...s, calls: s.calls / RUNS, ms: s.ms / RUNS }));
    await context.close();
    const warm = Object.fromEntries(
      Object.keys(first).map((k) => [
        k,
        typeof first[k] !== 'number' ? first[k] : median(warmRuns.map((r) => r[k])),
      ]),
    );
    const row = { page: name, path, width: width.name, first, warm, statements, flags: [] };
    if (warm.lcp > TARGET.warmLcp) row.flags.push(`LCP ${Math.round(warm.lcp)} ms warm`);
    if (first.lcp > TARGET.lcp) row.flags.push(`LCP ${Math.round(first.lcp)} ms first`);
    if (Math.max(first.cls, warm.cls) > TARGET.cls) row.flags.push('CLS');
    const was = baseline.find((b) => b.page === name && b.width === width.name);
    for (const k of ['html', 'lcp']) {
      if (was && warm[k] > was.warm[k] * SLOWER && warm[k] - was.warm[k] > NOISE_MS)
        row.flags.push(`${k} ${Math.round(was.warm[k])} -> ${Math.round(warm[k])} ms`);
    }
    if (row.flags.length) flagged.push(row);
    results.push(row);
    console.log(`${name} ${width.name}: ${row.flags.join(', ') || 'ok'} (LCP: ${warm.lcpEl})`);
  }
}
await browser.close();

const ms = (n) => (n === null ? '-' : String(Math.round(n)));
const kb = (n) => String(Math.round(n));
console.log(
  `\n| Page | Width | HTML ms (first / warm) | LCP ms (first / warm) | CLS | HTML KB | JS KB | DB trips | DB ms |`,
);
console.log('|---|---|---|---|---|---|---|---|---|');
for (const r of results)
  console.log(
    `| ${r.page} | ${r.width} | ${ms(r.first.html)} / ${ms(r.warm.html)} | ${ms(r.first.lcp)} / ${ms(r.warm.lcp)} | ${Math.max(r.first.cls, r.warm.cls).toFixed(2)} | ${kb(r.first.htmlKb)} | ${kb(r.first.jsKb)} | ${ms(r.warm.dbCalls)} | ${ms(r.warm.dbMs)} |`,
  );
if (SQL)
  for (const r of results) {
    if (!r.statements.length) continue;
    console.log(`\n${r.page} ${r.width}:`);
    for (const s of r.statements.slice(0, SQL))
      console.log(
        `  ${s.ms.toFixed(1)} ms, ${s.calls} trip(s): ${s.sql.replace(/\s+/g, ' ').slice(0, 160)}`,
      );
  }
console.log(
  `\nPhone: Fast 4G and a 4x slower CPU; warm: median of ${RUNS}; sizes as sent (compressed).`,
);
if (OUT) writeFileSync(OUT, JSON.stringify(results, null, 2));
if (flagged.length) {
  console.log(`\n${flagged.length} over a target or slower than the baseline.`);
  process.exit(1);
}
