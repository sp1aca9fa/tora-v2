// `pnpm alerts <command>`: alerts outside the app from the PC or server (requirements S17).
//   after-run --since <time> [--collect-exit N] [--backup-exit N] [--log <collect.log>]
//       Run by scripts/collect-cron.sh after the collect and the backup: records a step that
//       stopped before it could record itself and sends failures to admins at once, then the
//       watched items' buy zone and target alerts (S9 part 5; from today's numbers only), each
//       printed, then the game wishes' alerts (S36 C3). Exits 1 when one person's wishes failed.
//   update --from <rev> --to <rev> [--failed <step> | --waiting pending|unknown] [--retry]
//       Run by a server's update script: logs the update, a failure to admins (step ci: GitHub
//       CI failed, uncommitted: refused; the server stayed on <from>); --waiting: the server has
//       gone 24 h without updating while CI was not green, to admins. Exits 1 when every admin
//       channel failed; the script then tries again with --retry (no second activity entry).
//   server <title> [--text <details>] [--level ok|problem|failed] [--tell]
//       Run by a server's own scripts: logs what they noticed (default level problem); --tell
//       also sends it to admins at once.
//   check   The app's morning check, run here (nothing ran for over a day; the daily summaries,
//       each person at most once in 20 hours).
//   market-refusals
//       Run by scripts/market-jobs-cron.sh after every daytime job run (S36 B4): a marketplace's
//       refusal or stop, and a runner that could not run, to admins. `after-run` also sends them.
//   data-check-reset <source>
//       Tora's self check (S30): accepts a source's numbers as they are, after someone has looked.
//       Its levels start over and its findings close.
import { localDate, toLocalIso } from '@tora/core';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { lastActivity, recordActivity } from '../activity';
import {
  type AlertContext,
  type AlertTexts,
  alertFailures,
  alertMarketRefusals,
  alertServerEvent,
  alertServerUpdate,
  checkMissedRuns,
  sendSummaries,
  stoppedReason,
} from '../alerts';
import { createDb } from '../client';
import { resetDataCheck, watchDataCheck } from '../data-check';
import { readAlertTexts } from '../alert-texts';
import { dbConfigFromEnv, loadRootEnv } from '../env';
import { loadTimeZone } from '../registry';
import { nightAlerts } from '../wish-alerts';

loadRootEnv();
const secret = process.env.AUTH_SECRET?.trim();
if (!secret) {
  console.error("alerts: AUTH_SECRET is not set in .env (the same as the app's).");
  process.exit(1);
}
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    since: { type: 'string' },
    'collect-exit': { type: 'string' },
    'backup-exit': { type: 'string' },
    log: { type: 'string' },
    from: { type: 'string' },
    to: { type: 'string' },
    failed: { type: 'string' },
    waiting: { type: 'string' },
    retry: { type: 'boolean' },
    text: { type: 'string' },
    level: { type: 'string' },
    tell: { type: 'boolean' },
  },
});
const db = createDb(dbConfigFromEnv());
await loadTimeZone(db);

/** The app's texts (apps/web/messages), so the PC and the app send the same words. */
const texts = (locale: string): AlertTexts => {
  try {
    return readAlertTexts(locale);
  } catch (e) {
    // A language with no file falls back to English; anything else is said in the log.
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
      console.error(`alerts: the texts of ${locale} could not be read: ${String(e)}`);
    return {};
  }
};
const ctx: AlertContext = { secret, texts, log: console.log };

const command = positionals[0];
if (command === 'after-run') {
  const parsed = values.since ? new Date(values.since) : new Date(Date.now() - 6 * 3_600_000);
  if (Number.isNaN(parsed.getTime())) {
    console.error(`alerts: --since is not a time: ${values.since}`);
    process.exit(1);
  }
  const since = toLocalIso(parsed);
  // A step that crashed recorded nothing: say so from its exit code.
  for (const kind of ['collect', 'backup'] as const) {
    const code = Number(values[`${kind}-exit`] ?? 0);
    if (!code) continue;
    const last = await lastActivity(db, kind);
    if (last && last.occurredAt >= since) continue;
    // Why, from this run's part of the log (e.g. a migration not run yet).
    let reason: string | null = null;
    if (values.log) {
      try {
        reason = stoppedReason(readFileSync(values.log, 'utf8').slice(-200_000));
      } catch {
        // No log: the exit code only.
      }
    }
    await recordActivity(db, {
      kind,
      level: 'failed',
      detail: { exitCode: code, error: reason ?? `exit code ${code}` },
      href: '/settings/activity',
    });
  }
  // A self check that has stopped, whatever stopped it: said from here, another process.
  try {
    await watchDataCheck(db);
  } catch (error) {
    console.log(`alerts: self check watch stopped: ${String(error)}`);
  }
  const failures = await alertFailures(db, ctx, since);
  console.log(`alerts: ${failures} failure message(s) sent (${localDate()})`);
  const market = await alertMarketRefusals(db, ctx);
  if (market) console.log(`alerts: ${market} daytime reads message(s) sent`);
  // The watched items' line is printed before the wishes' pass starts, so a wait or a crash there
  // still leaves it in the log (fix round 1, item 8). A person whose wishes failed is logged and
  // counted, the others go on; the exit is then non-zero as a crash's was (the watched items'
  // pass has no other rule), so the collect script's log still says "alerts failed".
  const { wish } = await nightAlerts(db, ctx, new Date(), {
    afterBuy: (buy) =>
      console.log(
        `alerts: ${buy.alerts} buy alert(s) for watched items, ${buy.sent} message(s) sent`,
      ),
  });
  if (wish.status === 'busy') console.log('wish alerts: skipped, another pass running');
  else {
    const more = [
      wish.lost && `${wish.lost} state write(s) lost`,
      wish.invalid && `${wish.invalid} wish state(s) not valid, skipped`,
      wish.skipped && `${wish.skipped} wish(es) saved during the pass, left to the next`,
      wish.failed && `${wish.failed} person(s) failed, see above`,
      wish.status === 'lease_lost' && 'stopped: another pass took over',
    ].filter(Boolean);
    console.log(
      `wish alerts: ${wish.alerts} alert(s) for wishes, ${wish.sent} message(s) sent${more.map((m) => `, ${m}`).join('')}`,
    );
    if (wish.failed) process.exitCode = 1;
  }
} else if (command === 'update') {
  // Run by a server's update script after an update (or a failed one), or while one waits for CI.
  const waiting = values.waiting ?? null;
  if (waiting !== null && waiting !== 'pending' && waiting !== 'unknown') {
    console.error('alerts update: --waiting pending|unknown');
    process.exit(1);
  }
  const sent = await alertServerUpdate(db, ctx, {
    from: values.from ?? '?',
    to: values.to ?? '?',
    failed: values.failed ?? null,
    waiting,
    retry: values.retry ?? false,
  });
  console.log(
    `alerts: server update ${waiting ? 'waiting for CI' : values.failed ? 'failed' : 'done'}, ${sent.sent} message(s) sent${sent.failed ? `, ${sent.failed} channel(s) failed` : ''}`,
  );
  // Every channel failed: exit 1, so the update script tries again at its next check.
  if (sent.sent === 0 && sent.failed > 0) process.exitCode = 1;
} else if (command === 'server') {
  const title = positionals.slice(1).join(' ').trim();
  const level = values.level ?? 'problem';
  if (!title || (level !== 'ok' && level !== 'problem' && level !== 'failed')) {
    console.error('alerts server: <title> [--text <details>] [--level ok|problem|failed] [--tell]');
    process.exit(1);
  }
  const sent = await alertServerEvent(db, ctx, {
    title,
    text: values.text ?? null,
    level,
    tell: values.tell ?? false,
  });
  console.log(`alerts: server event logged, ${sent} message(s) sent`);
} else if (command === 'check') {
  const missed = await checkMissedRuns(db, ctx);
  const summaries = await sendSummaries(db, ctx);
  console.log(
    `alerts: missed ${missed.join(', ') || 'nothing'}; ${summaries} summary message(s) sent`,
  );
} else if (command === 'market-refusals') {
  console.log(`alerts: ${await alertMarketRefusals(db, ctx)} daytime reads message(s) sent`);
} else if (command === 'data-check-reset') {
  const source = positionals[1];
  if (!source || !(await resetDataCheck(db, source))) {
    console.error(`alerts: nothing to reset for ${source ?? '(no source given)'}.`);
    process.exit(1);
  }
  console.log(`alerts: self check levels of ${source} start over; its findings are closed.`);
} else {
  console.error(
    'Usage: pnpm alerts after-run --since <time> [--collect-exit N] [--backup-exit N] [--log <file>] | check | market-refusals | update --from <rev> --to <rev> [--failed <step> | --waiting pending|unknown] [--retry] | server <title> [--text <details>] [--level ok|problem|failed] [--tell] | data-check-reset <source>',
  );
  process.exit(1);
}
