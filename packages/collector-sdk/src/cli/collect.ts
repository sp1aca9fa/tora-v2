// `pnpm collect [--source x] [--product id] [--match-only] [--collect-only] [--review]`
// Runs collectors from the home PC (never on Vercel/CI). Jitter for cron lives in
// scripts/collect-cron.sh.
import {
  checkSourceQuality,
  pruneSourceDetails,
  clearAllBucketValues,
  createDb,
  inferLotSizes,
  listUsers,
  refreshBucketValues,
  runSnapshots,
} from '@tora/db';
import { dbConfigFromEnv, isRemoteUrl, loadRootEnv } from '@tora/db/env';
import { exitIfUnmigrated } from '@tora/db/migrate';
import { parseArgs } from 'node:util';
import { PoliteHttp, errorText } from '../http';
import { downloadProductImages } from '../images';
import { importPurchaseLinks } from '../links';
import { updateRates } from '../rates';
import { loadAndRegister } from '../registry';
import { runCollector } from '../runner';
import { readWaitingUploads } from '../ai-import-run';
import { askClaude, claudeJudge } from '../claude';
import { Progress } from './progress';
import { reviewUsers } from './review-run';

const { values } = parseArgs({
  options: {
    source: { type: 'string' },
    product: { type: 'string' },
    'match-only': { type: 'boolean', default: false },
    'collect-only': { type: 'boolean', default: false },
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
// The plug-ins' source descriptions are saved first: the app reads them.
const { collectors, importers, rates, missing } = await loadAndRegister(db);
for (const dir of missing) console.log(`Collector package not present: ${dir}/ (skipped)`);
const selected = collectors.filter((c) => !values.source || c.source === values.source);
let exitCode = 0;
const withLinks = !values.product && importers.some((i) => i.readLink);
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
  const s = await runCollector(db, collector, {
    productId: values.product,
    matchOnly: values['match-only'],
    collectOnly: values['collect-only'],
    log: (m) => log(`[${collector.source}] ${m}`),
    onProgress: (p) => progress.update(collector.source, p.fraction, `${p.done}/${p.total}`),
  });
  log(
    `${s.source}: ${s.status}, ${s.requests} requests, ${s.candidates} new candidates, ${s.observationsAdded} new observations`,
  );
  if (s.status === 'failed' || s.status === 'blocked') exitCode = 1;
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
process.exit(exitCode);
