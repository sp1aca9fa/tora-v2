/*
 * A game's marketplace history beyond the nightly read (requirements S36 Terms "Covered day", steps
 * A3, B3, B4; plan-deep-read.md): the deep read of the last 12 months, the weekly read-back of 6
 * weeks, and a load of saved search files. Every number here is a starting value ("to start").
 * Days are `YYYY-MM-DD` in the app's zone; unknown stays unknown (no frontier, no span).
 */

/** Months a deep read reaches back, to start (S36 B3: "the last 12 months"). */
export const DEEP_READ_MONTHS = 12;
/** Days a deep read or a load reads past its wanted day, to start (S36 B3: "by 4 weeks"). */
export const DEEP_PAST_DAYS = 28;
/** Days a read-back reaches back, to start (S36 B3: "6 weeks back"). */
export const READBACK_DAYS = 42;
/** Days a read-back reads past its wanted day, to start (S36 B3: "2 weeks"). */
export const READBACK_PAST_DAYS = 14;
/** Days between two read-backs of an item, to start (S36 B3: "each week"). */
export const READBACK_EVERY_DAYS = 7;
/** Pages a job reads of one search at most (the saved snapshot's belt; the busiest game is ~107). */
export const JOB_PAGE_BELT = 150;
/** A load of saved files (S36 A3): a job row that is stored only, never run. */
export const LOAD_JOB_KIND = 'load';
/** A load job's status once undone; outside `MARKET_JOB_STATUSES` (never active). */
export const JOB_UNDONE = 'undone';
/** Refs a job's result lists at most; more are counted. */
export const ELSEWHERE_LIST = 200;

/** Days read past `wanted_from` per kind: the plug-in's stop, the runner's and a span's start. */
export const JOB_PAST_DAYS = {
  deep: DEEP_PAST_DAYS,
  readback: READBACK_PAST_DAYS,
  load: DEEP_PAST_DAYS,
} as const;
export type SpanJobKind = keyof typeof JOB_PAST_DAYS;

/** Listings more than this many days older than their neighbors' median are strays (plan 10.2). */
const STRAY_DAYS = 28;
/** The frontier is the 5th newest of a page's last 10 listings (plan section 9 point 4). */
const FRONTIER_OF = 10;
const FRONTIER_RANK = 5;

/** What a job found, kept on its row (`market_jobs.result`). */
export interface JobResult {
  /** Rows it stored. */
  added?: number;
  /** The search the findings below belong to, and the day its first page was read. */
  search?: string;
  firstDay?: string;
  /**
   * The search that key stands for (words, category): a span stays only while it reads at least
   * what the item's search reads today (`atLeastAsBroad`; fix round 1, rule c).
   */
  read?: { keyword: string; categoryId: string | number | null };
  /** Sales this item would keep found stored under another item: refs (at most 200), more, items. */
  elsewhere?: string[];
  elsewhereMore?: number;
  elsewhereItems?: string[];
  /** Sales under another item that this item's own verdict leaves out: listed, block nothing. */
  notItem?: number;
  /** Sales stored here undone by a load's undo that this item would keep: they block too. */
  undoneHere?: string[];
  span?: { from: string; to: string };
  why?: SpanWhy;
  /** A load's files (S36 A3): the same fingerprint is never loaded twice. */
  fingerprint?: string;
  undone?: { rows: number; at: string };
}

/**
 * Why a job holds no span. Set after it finished (fix round 2, item 3): 'narrower_search' (the
 * search no longer within its read) and 'search_edited' (its rows deleted by a search save) queue
 * the deep read again at once; 'load_undone' (a load's undo dropped it) waits like the others.
 */
export type SpanWhy =
  | 'nothing_read'
  | 'too_recent'
  | 'elsewhere'
  | 'narrower_search'
  | 'unfinished_search'
  | 'search_edited'
  | 'load_undone';

/** `day` moved by `n` calendar days. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * The oldest day a job asked on `day` wants: a deep read or a load the same day 12 months earlier
 * (29 February: the 28th), a read-back 42 days earlier.
 */
export function wantedFromOf(kind: SpanJobKind, day: string): string {
  if (kind === 'readback') return addDays(day, -READBACK_DAYS);
  const back = `${Number(day.slice(0, 4)) - DEEP_READ_MONTHS / 12}${day.slice(4)}`;
  return addDays(back, 0).slice(5) === back.slice(5) ? back : `${back.slice(0, 8)}28`;
}

/** The day a job reads to before it stops: `wanted_from` minus the kind's days past it. */
export function readLimit(kind: SpanJobKind, wantedFrom: string | null): string | null {
  return wantedFrom ? addDays(wantedFrom, -JOB_PAST_DAYS[kind]) : null;
}

/**
 * How far a page of a search sorted newest listing first has surely read (plan section 9 point 4,
 * 10.2): `days` are its listings' creation days in page order (listings without one left out),
 * `tail` the kept days the search's earlier pages ended on. Strays (old listings out of order) are
 * the days more than 28 days older than the median of the last 20 pooled days; the frontier is the
 * 5th newest of the last 10 days left (fewer: the middle one, the newer of two). A page without a
 * day gives none. Returns the tail to pass with the next page.
 */
export function readFrontier(
  days: readonly string[],
  tail: readonly string[] = [],
): { frontier: string | null; tail: string[] } {
  if (!days.length) return { frontier: null, tail: [...tail] };
  const pool = [...tail, ...days];
  const near = pool
    .slice(-2 * FRONTIER_OF)
    .sort()
    .reverse();
  const floor = addDays(near[Math.floor((near.length - 1) / 2)]!, -STRAY_DAYS);
  const kept = pool.filter((d) => d >= floor);
  const last = kept.slice(-FRONTIER_OF).sort().reverse();
  const at = last.length >= FRONTIER_OF ? FRONTIER_RANK - 1 : Math.floor((last.length - 1) / 2);
  return { frontier: last[at] ?? null, tail: kept.slice(-2 * FRONTIER_OF) };
}

/**
 * The covered days of a finished job (S36 Terms "Covered day"; plan 10.7): from `wanted_from` when
 * the search read past it by the kind's days, else that many days after the oldest frontier
 * reached; to the day before the search's first page was read (`firstDay`), since later days were
 * read by no request. Nothing read gives none; from after to gives none.
 */
export function jobSpan(
  kind: SpanJobKind,
  wantedFrom: string | null,
  oldest: string | null,
  firstDay: string | null,
): { from: string; to: string } | { none: SpanWhy } {
  if (!oldest || !firstDay) return { none: 'nothing_read' };
  const past = addDays(oldest, JOB_PAST_DAYS[kind]);
  const from = wantedFrom && wantedFrom > past ? wantedFrom : past;
  const to = addDays(firstDay, -1);
  return from > to ? { none: 'too_recent' } : { from, to };
}

const wordsOf = (text: string) => text.normalize('NFKC').toLowerCase().split(/\s+/).filter(Boolean);

/**
 * Whether a saved search reads at least what the item's search reads today (S36 A3): the same or
 * no category, and no word today's search lacks. False when today's search has no words.
 */
export function atLeastAsBroad(
  saved: { keyword: string; categoryId: number | string | null },
  today: { keywords?: string[]; categoryId?: string },
): boolean {
  if (!today.keywords?.length) return false;
  if (saved.categoryId != null && String(saved.categoryId) !== String(today.categoryId ?? ''))
    return false;
  const have = new Set(wordsOf(today.keywords.join(' ')));
  return wordsOf(saved.keyword).every((w) => have.has(w));
}
