// Which days each source was read for a game (requirements S36 Terms "Covered day"; plan section 9 H):
// the nights a nightly collect read it (compact day ranges, one row per item and source: S19's read
// budget), and the spans a finished read-back, deep read or load reached (rows of their own, so a job's
// span can be taken back). Unknown stays unknown: a night not read is never recorded, and nothing is
// filled in for days before recording started.
import { type SaleSpanHow, SALE_SPAN_HOWS, toLocalIso } from '@tora/core';
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from './client';
import { saleCoverage, saleSpans } from './schema';

/** Days `[from, to]`, both included, as `YYYY-MM-DD`. */
export type DayRange = [from: string, to: string];

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Whether `day` is a real calendar day written `YYYY-MM-DD`. */
export function isDay(day: unknown): day is string {
  if (typeof day !== 'string' || !DAY.test(day)) return false;
  const d = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === day;
}

/** The calendar day after `day` (calendar arithmetic, no time zone). */
export function nextDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Ranges sorted and merged: overlapping ones and ones that touch (one ends the day before the next
 * starts) become one. Ranges that are not valid (a bad day, from after to) are left out.
 */
export function mergeRanges(ranges: readonly DayRange[]): DayRange[] {
  const valid = ranges
    .filter(([from, to]) => isDay(from) && isDay(to) && from <= to)
    .map(([from, to]): DayRange => [from, to])
    .toSorted((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const out: DayRange[] = [];
  for (const [from, to] of valid) {
    const last = out.at(-1);
    if (last && from <= nextDay(last[1])) {
      if (to > last[1]) last[1] = to;
    } else out.push([from, to]);
  }
  return out;
}

/** The ranges cut to `[from, to]`. */
export function clipRanges(ranges: readonly DayRange[], from: string, to: string): DayRange[] {
  return mergeRanges(ranges).flatMap(([a, b]): DayRange[] => {
    const start = a > from ? a : from;
    const end = b < to ? b : to;
    return start <= end ? [[start, end]] : [];
  });
}

/** Every day of the ranges, in order. */
export function daysOf(ranges: readonly DayRange[]): string[] {
  const days: string[] = [];
  for (const [from, to] of mergeRanges(ranges)) {
    for (let d = from; d <= to; d = nextDay(d)) days.push(d);
  }
  return days;
}

/**
 * Every item's recorded nights at `source` (the runner reads them once per run, S19), by item id.
 */
export async function sourceNights(
  db: Pick<Db, 'select'>,
  source: string,
): Promise<Map<string, DayRange[]>> {
  const rows = await db
    .select({ productId: saleCoverage.productId, nights: saleCoverage.nights })
    .from(saleCoverage)
    .where(eq(saleCoverage.source, source));
  return new Map(rows.map((r) => [r.productId, r.nights ?? []]));
}

/** Whether `day` is in the ranges. */
export function coversDay(ranges: readonly DayRange[], day: string): boolean {
  return ranges.some(([from, to]) => from <= day && day <= to);
}

/**
 * Records that the night of `day` read `source` for the item (the runner calls it on a link's
 * successful collect, games only). Writes nothing when the day is already covered. `known`: the item's
 * nights at the source as the caller read them this run (`sourceNights`), so nothing is read again.
 * The write then applies only while the stored nights still equal `known`; when another writer (a
 * merge of two items during the run) changed them meanwhile, the row is read again and the day
 * added to what is there, so nothing recorded is lost. A row removed since (a search saved) is not
 * brought back with `known`: only the day is written. Returns the nights as they are now.
 */
export async function addNight(
  db: Db,
  productId: string,
  source: string,
  day: string,
  known?: readonly DayRange[],
): Promise<DayRange[]> {
  if (!isDay(day)) throw new Error(`addNight: not a day: ${day}`);
  let nights: DayRange[] | null = known ? [...known] : null;
  // Every write applies only while the row is as it was read; a few tries, then the last writer wins.
  for (let attempt = 0; ; attempt++) {
    let stored: string | null;
    if (nights) stored = JSON.stringify(nights);
    else {
      const [row] = await db
        .select({ nights: saleCoverage.nights })
        .from(saleCoverage)
        .where(and(eq(saleCoverage.productId, productId), eq(saleCoverage.source, source)));
      nights = row?.nights ?? [];
      stored = row ? JSON.stringify(nights) : null;
    }
    if (coversDay(nights, day)) return nights;
    const merged = mergeRanges([...nights, [day, day]]);
    const at = toLocalIso();
    const last = attempt >= 3;
    // Nights read from a row are written over that row only: when it was removed since (a search
    // saved, `forgetReads`), nothing is written and the row is read again, so the removed nights
    // never come back and only this night is recorded (fix round 2, item 2).
    const fromRow = stored !== null && nights.length > 0 && !last;
    const written = fromRow
      ? await db
          .update(saleCoverage)
          .set({ nights: merged, updatedAt: at })
          .where(
            and(
              eq(saleCoverage.productId, productId),
              eq(saleCoverage.source, source),
              sql`${saleCoverage.nights} = ${stored}`,
            ),
          )
          .returning({ productId: saleCoverage.productId })
      : await db
          .insert(saleCoverage)
          .values({ productId, source, nights: merged, updatedAt: at })
          .onConflictDoUpdate({
            target: [saleCoverage.productId, saleCoverage.source],
            set: { nights: merged, updatedAt: at },
            // The column stores `JSON.stringify` of the ranges, so the same call compares exactly.
            // A row that appeared since a read that found none (`stored` null) never matches.
            setWhere: last ? undefined : sql`${saleCoverage.nights} = ${stored ?? ''}`,
          })
          .returning({ productId: saleCoverage.productId });
    if (written.length) return merged;
    // Someone else wrote this row since it was read: read it again and add the day to what is there.
    nights = null;
  }
}

export interface SpanInput {
  productId: string;
  source: string;
  from: string;
  to: string;
  how: SaleSpanHow;
  /** The job that read it, so its span can be taken back (`removeSpan`). */
  jobId?: string | null;
}

/**
 * Records the days a finished read-back, deep read or load covered (also inside a transaction).
 * Returns the span's id.
 */
export async function addSpan(db: Pick<Db, 'insert'>, span: SpanInput): Promise<string> {
  if (!isDay(span.from) || !isDay(span.to) || span.from > span.to) {
    throw new Error(`addSpan: not a span: ${span.from} to ${span.to}`);
  }
  if (!SALE_SPAN_HOWS.includes(span.how)) throw new Error(`addSpan: unknown kind ${span.how}`);
  const [row] = await db
    .insert(saleSpans)
    .values({
      productId: span.productId,
      source: span.source,
      fromDay: span.from,
      toDay: span.to,
      how: span.how,
      jobId: span.jobId ?? null,
    })
    .returning({ id: saleSpans.id });
  return row!.id;
}

/** Takes back the spans a job recorded (its load undone). Returns how many went. */
export async function removeSpan(db: Pick<Db, 'delete'>, jobId: string): Promise<number> {
  if (!jobId) return 0;
  const gone = await db
    .delete(saleSpans)
    .where(eq(saleSpans.jobId, jobId))
    .returning({ id: saleSpans.id });
  return gone.length;
}

/**
 * Takes back every span of an item at a source (also inside a transaction): its rows there were
 * deleted or excluded, so no span may claim them (fix round 1, rule a). Nights stay. Returns how
 * many went.
 */
export async function dropSpans(
  db: Pick<Db, 'delete'>,
  productId: string,
  source: string,
): Promise<number> {
  const gone = await db
    .delete(saleSpans)
    .where(and(eq(saleSpans.productId, productId), eq(saleSpans.source, source)))
    .returning({ id: saleSpans.id });
  return gone.length;
}

/** The covered days of an item at a source within `[from, to]`, as merged ranges (nights and spans). */
export async function coveredRanges(
  db: Pick<Db, 'select'>,
  productId: string,
  source: string,
  from: string,
  to: string,
): Promise<DayRange[]> {
  if (!isDay(from) || !isDay(to) || from > to) return [];
  const [row] = await db
    .select({ nights: saleCoverage.nights })
    .from(saleCoverage)
    .where(and(eq(saleCoverage.productId, productId), eq(saleCoverage.source, source)));
  const spans = await db
    .select({ from: saleSpans.fromDay, to: saleSpans.toDay })
    .from(saleSpans)
    .where(and(eq(saleSpans.productId, productId), eq(saleSpans.source, source)));
  return clipRanges(
    [...(row?.nights ?? []), ...spans.map((s): DayRange => [s.from, s.to])],
    from,
    to,
  );
}

/** The covered days of an item at a source within `[from, to]`, each day once, in order. */
export async function coveredDays(
  db: Pick<Db, 'select'>,
  productId: string,
  source: string,
  from: string,
  to: string,
): Promise<string[]> {
  return daysOf(await coveredRanges(db, productId, source, from, to));
}
