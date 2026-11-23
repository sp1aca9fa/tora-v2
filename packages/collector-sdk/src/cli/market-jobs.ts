// `pnpm market-jobs [--source <s>] [--dry-run]`: the daytime job runner (requirements S36 B4),
// started every 30 minutes by scripts/market-jobs-cron.sh. Exit 0; 1 when it could not run or
// failed (an admin entry, at most one a day); 4 when a marketplace's refusal was recorded.
import { createDb, loadSourceRegistry, loadTimeZone, recordMarketJobsFailed } from '@tora/db';
import { dbConfigFromEnv, loadRootEnv } from '@tora/db/env';
import { exitIfUnmigrated } from '@tora/db/migrate';
import { parseArgs } from 'node:util';
import { errorText } from '../http';
import { collectBusy, holdRunLock } from '../lock';
import { jobCollectors, runMarketJobs } from '../market-jobs';
import { loadCollectors } from '../registry';

const { values } = parseArgs({
  options: { source: { type: 'string' }, 'dry-run': { type: 'boolean', default: false } },
});
const dryRun = values['dry-run'];

if (process.env.VERCEL || process.env.CI) {
  console.error('Collectors run only from the home PC (residential IP), not on Vercel/CI.');
  process.exit(1);
}

loadRootEnv();
const db = createDb(dbConfigFromEnv());
await exitIfUnmigrated(db);
// Hours and the day's count follow the admin's time zone, as the collect's days do.
const zone = await loadTimeZone(db);
const fail = async (error: string): Promise<never> => {
  console.error(`market jobs: ${error}`);
  if (!dryRun) await recordMarketJobsFailed(db, error).catch(() => {});
  process.exit(1);
};

// One run at a time; a dry run sends nothing, so it takes no lock.
const run = dryRun ? null : await holdRunLock();
if (run === 'held') {
  console.log('another market-jobs run is going');
  process.exit(0);
}
if (run === 'no flock') await fail('flock is not installed');
if (typeof run === 'object' && run) {
  // The run sees a collect only through /proc/locks: proven here on its own lock, else no run.
  try {
    collectBusy({ runLockPid: run.pid });
  } catch (e) {
    await fail(errorText(e));
  }
}
// Plug-ins only: their registry entries are the collect's to write. The admin's switches leave
// sources out as they do for the collect (read only).
const loaded = await loadCollectors();
const { kept, unused, off } = jobCollectors(
  loaded.collectors,
  loaded.sources,
  await loadSourceRegistry(db),
  values.source,
);
if (unused.length)
  console.log(
    `Not collected (their market is not in use, Settings > Markets): ${unused.join(', ')}`,
  );
if (off.length)
  console.log(
    `Not collected (off for every item type, Settings > Admin > Sources): ${off.join(', ')}`,
  );
let code = 0;
try {
  const report = await runMarketJobs(db, kept, {
    zone,
    source: values.source,
    dryRun,
    ...(typeof run === 'object' && run ? { runLockPid: run.pid } : {}),
  });
  console.log(
    `market jobs: ${report.requests} request(s)${report.refused.length ? `; refused by ${report.refused.join(', ')}` : ''}`,
  );
  if (report.errors.length) await fail(report.errors.join('; '));
  code = report.refused.length ? 4 : 0;
} catch (e) {
  await fail(errorText(e));
}
if (typeof run === 'object') await run?.release();
process.exit(code);
