// `pnpm collect [--source x] [--product id] [--match-only] [--collect-only]`
// Runs collectors from the home PC (never on Vercel/CI). Jitter for cron lives in
// scripts/collect-cron.sh.
import { createDb, inferLotSizes, runSnapshots } from '@tora/db';
import { dbConfigFromEnv, isRemoteUrl, loadRootEnv } from '@tora/db/env';
import { exitIfUnmigrated } from '@tora/db/migrate';
import { parseArgs } from 'node:util';
import { loadCollectors } from '../registry';
import { runCollector } from '../runner';

const { values } = parseArgs({
  options: {
    source: { type: 'string' },
    product: { type: 'string' },
    'match-only': { type: 'boolean', default: false },
    'collect-only': { type: 'boolean', default: false },
  },
});

if (process.env.VERCEL || process.env.CI) {
  console.error('Collectors run only from the home PC (residential IP), not on Vercel/CI.');
  process.exit(1);
}

loadRootEnv();
const config = dbConfigFromEnv();
const { collectors, missing } = await loadCollectors();
for (const dir of missing) console.log(`Collector package not present: ${dir}/ (skipped)`);
const selected = collectors.filter((c) => !values.source || c.source === values.source);
console.log(`Database: ${isRemoteUrl(config.url) ? config.url : 'local file'}`);
const db = createDb(config);
await exitIfUnmigrated(db);
let exitCode = 0;
if (selected.length === 0) console.log('No collectors registered.');
for (const collector of selected) {
  const s = await runCollector(db, collector, {
    productId: values.product,
    matchOnly: values['match-only'],
    collectOnly: values['collect-only'],
  });
  console.log(
    `${s.source}: ${s.status}, ${s.requests} requests, ${s.candidates} new candidates, ${s.observationsAdded} new observations`,
  );
  if (s.status === 'failed' || s.status === 'blocked') exitCode = 1;
}
// Trades whose lot size the source did not report, then the snapshots for the portfolio chart.
const lots = await inferLotSizes(db);
console.log(`lot sizes: ${lots.checked} estimated trade(s) checked, ${lots.updated} updated`);
const snap = await runSnapshots(db);
console.log(`snapshots: ${snap.days} day(s), ${snap.rows} row(s) updated, ${snap.removed} removed`);
process.exit(exitCode);
