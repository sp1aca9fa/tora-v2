// `pnpm alerts <command>`: alerts outside the app from the home PC (requirements S17).
//   after-run --since <time> [--collect-exit N] [--backup-exit N] [--log <collect.log>]
//       Run by scripts/collect-cron.sh after the collect and the backup: records a step that
//       stopped before it could record itself and sends failures to admins at once, then the
//       watched items' buy zone and target alerts (S9 part 5; from today's numbers only).
//   update --from <rev> --to <rev> [--failed <step>]
//       Run by scripts/update-server.sh --auto: logs a home server's update, a failure to admins.
//   funnel reset|down|back --url <address> [--restarted]
//       Run by scripts/funnel-check.sh: the public address was reset, is still down, or is back.
//   check   The app's morning check, run here (nothing ran for over a day; the daily summaries,
//       each person at most once in 20 hours).
import { localDate, toLocalIso } from '@tora/core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { lastActivity, recordActivity } from '../activity';
import {
  type AlertContext,
  alertFunnel,
  type AlertTexts,
  alertFailures,
  alertServerUpdate,
  checkMissedRuns,
  sendSummaries,
  sendWatchAlerts,
  stoppedReason,
} from '../alerts';
import { createDb } from '../client';
import { dbConfigFromEnv, findRepoRoot, loadRootEnv } from '../env';
import { loadTimeZone } from '../registry';

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
    url: { type: 'string' },
    restarted: { type: 'boolean' },
  },
});
const db = createDb(dbConfigFromEnv());
await loadTimeZone(db);

/** The app's texts (apps/web/messages), so the PC and the app send the same words. */
const texts = (locale: string): AlertTexts => {
  try {
    const file = join(findRepoRoot(), 'apps', 'web', 'messages', `${locale}.json`);
    return (JSON.parse(readFileSync(file, 'utf8')) as { alertText?: AlertTexts }).alertText ?? {};
  } catch {
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
  const failures = await alertFailures(db, ctx, since);
  console.log(`alerts: ${failures} failure message(s) sent (${localDate()})`);
  const buy = await sendWatchAlerts(db, ctx);
  console.log(`alerts: ${buy.alerts} buy alert(s) for watched items, ${buy.sent} message(s) sent`);
} else if (command === 'update') {
  // Run by scripts/update-server.sh --auto after an update (or a failed one, rolled back).
  const sent = await alertServerUpdate(db, ctx, {
    from: values.from ?? '?',
    to: values.to ?? '?',
    failed: values.failed ?? null,
  });
  console.log(
    `alerts: server update ${values.failed ? 'failed' : 'done'}, ${sent} message(s) sent`,
  );
} else if (command === 'funnel') {
  // Run by scripts/funnel-check.sh: reset (the Funnel was set up again), down, back.
  const event = positionals[1];
  if (event !== 'reset' && event !== 'down' && event !== 'back') {
    console.error('alerts funnel: reset | down | back --url <address> [--restarted]');
    process.exit(1);
  }
  const sent = await alertFunnel(db, ctx, event, {
    url: values.url ?? '?',
    ...(values.restarted ? { restarted: true } : {}),
  });
  console.log(`alerts: public address ${event}, ${sent} message(s) sent`);
} else if (command === 'check') {
  const missed = await checkMissedRuns(db, ctx);
  const summaries = await sendSummaries(db, ctx);
  console.log(
    `alerts: missed ${missed.join(', ') || 'nothing'}; ${summaries} summary message(s) sent`,
  );
} else {
  console.error(
    'Usage: pnpm alerts after-run --since <time> [--collect-exit N] [--backup-exit N] [--log <file>] | check | update --from <rev> --to <rev> [--failed <step>] | funnel reset|down|back --url <address> [--restarted]',
  );
  process.exit(1);
}
