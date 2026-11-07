// `pnpm --silent recheck-sales`: runs today's plug-in rules again on stored sales (requirements S30
// step 5). Dry unless --apply; only ever excludes; a run is undone by one command. Prints counts,
// never a title.
//
//   recheck-sales [--far] [--include-low] [--skip-reason <family>]... [--dump <file>] [--write-limits <file>]
//   recheck-sales --apply --limits <file>      writes, refused unless the limits hold
//   recheck-sales --undo <run> [--apply]       puts a run's rows back; a person's change stays
//
// --far: also marks sales far from the item's own history; rules alone without it. --dump: every verdict with its reason, a private file. --write-limits: the file --apply reads,
// from this dry run. --now: the run's time, for a rehearsal on a copy. Paths from the repo's root.
import {
  type RecheckRun,
  createDb,
  loadSourceRegistry,
  loadTimeZone,
  readRecheckRuns,
  recheckRunSources,
  recheckWrittenSoFar,
  undoRecheckRun,
} from '@tora/db';
import { dbConfigFromEnv, findRepoRoot, isRemoteUrl, loadRootEnv } from '@tora/db/env';
import { exitIfUnmigrated } from '@tora/db/migrate';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  type RecheckPlan,
  applyRecheck,
  checkedLimits,
  holdRecheckLocks,
  limitsBroken,
  limitsOf,
  planRecheck,
  refusedDatabase,
  unstampedLimits,
} from '../recheck';
import { loadCollectors } from '../registry';

const { values } = parseArgs({
  options: {
    apply: { type: 'boolean', default: false },
    limits: { type: 'string' },
    undo: { type: 'string' },
    far: { type: 'boolean', default: false },
    'include-low': { type: 'boolean', default: false },
    'skip-reason': { type: 'string', multiple: true },
    dump: { type: 'string' },
    'write-limits': { type: 'string' },
    now: { type: 'string' },
  },
});

let release = () => {};
function finish(): never {
  release();
  process.exit(0);
}
function stop(message: string): never {
  console.error(message);
  release();
  process.exit(1);
}
const fromRoot = (path: string) => resolve(findRepoRoot(), path);

const now = values.now ? new Date(values.now) : new Date();
if (Number.isNaN(now.getTime())) stop('--now cannot be read as a date.');
if (now.getTime() > Date.now()) stop('--now is later than the clock. Nothing written.');

loadRootEnv();
const config = dbConfigFromEnv();
console.log(`Database: ${isRemoteUrl(config.url) ? config.url : 'local file'}`);
if (values.apply) {
  const refused = refusedDatabase(config.url);
  if (refused) stop(refused);
}
const db = createDb(config);
await exitIfUnmigrated(db);
await loadTimeZone(db);

const locked = async (sources: string[]) => {
  const locks = await holdRecheckLocks(db, sources);
  if ('refused' in locks) return stop(`${locks.refused} Nothing written.`);
  for (const source of locks.interrupted)
    console.log(`A run of ${source} was interrupted earlier.`);
  release = locks.release;
};

// Undo comes before any plug-in is loaded: a broken or absent `collectors/` cannot block it.
if (values.undo) {
  const runs = await readRecheckRuns(db);
  const run: RecheckRun | undefined = runs.find((r) => r.id === values.undo);
  if (!run) {
    const known = runs.map((r) => `${r.id} (${r.status}, ${r.startedAt})`).join(', ') || 'none';
    stop(`No re-check run ${values.undo}. Known runs: ${known}.`);
  }
  if (values.apply) await locked(await recheckRunSources(db, values.undo));
  const undone = await undoRecheckRun(db, values.undo, { apply: values.apply!, now });
  console.log(
    `${values.apply ? 'Restored' : 'Would restore'} ${undone.restored}, already back ${undone.alreadyBack}, ` +
      `changed by a person ${undone.changedByPerson} (left alone), gone ${undone.gone}.`,
  );
  if (values.apply) console.log(`Items cleared and refreshed: ${undone.items}.`);
  else console.log('Dry run: nothing written. Add --apply.');
  finish();
}

const limits = values.apply
  ? (() => {
      if (!values.limits) return stop('--apply needs --limits <file>: it is what was rehearsed.');
      let read: unknown;
      try {
        read = JSON.parse(readFileSync(fromRoot(values.limits), 'utf8'));
      } catch (error) {
        const why = (error as NodeJS.ErrnoException).code ?? 'not JSON';
        return stop(`Limits file could not be read (${why}). Nothing written.`);
      }
      const checked = checkedLimits(read);
      if ('invalid' in checked) {
        return stop(`Limits file refused: ${checked.invalid}. Nothing written.`);
      }
      const unstamped = unstampedLimits(checked.limits, config.url);
      if (unstamped) return stop(`${unstamped} Nothing written.`);
      return checked.limits;
    })()
  : null;

const { recheckers } = await loadCollectors();
if (recheckers.length === 0) {
  console.log('Nothing to re-check: no plug-in offers it.');
  finish();
}
// Held before reading, so what is read is what gets written.
if (limits) await locked(recheckers.flatMap((r) => r.sources));

const plan = await planRecheck(db, recheckers, await loadSourceRegistry(db), {
  now,
  includeLow: values['include-low'],
  skipFamilies: values['skip-reason'] ?? [],
  far: values.far,
});

const list = (counts: Record<string, number>) =>
  Object.entries(counts)
    .toSorted((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k} ${n}`)
    .join(', ') || 'none';

function print(p: RecheckPlan) {
  console.log(`Rules: ${p.rulesId}`);
  console.log(`Read ${p.read} stored sales.`);
  console.log(`Changes: ${p.changes.length}`);
  for (const [key, n] of Object.entries(p.families).toSorted((a, b) => b[1] - a[1])) {
    const [source, family] = key.split('|');
    console.log(`  ${source}  ${family}: ${n}`);
  }
  console.log(`Left alone:`);
  console.log(`  protected: ${list(p.protected)}`);
  console.log(`  of those, the rules reject: ${list(p.protectedRejected)}`);
  console.log(`  low confidence (--include-low applies them): ${list(p.low)}`);
  console.log(`  another condition today, bucket not moved: ${p.bucketMoves}`);
  console.log(`  stored as a mismatch, passing today, stay excluded: ${p.nowPassing}`);
  if (Object.keys(p.skippedFamilies).length) {
    console.log(`  skipped by --skip-reason: ${list(p.skippedFamilies)}`);
  }
  console.log(`  not judged: ${list(p.unread)}`);
  if (!p.options.far) console.log(`  far prices: not in this run (--far adds them)`);
  const unchecked = Object.entries(p.farChecked).filter(([, on]) => !on);
  if (unchecked.length) {
    console.log(`  far prices not checked: ${unchecked.map(([s]) => s).join(', ')}`);
  }
}
print(plan);

if (values.dump) {
  writeFileSync(
    fromRoot(values.dump),
    JSON.stringify({
      rulesId: plan.rulesId,
      changes: plan.changes.map(({ rawText: _raw, updatedAt: _at, ...c }) => c),
      ...plan.detail,
    }),
  );
}
if (values['write-limits']) {
  writeFileSync(fromRoot(values['write-limits']), `${JSON.stringify(limitsOf(plan), null, 2)}\n`);
}
if (!limits) {
  console.log('Dry run: nothing written.');
  finish();
}

const broken = limitsBroken(plan, limits, await recheckWrittenSoFar(db, plan.rulesId));
if (broken.length) stop(`${broken.join('\n')}\nNothing written.`);

const result = await applyRecheck(db, plan, now, {
  onRun: (run, continued, left) => {
    if (left) console.log(`Run ${left} was interrupted under other rules; it stays as it is.`);
    console.log(`Run ${run.id}${continued ? ' continues' : ''}`);
  },
  onBatch: (done, batches) => console.log(`  batch ${done} of ${batches}`),
});
if (!result) {
  console.log('Nothing to change.');
  finish();
}
console.log(
  `Run ${result.run.id}: ${result.end.changed} rows changed, ${result.end.meanwhile} changed meanwhile.`,
);
console.log(`Items cleared and refreshed: ${result.end.items}.`);
console.log(`Undo: pnpm --silent recheck-sales --undo ${result.run.id} --apply`);
finish();
