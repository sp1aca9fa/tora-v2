// Resumable sweep over a paged, newest-first trade history whose entries carry only a day
// (no transaction id). Observations are keyed per day, so a day is saved only once all of its
// entries have been seen: when an older day shows up, or the history ends.

export interface SweepState {
  /** `backfill` walks the whole history once; `incremental` stops at the last saved day. */
  mode: 'backfill' | 'incremental';
  /** Newest day whose trades are all saved. */
  ingestedThrough?: string;
  /** Page to resume from after a run was cut short by the page budget. */
  resumePage?: number;
  /** Newest day saved by the interrupted sweep (becomes `ingestedThrough` when it completes). */
  pendingNewest?: string;
}

export interface SweepOptions<E> {
  state: SweepState | null | undefined;
  /** Days after this are still filling up (or only shown with relative times): never saved. */
  cutoffDay: string;
  maxPages: number;
  /** Returns the entries of a 1-based page, newest first; an empty array ends the history. */
  fetchPage: (page: number) => Promise<E[]>;
  /** YYYY-MM-DD, or null for entries without an absolute day (e.g. "3時間前"). */
  dayOf: (entry: E) => string | null;
  /** Saves all entries of one complete day. Must be idempotent (days can be seen twice). */
  flushDay: (day: string, entries: E[]) => Promise<void>;
}

export interface SweepResult {
  state: SweepState;
  pages: number;
  daysSaved: number;
  /** False when the page budget ran out before reaching the end or the last saved day. */
  complete: boolean;
}

const later = (a: string | undefined, b: string | undefined) => (!a ? b : !b ? a : a > b ? a : b);

export async function sweepHistory<E>(options: SweepOptions<E>): Promise<SweepResult> {
  const prev: SweepState = options.state ?? { mode: 'backfill' };
  const stopBefore = prev.mode === 'incremental' ? prev.ingestedThrough : undefined;
  let page = prev.resumePage ?? 1;
  let pages = 0;
  let daysSaved = 0;
  let newest = prev.resumePage ? prev.pendingNewest : undefined;
  let finished = false;
  // At most one day is buffered: newer days are flushed as soon as an older one appears.
  let buffer: { day: string; firstPage: number; entries: E[] } | null = null;

  const flush = async () => {
    if (!buffer) return;
    await options.flushDay(buffer.day, buffer.entries);
    newest = later(newest, buffer.day);
    daysSaved++;
    buffer = null;
  };

  const startPage = page;
  // Past the budget, keep going only while the buffered day began on this run's first page:
  // resuming there would make no progress.
  const mayContinue = () =>
    pages < options.maxPages || (buffer !== null && buffer.firstPage === startPage);

  outer: while (mayContinue()) {
    const entries = await options.fetchPage(page);
    pages++;
    if (entries.length === 0) {
      finished = true;
      break;
    }
    for (const entry of entries) {
      const day = options.dayOf(entry);
      if (day === null || day > options.cutoffDay) continue;
      if (stopBefore && day < stopBefore) {
        finished = true;
        break outer;
      }
      if (buffer && buffer.day !== day) await flush();
      buffer ??= { day, firstPage: page, entries: [] };
      buffer.entries.push(entry);
    }
    page++;
  }

  if (finished) {
    await flush();
    return {
      state: { mode: 'incremental', ingestedThrough: later(prev.ingestedThrough, newest) },
      pages,
      daysSaved,
      complete: true,
    };
  }
  // Budget ran out: the buffered day may be incomplete, so resume where it started.
  const resumePage = (buffer as { firstPage: number } | null)?.firstPage ?? page;
  return {
    state: { ...prev, resumePage, pendingNewest: newest },
    pages,
    daysSaved,
    complete: false,
  };
}

/**
 * Stable references for identical trades on one day: the n-th identical entry gets `#n`.
 * Seeing a day again (or only part of it) yields the same or a subset of references.
 */
export function numberIdentical<E>(
  entries: E[],
  keyOf: (e: E) => string,
): { entry: E; ref: string }[] {
  const seen = new Map<string, number>();
  return entries.map((entry) => {
    const key = keyOf(entry);
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return { entry, ref: `${key}#${n}` };
  });
}
