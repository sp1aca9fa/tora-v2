// `pnpm collect [--market us] [--source x] [--product id] [--match-only] [--collect-only] [--refresh] [--review]`
// --market / --source: one market's or one source's collectors (S16: spread across the night).
// Listings already collected today are left out (a retry does only what is left) unless --refresh
// or --product; a site another collect is running is skipped (never two runs for one site).
// Runs collectors from the home PC (never on Vercel/CI). Jitter for cron lives in
// scripts/collect-cron.sh.
import {
  checkSourceQuality,
  pruneSourceDetails,
  clearAllBucketValues,
  createDb,
  inferLotSizes,
  listUsers,
  recordActivity,
  refreshBucketValues,
  runSnapshots,
  loadTimeZone,
} from '@tora/db';
import { dbConfigFromEnv, isRemoteUrl, loadRootEnv } from '@tora/db/env';
import { exitIfUnmigrated } from '@tora/db/migrate';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { PoliteHttp, errorText } from '../http';
import { downloadProductImages } from '../images';
import { importPurchaseLinks } from '../links';
import { updateRates } from '../rates';
import { loadAndRegister } from '../registry';
import { defaultLockDir, lockSource } from '../lock';
import { runCollector } from '../runner';
import { readWaitingUploads } from '../ai-import-run';
import { askClaude, claudeJudge } from '../claude';
import { Progress } from './progress';
import { reviewUsers } from './review-run';

const { values } = parseArgs({
  options: {
    market: { type: 'string' },
    source: { type: 'string' },
    product: { type: 'string' },
    'match-only': { type: 'boolean', default: false },
    'collect-only': { type: 'boolean', default: false },
    /** Collect listings again even if already collected today. */
    refresh: { type: 'boolean', default: false },
    /** Then the automated data review (S4d), also when TORA_REVIEW=1. */
    review: { type: 'boolean', default: false },
  },
});

if (process.env.VERCEL || process.env.CI) {
  console.error('Collectors run only from the home PC (residential IP), not on Vercel/CI.');
  process.exit(1);
}

loadRootEnv();
const config = dbConfigFromEnv();
console.log(`Database: ${isRemoteUrl(config.url) ? config.url : 'local file'}`);
const db = createDb(config);
await exitIfUnmigrated(db);
// Times written follow the admin's time zone (S16 part 5).
const timeZone = await loadTimeZone(db);
// The schedule's daily stamp counts days in the app's zone too (scripts/collect-cron.sh).
try {
  const state = dirname(defaultLockDir());
  mkdirSync(state, { recursive: true });
  writeFileSync(join(state, 'time-zone'), `${timeZone}\n`);
} catch {
  // Without it the schedule counts days on the PC's clock.
}
// The plug-ins' source descriptions are saved first: the app reads them.
const { collectors, importers, rates, sources, missing } = await loadAndRegister(db);
for (const dir of missing) console.log(`Collector package not present: ${dir}/ (skipped)`);
const marketOf = new Map(sources.map((s) => [s.key, s.market]));
const selected = collectors.filter(
  (c) =>
    (!values.source || c.source === values.source) &&
    (!values.market || marketOf.get(c.source) === values.market),
);
if (values.market && selected.length === 0) {
  const known = [...new Set(sources.map((s) => s.market).filter(Boolean))].join(', ');
  console.error(`No collectors for market "${values.market}" (markets: ${known || 'none'}).`);
  process.exit(1);
}
let exitCode = 0;
// Each collector's result, for the activity log (S17).
const results: { source: string; status: string; requests: number; observations: number }[] = [];
const withLinks = !values.product && importers.some((i) => i.readLink);
// A run per market keeps the rates, purchase links and uploads (each does only what is waiting).
const withRates = !values.product && !values.source && rates.length > 0;
// Steps: exchange rates, purchase links, each collector, then pictures + lot sizes + snapshots.
const progress = new Progress((withRates ? 1 : 0) + (withLinks ? 1 : 0) + selected.length + 1);
const log = progress.log;
// Exchange rates first: foreign prices collected in this run are converted with today's rate.
if (withRates) {
  progress.next('exchange rates');
  try {
    for (const r of await updateRates(db, rates, new PoliteHttp({ maxRequests: 10 }))) {
      log(
        r.source
          ? `exchange rates: ${r.pair} ${r.saved} day(s) saved, latest ${r.latest ?? 'none'}`
          : `exchange rates: ${r.pair} has no rate plug-in (Settings > Markets: pick one or type a rate)`,
      );
    }
  } catch (error) {
    log(`exchange rates: stopped (${errorText(error)})`);
  }
}
// Purchase links pasted in the app go first, so new products get searched in this run.
if (withLinks) {
  progress.next('purchase links');
  const links = await importPurchaseLinks(
    db,
    importers,
    collectors,
    new PoliteHttp({ maxRequests: 200 }),
    (m) => log(`[purchase links] ${m}`),
    (p) => progress.update('purchase links', p.fraction, `${p.done}/${p.total}`),
  );
  const { imported, matched, duplicate, skipped, failed } = links.counts;
  if (links.read + failed + links.left > 0) {
    log(
      `purchase links: ${imported} imported (see Review import), ${matched} matched, ${duplicate} already registered, ${skipped} skipped, ${failed} failed${links.left ? `, ${links.left} left for next time` : ''}`,
    );
  }
}
// Purchase files uploaded in the app and not read yet (no Claude API key on the app).
if (!values.product && !values.source) {
  try {
    const read = await readWaitingUploads(db, askClaude, { log: (m) => log(`[uploads] ${m}`) });
    if (read) log(`uploads: ${read} batch(es) read (see Imports > Review)`);
  } catch (error) {
    log(`uploads: stopped (${errorText(error)})`);
  }
}
if (selected.length === 0) console.log('No collectors registered.');
for (const collector of selected) {
  progress.next(collector.source);
  const lock = lockSource(collector.source);
  if ('heldBy' in lock) {
    // Not a success: the schedule tries again later, when the other run is done.
    log(`${collector.source}: skipped, another collect is running it (process ${lock.heldBy})`);
    results.push({ source: collector.source, status: 'locked', requests: 0, observations: 0 });
    exitCode = 1;
    continue;
  }
  let s;
  try {
    s = await runCollector(db, collector, {
      productId: values.product,
      matchOnly: values['match-only'],
      collectOnly: values['collect-only'],
      skipCollectedToday: !values.refresh && !values.product,
      exclusive: true,
      log: (m) => log(`[${collector.source}] ${m}`),
      onProgress: (p) => progress.update(collector.source, p.fraction, `${p.done}/${p.total}`),
    });
  } finally {
    lock.release();
  }
  log(
    `${s.source}: ${s.status}, ${s.requests} requests, ${s.candidates} new candidates, ${s.observationsAdded} new observations`,
  );
  if (s.status === 'failed' || s.status === 'blocked') exitCode = 1;
  results.push({
    source: s.source,
    status: s.status,
    requests: s.requests,
    observations: s.observationsAdded,
  });
}
// Product pictures not stored yet (separate polite client: the collectors' cap is spent).
progress.next('pictures, lot sizes, chart');
try {
  const images = await downloadProductImages(db, new PoliteHttp({ maxRequests: 40 }), {
    log: (m) => log(`[images] ${m}`),
  });
  log(`images: ${images.saved} saved, ${images.failed} failed`);
} catch (error) {
  log(`images: stopped (${errorText(error)})`);
}
progress.update('pictures, lot sizes, chart', 0.3);
// Trades whose lot size the source did not report, then the snapshots for the portfolio chart.
const lots = await inferLotSizes(db);
log(`lot sizes: ${lots.checked} estimated trade(s) checked, ${lots.updated} updated`);
progress.update('pictures, lot sizes, chart', 0.5);
// The quality gate first: a supporting source that disagrees with the reference is not valued.
// Listing details some sources may keep only for a while (e.g. eBay's listing IDs).
const pruned = await pruneSourceDetails(db);
if (pruned) log(`listing details dropped: ${pruned} row(s)`);
const quality = await checkSourceQuality(db);
if (quality.length) {
  log(`source quality changed: ${quality.join(', ')}`);
  await clearAllBucketValues(db);
}
const snap = await runSnapshots(db);
// Today's value of everything held, read by the pages instead of every sale.
const saved = await refreshBucketValues(db);
progress.done();
console.log(`snapshots: ${snap.days} day(s), ${snap.rows} row(s) updated, ${snap.removed} removed`);
console.log(`values: ${saved.values} saved, ${saved.removed} removed`);
if (values.review || process.env.TORA_REVIEW === '1') {
  await reviewUsers(db, await listUsers(db), claudeJudge, { log: console.log });
}
// The activity log (S17); a failed run is sent to admins by `pnpm alerts after-run`.
const failed = results.some((r) => r.status === 'failed' || r.status === 'blocked');
await recordActivity(db, {
  kind: 'collect',
  level: failed ? 'failed' : exitCode ? 'problem' : 'ok',
  detail: {
    market: values.market ?? null,
    source: values.source ?? null,
    product: values.product ?? null,
    sources: results,
    observations: results.reduce((n, r) => n + r.observations, 0),
    values: saved.values,
  },
  href: '/settings/collectors',
});
process.exit(exitCode);
