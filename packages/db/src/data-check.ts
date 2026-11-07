// The self check's reads and writes (requirements S30 step 6; `packages/core/src/data-check.ts` holds
// the logic). One `app_settings` row, read by key. Rows of sources kept from AI models are left out
// right at the read, so they reach no number, no message and no pooled comparison.
import {
  type DataCheckDescribed,
  type DataCheckOpen,
  type DataCheckSale,
  type DataCheckState,
  type DataCheckStatus,
  dataCheckStatus,
  dataCheckWithout,
  emptyDataCheckState,
  judgeDataCheck,
  localDate,
  noAiSources,
  resetDataCheckSource,
  toLocalIso,
} from '@tora/core';
import { and, eq, gte, inArray } from 'drizzle-orm';
import { lastActivity, recordActivity } from './activity';
import type { Db } from './client';
import { loadItemSales } from './item-sales';
import { loadSourceRegistry, readSetting, saveSetting } from './registry';
import { VALUE_SERIES_BREAK_KEY, type ValueSeriesBreak } from './sales-recheck';
import { type PackedSales, activity, collectorRuns, products } from './schema';

export const DATA_CHECK_KEY = 'dataCheck';
export const DATA_CHECK_HREF = '/settings/collectors#data-check';
/** Without a collect for this long there is nothing new to judge; `no_collect` says so. */
const NO_COLLECT_HOURS = 26;
/** Days with a collect and no check before `after-run` says the check has stopped. */
const STOPPED_COLLECT_DAYS = 3;
const SALES_DAYS = 60;
const DAY = 86_400_000;

/** Sources declaring sold prices, not kept from AI, with their market. */
function checkedSources(registry: Awaited<ReturnType<typeof loadSourceRegistry>>) {
  const noAi = noAiSources(registry);
  return registry.sources.filter((s) => s.priceKinds?.includes('sold') && !noAi.includes(s.key));
}

/**
 * The kept sold rows of these sources in the last 60 days, and the rows found per source and day,
 * from the packed sales. Time zones run in steps of 15 minutes, so a sale's day is worked out once
 * per step: about 200,000 sales go through here.
 */
export function dataCheckRows(
  packed: Iterable<[string, PackedSales]>,
  sources: Set<string>,
  now: Date,
): { sales: DataCheckSale[]; found: Record<string, Record<string, number>> } {
  const steps = new Map<number, string>();
  const dayOf = (at: number) => {
    const step = Math.floor(at / 900_000);
    let day = steps.get(step);
    if (!day) {
      day = localDate(new Date(at));
      steps.set(step, day);
    }
    return day;
  };
  const since = now.getTime() - (SALES_DAYS + 1) * DAY;
  const sales: DataCheckSale[] = [];
  const found: Record<string, Record<string, number>> = {};
  const foundFrom = localDate(new Date(now.getTime() - 8 * DAY));
  for (const [productId, item] of packed) {
    for (const [source, perDay] of Object.entries(item.n)) {
      if (!sources.has(source)) continue;
      const total = (found[source] ??= {});
      for (const [day, n] of Object.entries(perDay)) {
        if (day >= foundFrom) total[day] = (total[day] ?? 0) + n;
      }
    }
    for (const g of item.groups) {
      if (g.t !== 'sold' || !sources.has(g.s)) continue;
      const estimated = new Set(g.e);
      g.at.forEach((at, i) => {
        if (at < since) return;
        sales.push({
          productId,
          bucket: g.b,
          source: g.s,
          day: dayOf(at),
          price: g.p[i]!,
          estimated: estimated.has(i),
        });
      });
    }
  }
  return { sales, found };
}

/** What a person calls a finding's parts. */
async function described(
  db: Db,
  registry: Awaited<ReturnType<typeof loadSourceRegistry>>,
  open: DataCheckOpen[],
): Promise<DataCheckDescribed[]> {
  const labels = new Map(registry.sources.map((s) => [s.key, s.label]));
  const ids = [...new Set(open.flatMap((o) => (o.kind === 'apart' ? [o.productId] : [])))];
  const names = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 200) {
    for (const p of await db
      .select({ id: products.id, name: products.name })
      .from(products)
      .where(inArray(products.id, ids.slice(i, i + 200)))) {
      names.set(p.id, p.name);
    }
  }
  return open.map((o) => {
    const label = o.source === null ? null : (labels.get(o.source) ?? o.source);
    return o.kind === 'apart'
      ? {
          ...o,
          label,
          otherLabel: labels.get(o.other) ?? o.other,
          name: names.get(o.productId) ?? o.productId,
        }
      : { ...o, label };
  });
}

/** The last day a re-check or its undo changed which sales count (never removed). */
async function lastBreak(db: Db): Promise<string | null> {
  const breaks = await readSetting<ValueSeriesBreak>(db, VALUE_SERIES_BREAK_KEY);
  return Object.values(breaks ?? {}).reduce<string | null>(
    (latest, day) => (!latest || day > latest ? day : latest),
    null,
  );
}

/** Days of the last week each source had a run that worked (failed and blocked ones did not). */
async function runDaysOf(db: Db, sources: string[], now: Date): Promise<Record<string, string[]>> {
  if (!sources.length) return {};
  const rows = await db
    .select({ source: collectorRuns.source, startedAt: collectorRuns.startedAt })
    .from(collectorRuns)
    .where(
      and(
        inArray(collectorRuns.source, sources),
        gte(collectorRuns.startedAt, toLocalIso(new Date(now.getTime() - 8 * DAY))),
        inArray(collectorRuns.status, ['ok', 'partial']),
      ),
    );
  const out: Record<string, string[]> = {};
  for (const r of rows) (out[r.source] ??= []).push(r.startedAt.slice(0, 10));
  return out;
}

/**
 * The morning's check: judges at most once a day and says what is new. The activity entry is
 * recorded before the state is saved: a save that fails means the next check judges again, the same
 * day capped by `alertsSentToday` and a later day said again, never lost. Returns what it told; null
 * when it did not judge.
 */
export async function runDataCheck(db: Db, now = new Date()): Promise<DataCheckDescribed[] | null> {
  const day = localDate(now);
  const saved = await readSetting<DataCheckState>(db, DATA_CHECK_KEY);
  if (saved?.days[day] !== undefined) return null;
  const collect = await lastActivity(db, 'collect');
  if (!collect || now.getTime() - Date.parse(collect.occurredAt) >= NO_COLLECT_HOURS * 3_600_000) {
    return null;
  }
  const registry = await loadSourceRegistry(db);
  const sources = checkedSources(registry);
  const keys = sources.map((s) => s.key);
  const { sales, found } = dataCheckRows(await loadItemSales(db), new Set(keys), now);
  const result = judgeDataCheck({
    day,
    sales,
    found,
    markets: Object.fromEntries(sources.map((s) => [s.key, s.market ?? null])),
    runDays: await runDaysOf(db, keys, now),
    breakDay: await lastBreak(db),
    // A source marked noAi after its numbers were stored: the check starts over without it.
    state: saved && dataCheckWithout(saved, noAiSources(registry)),
  });
  const told = await described(db, registry, result.tell);
  if (told.length) {
    await recordActivity(db, {
      kind: 'check',
      action: 'data_check',
      level: 'problem',
      detail: { findings: told },
      href: DATA_CHECK_HREF,
      occurredAt: toLocalIso(now),
    });
  }
  await saveSetting(db, DATA_CHECK_KEY, result.state);
  return told;
}

/**
 * `pnpm alerts after-run`, another process than the check: 3 days with a collect since the check
 * last ran mean it has stopped, whatever stopped it. Counted from the day it first looked when the
 * check never ran. A server back from days off is not blamed before its morning. At most once a day.
 */
export async function watchDataCheck(db: Db, now = new Date()): Promise<boolean> {
  const state = await readSetting<DataCheckState>(db, DATA_CHECK_KEY);
  const from = state?.lastRun ?? state?.firstSeen;
  if (!from) {
    await saveSetting(db, DATA_CHECK_KEY, {
      ...(state ?? emptyDataCheckState()),
      firstSeen: localDate(now),
    });
    return false;
  }
  const collects = await db
    .select({ at: activity.occurredAt })
    .from(activity)
    .where(and(eq(activity.kind, 'collect'), gte(activity.occurredAt, `${from}~`)));
  const days = new Set(collects.map((c) => c.at.slice(0, 10))).size;
  if (days < STOPPED_COLLECT_DAYS) return false;
  const said = await lastActivity(db, 'check', { action: 'data_check_failed' });
  if (said && now.getTime() - Date.parse(said.occurredAt) < 20 * 3_600_000) return false;
  await recordActivity(db, {
    kind: 'check',
    action: 'data_check_failed',
    level: 'failed',
    detail: { since: from, days },
    href: DATA_CHECK_HREF,
  });
  return true;
}

/**
 * An admin accepts a source's numbers as they are (`pnpm alerts data-check-reset <source>`). Also one
 * no longer on the list with a finding still open, which nothing else could close. Never a noAi one.
 */
export async function resetDataCheck(db: Db, source: string, now = new Date()): Promise<boolean> {
  const state = await readSetting<DataCheckState>(db, DATA_CHECK_KEY);
  const registry = await loadSourceRegistry(db);
  if (!state || noAiSources(registry).includes(source)) return false;
  const known =
    checkedSources(registry).some((s) => s.key === source) ||
    Object.values(state.open).some((o) => o.kind !== 'apart' && o.source === source);
  if (!known) return false;
  await saveSetting(db, DATA_CHECK_KEY, resetDataCheckSource(state, source, localDate(now)));
  return true;
}

export type DataCheckSourceRow = DataCheckStatus & { source: string; label: string };

export interface DataCheckView {
  /** The last morning it judged; null before the first. */
  lastRun: string | null;
  sources: DataCheckSourceRow[];
  open: DataCheckDescribed[];
}

/** What the Settings section and the data tool show: one row per sold source, the open findings. */
export async function dataCheckView(db: Db): Promise<DataCheckView> {
  const registry = await loadSourceRegistry(db);
  const saved = await readSetting<DataCheckState>(db, DATA_CHECK_KEY);
  const state = saved && dataCheckWithout(saved, noAiSources(registry));
  const open = Object.values(state?.open ?? {}).toSorted(
    (a, b) =>
      Number(a.kind === 'apart') - Number(b.kind === 'apart') ||
      b.openedOn.localeCompare(a.openedOn) ||
      a.key.localeCompare(b.key),
  );
  return {
    lastRun: state?.lastRun ?? null,
    sources: checkedSources(registry).map((s) => ({
      source: s.key,
      label: s.label,
      ...dataCheckStatus(state, s.key),
    })),
    open: await described(db, registry, open),
  };
}
