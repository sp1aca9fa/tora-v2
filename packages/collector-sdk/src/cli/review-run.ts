import type { Db, User } from '@tora/db';
import { errorText } from '../http';
import { type Judge, runReview } from '../review';

/** Reviews each user's flagged data and prints one line each (shared by review and collect). */
export async function reviewUsers(
  db: Db,
  users: Pick<User, 'id' | 'username'>[],
  judge: Judge,
  options: { dryRun?: boolean; log: (m: string) => void },
): Promise<void> {
  const { log } = options;
  for (const user of users) {
    try {
      const s = await runReview(db, user.id, judge, {
        dryRun: options.dryRun,
        log: (m) => log(`  ${m}`),
      });
      if (s.cases === 0) {
        log(`review ${user.username}: nothing new to check`);
        continue;
      }
      const filed = Object.entries(s.filed)
        .map(([k, n]) => `${n} ${k.replace('_', ' ')}`)
        .join(', ');
      const calls = s.calls
        .map((c) => `${c.model} ${Math.round(c.tokens / 1000)}k tokens $${c.costUsd.toFixed(3)}`)
        .join(' + ');
      log(
        `review ${user.username}: ${s.cases} case(s), ${s.escalated} to the stronger model; ` +
          `${filed || 'no new suggestions'}${options.dryRun ? ' (dry run, nothing filed)' : ''}; ${calls}`,
      );
    } catch (error) {
      log(`review ${user.username} failed: ${errorText(error)}`);
    }
  }
}
