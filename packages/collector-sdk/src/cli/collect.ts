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
  linkSets,
  listUsers,
  recordActivity,
  refreshBucketValues,
  checkItemSales,
  getProduct,
  refreshItemSales,
  refreshOpportunities,
  refreshRuleTests,
  refreshSignals,
  refreshTradeCounts,
  runSnapshots,
  readSetting,
  saveSetting,
  saveUsage,
  loadTimeZone,
  loadSourceRegistry,
} from '@tora/db';
import { INSIGHT_PERIODS, localDate, marketsInUse } from '@tora/core';
import { dbConfigFromEnv, isRemoteUrl, loadRootEnv } from '@tora/db/env';
import { exitIfUnmigrated } from '@tora/db/migrate';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { PoliteHttp, errorText } from '../http';
import { downloadProductImages } from '../images';
import { importPurchaseLinks } from '../links';
import { updateRates } from '../rates';
import { syncCatalogs } from '../catalog';
import { loadAndRegister } from '../registry';
import { defaultLockDir, lockSource } from '../lock';
import { readOpeningCards } from '../opening';
import { readRankings } from '../rankings';
import { runCollector } from '../runner';
import { readWaitingUploads } from '../ai-import-run';
import { askClaude, claudeJudge } from '../claude';
import { Progress } from './progress';
import { reviewUsers } from './review-run';

/** The day the closing steps last finished (app setting). */
const CLOSED_KEY = 'closingStepsDay';

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
const { collectors, importers, rates, sources, setCards, rankings, catalogs, missing } =
  await loadAndRegister(db);
// The plug-ins' set lists, when they or the admin's categories changed (S10).
try {
  const synced = await syncCatalogs(db, catalogs);
  if (synced)
    console.log(
      `set catalog: ${synced.sets} sets in use loaded, ${synced.removed} no longer listed removed`,
    );
} catch (e) {
  console.log(`set catalog: not loaded (${errorText(e)})`);
}
for (const dir of missing) console.log(`Collector package not present: ${dir}/ (skipped)`);
const marketOf = new Map(sources.map((s) => [s.key, s.market]));
// Only the markets the admin uses, unless a market or source is asked for by name (S10).
const inUse = marketsInUse(sources, (await loadSourceRegistry(db)).markets);
const used = (source: string) => {
  const market = marketOf.get(source);
  return !!values.market || !!values.source || !market || inUse.has(market);
};
const unused = collectors.filter((c) => !used(c.source)).map((c) => c.source);
if (unused.length)
  console.log(
    `Not collected (their market is not in use, Settings > Markets): ${unused.join(', ')}`,
  );
const selected = collectors.filter(
  (c) =>
    used(c.source) &&
    (!values.source || c.source === values.source) &&
    (!values.market || marketOf.get(c.source) === values.market),
);
const usedRankings = rankings.filter((r) => used(r.source));
if (values.market && selected.length === 0) {
  const known = [...new Set(sources.map((s) => s.market).filter(Boolean))].join(', ');
  console.error(`No collectors for market "${values.market}" (markets: ${known || 'none'}).`);
  process.exit(1);
}
let exitCode = 0;
// Each collector's result, for the activity log (S17).
const results: { source: string; status: string; requests: number; observations: number }[] = [];
// Listings set aside tonight (their page gone night after night): admins are told (S10).
const setAside: { source: string; productId: string; name: string; error: string }[] = [];
const withLinks = !values.product && importers.some((i) => i.readLink);
// A run per market keeps the rates, purchase links and uploads (each does only what is waiting).
const withRates = !values.product && !values.source && rates.length > 0;
// The box opening value's cards (S20): each set once a week, in any full or per-market run.
const withOpening = !values.product && !values.source && setCards.length > 0;
// Rankings (S13): before the collectors, so new candidates are collected the same night.
const withRankings = !values.product && !values.source && usedRankings.length > 0;
// Steps: exchange rates, purchase links, each collector, box opening cards, then pictures + lot
// sizes + snapshots.
const progress = new Progress(
  (withRates ? 1 : 0) +
    (withLinks ? 1 : 0) +
    (withRankings ? 1 : 0) +
    selected.length +
    (withOpening ? 1 : 0) +
    1,
);
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
if (withRankings) {
  progress.next('rankings');
  const locks = usedRankings.map((r) => lockSource(r.source));
  try {
    if (locks.some((l) => 'heldBy' in l)) {
      log('rankings: skipped, another collect is reading the same site');
    } else {
      const read = await readRankings(db, usedRankings, new PoliteHttp({ maxRequests: 20 }), {
        log: (m) => log(`[rankings] ${m}`),
      });
      log(
        `rankings: ${read.read} read, ${read.candidates} new candidate(s), ${read.failed} failed`,
      );
    }
  } catch (error) {
    log(`rankings: stopped (${errorText(error)})`);
  } finally {
    for (const l of locks) if (!('heldBy' in l)) l.release();
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
  for (const l of s.setAside) setAside.push({ source: s.source, ...l });
}
if (withOpening) {
  progress.next('box opening cards');
  const locks = setCards.map((s) => lockSource(s.source));
  try {
    if (locks.some((l) => 'heldBy' in l)) {
      log('box opening cards: skipped, another collect is reading the same site');
    } else {
      const read = await readOpeningCards(db, setCards, new PoliteHttp({ maxRequests: 400 }), {
        log: (m) => log(`[box opening] ${m}`),
      });
      if (read.sets || read.failed) {
        log(
          `box opening cards: ${read.sets} set(s) read, ${read.cards} card(s), ${read.failed} failed`,
        );
      }
    }
  } catch (error) {
    log(`box opening cards: stopped (${errorText(error)})`);
  } finally {
    for (const l of locks) if (!('heldBy' in l)) l.release();
  }
}
// Product pictures not stored yet (separate polite client: the collectors' cap is spent).
progress.next('pictures, lot sizes, chart');
try {
  const images = await downloadProductImages(db, new PoliteHttp({ maxRequests: 40 }), {
    log: (m) => log(`[images] ${m}`),
    isVariant: (source, title) =>
      !!title && !!collectors.find((c) => c.source === source)?.variantListing?.(title),
  });
  log(`images: ${images.saved} saved, ${images.failed} failed`);
} catch (error) {
  log(`images: stopped (${errorText(error)})`);
}
progress.update('pictures, lot sizes, chart', 0.3);
// The closing steps run once a day on the same data: a later run that day (a retry after a
// failure) that fetched nothing (every listing already collected today) leaves them as the
// earlier run left them. A run that fetched anything (sales, asks, recent sales) runs them.
const added = results.reduce((n, r) => n + r.observations, 0);
const fetched = results.reduce((n, r) => n + r.requests, 0);
const closedOn = await readSetting<string>(db, CLOSED_KEY);
let snap: Awaited<ReturnType<typeof runSnapshots>> | null = null;
let saved: Awaited<ReturnType<typeof refreshBucketValues>> | null = null;
let signalsSaved: { saved: number; withPattern: number; lineSuggestions: number } | null = null;
let ruleGroups = 0;
let opportunities: Awaited<ReturnType<typeof refreshOpportunities>> | null = null;
if (!values.refresh && fetched === 0 && closedOn === localDate()) {
  log('closing steps: already done today and nothing fetched since, left out');
} else {
  // Trades whose lot size the source did not report, then the snapshots for the portfolio chart.
  const lots = await inferLotSizes(db);
  log(
    `lot sizes: ${lots.checked} estimated trade(s) checked${lots.full ? ' (all)' : ''}, ${lots.updated} updated`,
  );
  // Each item's packed sales, which the pages and the steps below read (the days changed by this
  // run and the lot sizes; everything once a week).
  try {
    const days = await refreshItemSales(db);
    log(`item sales: ${days.items} item(s) updated${days.full ? ' (full rebuild)' : ''}`);
  } catch (error) {
    log(`item sales: stopped (${errorText(error)})`);
  }
  // The self-check: a few items packed again from their raw sales and compared (a difference is
  // fixed and sent to admins as a failed check).
  try {
    const check = await checkItemSales(db);
    if (check.fixed.length) {
      const names = (await Promise.all(check.fixed.map((id) => getProduct(db, id)))).map(
        (p) => p?.name ?? '?',
      );
      log(
        `self-check: ${check.fixed.length} of ${check.checked} item(s) differed, fixed: ${names.join(', ')}`,
      );
      await recordActivity(db, {
        kind: 'check',
        action: 'self_check',
        level: 'failed',
        detail: { checked: check.checked, fixed: names },
        href: '/settings/activity',
      });
    } else {
      log(`self-check: ${check.checked} item(s) match their sales`);
    }
  } catch (error) {
    log(`self-check: stopped (${errorText(error)})`);
  }
  // Items without a catalog set: linked when sure, suggested on Actions when not (S9).
  const sets = await linkSets(db);
  if (sets.linked || sets.suggested) {
    log(
      `sets: ${sets.linked} item(s) linked to the catalog, ${sets.suggested} to confirm on Actions`,
    );
  }
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
  snap = await runSnapshots(db);
  // Today's value of everything held, read by the pages instead of every sale.
  saved = await refreshBucketValues(db);
  // The Portfolio's trade counts, saved so its page does not scan the sales on every view.
  try {
    await refreshTradeCounts(db, INSIGHT_PERIODS);
  } catch (error) {
    console.log(`trade counts: stopped (${errorText(error)})`);
  }
  // Buy timing numbers for everything held or watched (S9), from the values just saved. A failure
  // here (e.g. the database not migrated yet) never stops the run.
  try {
    signalsSaved = await refreshSignals(db);
  } catch (error) {
    console.log(`buy timing: stopped (${errorText(error)})`);
  }
  // Rule tests on the whole history of each group of similar items (S9 part 5).
  try {
    ruleGroups = await refreshRuleTests(db);
  } catch (error) {
    console.log(`rule tests: stopped (${errorText(error)})`);
  }
  // Opportunities (S13): every item's signals and their tests on each group's history.
  try {
    opportunities = await refreshOpportunities(db);
  } catch (error) {
    console.log(`opportunities: stopped (${errorText(error)})`);
  }
  await saveSetting(db, CLOSED_KEY, localDate());
}
progress.done();
if (snap) {
  console.log(
    `snapshots: ${snap.days} day(s), ${snap.rows} row(s) updated, ${snap.removed} removed`,
  );
}
if (saved) console.log(`values: ${saved.values} saved, ${saved.removed} removed`);
if (signalsSaved) {
  console.log(
    `buy timing: ${signalsSaved.saved} item(s) and condition(s), ${signalsSaved.withPattern} with a new-set pattern`,
  );
  if (signalsSaved.lineSuggestions) {
    log(`set lines: ${signalsSaved.lineSuggestions} to confirm on Actions`);
  }
}
if (ruleGroups) console.log(`rule tests: ${ruleGroups} group(s) of similar items`);
if (opportunities) {
  console.log(
    `opportunities: ${opportunities.items.length} item(s), ${Object.keys(opportunities.tests).length} group(s) tested`,
  );
}
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
    observations: added,
    values: saved?.values ?? null,
  },
  href: '/settings/collectors',
});
if (setAside.length)
  await recordActivity(db, {
    kind: 'check',
    action: 'listings_gone',
    level: 'problem',
    detail: { listings: setAside },
    href: '/actions',
  });
await saveUsage(db);
process.exit(exitCode);
