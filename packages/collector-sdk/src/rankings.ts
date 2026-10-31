// Rankings (requirements S13 part 3): each ranking plug-in read once a day with the nightly
// collect, before the collectors, so new candidates are collected the same night.
import { type Db, saveRanking } from '@tora/db';
import { BlockedError, type PoliteHttp } from './http';
import type { RankingSource } from './types';

export async function readRankings(
  db: Db,
  sources: RankingSource[],
  http: PoliteHttp,
  opts: { log: (message: string) => void; now?: Date },
): Promise<{ read: number; candidates: number; failed: number; blocked: string | null }> {
  const now = opts.now ?? new Date();
  let read = 0;
  let candidates = 0;
  let failed = 0;
  for (const source of sources) {
    try {
      const items = await source.rank({ http, now, log: opts.log });
      if (!items.length) throw new Error('no ranked items (a changed page?)');
      const saved = await saveRanking(db, source, items, now);
      opts.log(
        `${source.label}: ${saved.saved} ranked, ${saved.matched} known, ${saved.candidates} new candidate(s)`,
      );
      read++;
      candidates += saved.candidates;
    } catch (error) {
      failed++;
      opts.log(
        `${source.label}: stopped (${error instanceof Error ? error.message : String(error)})`,
      );
      // A refusal stops every read of the run (section 7: never retry aggressively); the caller
      // leaves the site alone for the rest of the day.
      if (error instanceof BlockedError)
        return { read, candidates, failed, blocked: source.source };
    }
  }
  return { read, candidates, failed, blocked: null };
}
