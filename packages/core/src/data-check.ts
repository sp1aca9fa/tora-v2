// Tora's self check (requirements S30 step 6): each morning it compares a source with its own usual
// numbers, and sources of one market with each other, and says when something looks odd. It fixes
// nothing. All of it is here, pure; `packages/db/src/data-check.ts` reads and saves. Its name is not
// "self check" in the code: `self_check` already means the packed-sales comparison (S19).
//
// Too few sales says nothing, and unknown stays unknown: a source with no numbers tonight gets no
// entry (never 0), a night not judged never counts as a good one, tonight is never in its own level.
import { median } from './market';

/**
 * The limits. "Owner" ones are the owner's proposal (`actions.md`, 2026-11-07); "plan" ones were
 * added by the plan and its review (`.agent-runs/2026-11-07-s30/plan-self-check.md`), the numbers
 * behind them are there, and the owner decides them too. They change with their tests, never to make
 * something pass.
 */
export const DATA_CHECK = {
  /** Owner: says nothing until about 14 days of its own numbers exist. */
  learnNights: 14,
  /** Plan: the week a source's numbers are about; one night's rows swing with backfill depth. */
  weekDays: 7,
  /** S30's baseline: an item and condition's median comes from 60 days, on 5+ sales of the source. */
  medianDays: 60,
  medianMinSales: 5,
  /** S30's baseline: a sale is far when over 2x or under half that median. */
  farRatio: 2,
  /** Owner: a source's far share at 1.5x its usual. */
  farTimesUsual: 1.5,
  /** Plan: a share needs 100+ judged sales, 5+ far ones, and 1 point above usual (0.2 % on 0.1 %). */
  farMinJudged: 100,
  farMinFar: 5,
  farMinPoints: 1,
  /** Plan: at this share (percent) it fires whatever its usual: a standing level looks normal. */
  farCeiling: 5,
  /** Plan: "far fewer" is under 0.7x the source's level a week ago, on a level of 100+. */
  keptUnder: 0.7,
  keptMinUsual: 100,
  /** Plan: runs on 6 of the last 7 days, or the fall is explained by runs that did not happen. */
  keptMinRunDays: 6,
  /** Plan: kept against found under 0.7x usual, on 100+ found: a rule or title fault. */
  rateUnder: 0.7,
  rateMinFound: 100,
  /** Plan: judged sales under half of usual on a usual of 100+: conditions getting lost. */
  blindUnder: 0.5,
  blindMinUsual: 100,
  /**
   * Fix round (owner's list): while `kept` is open or firing, `judged` falling with it is one fault,
   * one line. It is a second fault when its ratio to its usual is under this much of `kept`'s.
   */
  blindUnderKept: 0.7,
  /** Plan: nothing compared across sources against a usual of 20+: markets gone missing. */
  comparedMinUsual: 20,
  /** Owner: two sources' medians over 2x apart with 5+ sales each; 30 days like for like (plan). */
  apartDays: 30,
  apartMinSales: 5,
  apartRatio: 2,
  /** Owner: high or low on 10+ items, counted by net direction (plan: both ways is no lean). */
  leansNet: 10,
  /** Plan: `far` and keep rate read the last 28 clean nights. */
  rollingNights: 28,
  /** Plan: `kept` and `judged` read 7 clean nights at least 7 old: a level any nearer follows the fall. */
  weekAgoSkip: 6,
  weekAgoNights: 7,
  /** Plan: 3 nights judged and fine close a finding. */
  closeAfterFine: 3,
  /** Plan: item findings are told in one group at most this often. */
  itemGroupDays: 7,
  /** Plan: an `apart` not judged for this long has lost its sales and can never clear otherwise. */
  apartGoneDays: 30,
} as const;

/** A kept sold row. Prices in the base currency's smallest unit. */
export interface DataCheckSale {
  productId: string;
  bucket: string | null;
  source: string;
  /** Its date in the app's zone. */
  day: string;
  price: number;
  /** Its lot size is a guess, so its price is too. */
  estimated: boolean;
}

export interface DataCheckInput {
  /** Tonight, in the app's zone. */
  day: string;
  /** Kept sold rows of the last `medianDays` days. */
  sales: DataCheckSale[];
  /** Rows stored per source and day, kept or excluded (`packed.n`). */
  found: Record<string, Record<string, number>>;
  /** The sources to check and their market (null: unknown, so never compared). */
  markets: Record<string, string | null>;
  /** Days of the last week each source had a run that worked. */
  runDays: Record<string, string[]>;
  /** The last day a re-check or its undo changed which sales count: `far`'s level starts over. */
  breakDay: string | null;
  state: DataCheckState | null;
}

/** One source's numbers of one night. `odd`: findings open that night, left out of their levels. */
export interface DataCheckSourceNight {
  judged: number;
  far: number;
  kept: number;
  found: number;
  odd?: DataCheckKind[];
}

export interface DataCheckNight {
  sources: Record<string, DataCheckSourceNight>;
  /** Item-conditions with 2+ sources of one market to compare. */
  compared: number;
}

export type DataCheckKind = 'far' | 'kept' | 'rate' | 'blind' | 'apart' | 'leans';

export type DataCheckFinding =
  | {
      kind: 'far';
      source: string;
      /** Percent. */
      share: number;
      usual: number | null;
      judged: number;
      far: number;
      /** Fired by the ceiling alone. */
      ceiling: boolean;
    }
  | { kind: 'kept'; source: string; kept: number; usual: number }
  | { kind: 'rate'; source: string; rate: number; usual: number }
  | { kind: 'blind'; source: string; judged: number; usual: number }
  | { kind: 'blind'; source: null; compared: number; usual: number }
  | {
      kind: 'apart';
      source: string;
      other: string;
      productId: string;
      bucket: string;
      price: number;
      otherPrice: number;
      sales: number;
      otherSales: number;
      /** `price` over `otherPrice`. */
    }
  | { kind: 'leans'; source: string; high: number; low: number };

/** A finding that is open: what it read when last seen, and how far it is from closing. */
export type DataCheckOpen = DataCheckFinding & {
  key: string;
  openedOn: string;
  lastSeenOn: string;
  /** The last night it was judged, either way. */
  judgedOn: string;
  /** Nights judged and fine in a row. */
  fine: number;
  told: boolean;
};

/** The one stored setting. */
export interface DataCheckState {
  days: Record<string, DataCheckNight>;
  open: Record<string, DataCheckOpen>;
  /** A source's day an admin accepted its numbers: its levels start over after it. */
  resets: Record<string, string>;
  lastRun: string | null;
  /** The first day `after-run` looked and found no run yet, to count from. */
  firstSeen: string | null;
  itemsToldOn: string | null;
}

export const emptyDataCheckState = (): DataCheckState => ({
  days: {},
  open: {},
  resets: {},
  lastRun: null,
  firstSeen: null,
  itemsToldOn: null,
});

export interface DataCheckResult {
  night: DataCheckNight;
  /** Everything firing tonight, told or not. */
  findings: DataCheckFinding[];
  state: DataCheckState;
  /** What to say tonight. */
  tell: DataCheckOpen[];
}

const utc = (day: string) => Date.parse(`${day}T00:00:00Z`);
const dayBack = (day: string, n: number) =>
  new Date(utc(day) - n * 86_400_000).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => Math.round((utc(to) - utc(from)) / 86_400_000);

const round = (n: number, digits: number) => Math.round(n * 10 ** digits) / 10 ** digits;

/** One item-condition's two sources, both with enough sales. */
interface ComparedPair {
  finding: Extract<DataCheckFinding, { kind: 'apart' }>;
  apart: boolean;
}

/** One source's prices of one item and condition. */
interface SaleGroup {
  productId: string;
  bucket: string;
  source: string;
  all: number[];
  week: number[];
  month: number[];
}

interface Numbers {
  night: DataCheckNight;
  pairs: ComparedPair[];
  leans: Record<string, { high: number; low: number }>;
}

/** Tonight's numbers from the rows. */
function numbersOf(input: DataCheckInput): Numbers {
  const { day, markets } = input;
  const weekFrom = dayBack(day, DATA_CHECK.weekDays - 1);
  const monthFrom = dayBack(day, DATA_CHECK.apartDays - 1);
  const medianFrom = dayBack(day, DATA_CHECK.medianDays - 1);
  const kept = new Map<string, number>();
  const groups = new Map<string, SaleGroup>();
  for (const s of input.sales) {
    if (!(s.source in markets) || s.day > day || s.day < medianFrom) continue;
    const inWeek = s.day >= weekFrom;
    if (inWeek) kept.set(s.source, (kept.get(s.source) ?? 0) + 1);
    // No condition or a guessed lot size: counted as kept, but its price says nothing.
    if (s.estimated || !s.bucket || !(s.price > 0)) continue;
    const key = `${s.productId}\u0000${s.bucket}\u0000${s.source}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        productId: s.productId,
        bucket: s.bucket,
        source: s.source,
        all: [],
        week: [],
        month: [],
      };
      groups.set(key, g);
    }
    g.all.push(s.price);
    if (inWeek) g.week.push(s.price);
    if (s.day >= monthFrom) g.month.push(s.price);
  }

  const judged = new Map<string, number>();
  const far = new Map<string, number>();
  // Per item-condition and market, the sources with enough sales in the month.
  const byItem = new Map<string, Map<string, SaleGroup[]>>();
  for (const g of groups.values()) {
    if (g.all.length >= DATA_CHECK.medianMinSales && g.week.length) {
      const m = median(g.all)!;
      judged.set(g.source, (judged.get(g.source) ?? 0) + g.week.length);
      const off = g.week.filter(
        (p) => p > DATA_CHECK.farRatio * m || p < m / DATA_CHECK.farRatio,
      ).length;
      far.set(g.source, (far.get(g.source) ?? 0) + off);
    }
    // Never across markets: a price abroad differs for real. Unknown market: not compared.
    const market = markets[g.source];
    if (!market || g.month.length < DATA_CHECK.apartMinSales) continue;
    const item = `${g.productId}\u0000${g.bucket}`;
    const perMarket = byItem.get(item) ?? new Map<string, SaleGroup[]>();
    perMarket.set(market, [...(perMarket.get(market) ?? []), g]);
    byItem.set(item, perMarket);
  }

  const pairs: ComparedPair[] = [];
  const leans: Numbers['leans'] = {};
  let compared = 0;
  for (const perMarket of byItem.values()) {
    for (const list of perMarket.values()) {
      if (list.length < 2) continue;
      compared++;
      const sorted = list.toSorted((a, b) => a.source.localeCompare(b.source));
      const medians = sorted.map((g) => median(g.month)!);
      sorted.forEach((a, i) => {
        for (let j = i + 1; j < sorted.length; j++) {
          const b = sorted[j]!;
          const ratio = medians[i]! / medians[j]!;
          pairs.push({
            apart: ratio > DATA_CHECK.apartRatio || ratio < 1 / DATA_CHECK.apartRatio,
            finding: {
              kind: 'apart',
              source: a.source,
              other: b.source,
              productId: a.productId,
              bucket: a.bucket,
              price: Math.round(medians[i]!),
              otherPrice: Math.round(medians[j]!),
              sales: a.month.length,
              otherSales: b.month.length,
            },
          });
        }
        const others = sorted.flatMap((o, k) => (k === i ? [] : o.month));
        const ratio = medians[i]! / median(others)!;
        const lean = (leans[a.source] ??= { high: 0, low: 0 });
        if (ratio > DATA_CHECK.apartRatio) lean.high++;
        if (ratio < 1 / DATA_CHECK.apartRatio) lean.low++;
      });
    }
  }

  const week = Array.from({ length: DATA_CHECK.weekDays }, (_, i) => dayBack(day, i));
  const sources: Record<string, DataCheckSourceNight> = {};
  for (const source of Object.keys(markets)) {
    const foundWeek = week.reduce((n, d) => n + (input.found[source]?.[d] ?? 0), 0);
    const ran = week.some((d) => input.runDays[source]?.includes(d));
    // No run and no rows: unknown (switched off, say), no entry at all.
    if (!ran && !foundWeek && !kept.get(source)) continue;
    sources[source] = {
      judged: judged.get(source) ?? 0,
      far: far.get(source) ?? 0,
      kept: kept.get(source) ?? 0,
      found: foundWeek,
    };
  }
  return { night: { sources, compared }, pairs, leans };
}

/** A source's past entries, oldest first, after its last reset. */
function entriesOf(
  state: DataCheckState,
  source: string,
): (DataCheckSourceNight & { day: string })[] {
  const reset = state.resets[source] ?? '';
  return Object.keys(state.days)
    .filter((d) => d > reset && state.days[d]!.sources[source])
    .sort()
    .map((d) => ({ ...state.days[d]!.sources[source]!, day: d }));
}

const clean = <T extends { odd?: DataCheckKind[] }>(entries: T[], kind: DataCheckKind) =>
  entries.filter((e) => !e.odd?.includes(kind));

/**
 * The median of the nights at least a week old (nights -13 to -7 when none were odd). While its
 * finding is open, nights from a week before it opened are left out too: a 7-day number was already
 * falling on them, so a lasting fall would slide the level down to it and close itself.
 */
function weekAgoUsual(
  entries: (DataCheckSourceNight & { day: string })[],
  kind: DataCheckKind,
  value: (e: DataCheckSourceNight) => number,
  openedOn: string | undefined,
): number | null {
  const old = entries.slice(0, Math.max(0, entries.length - DATA_CHECK.weekAgoSkip));
  const before = openedOn && dayBack(openedOn, DATA_CHECK.weekAgoSkip);
  const usable = clean(old, kind).filter((e) => !before || e.day < before);
  return median(usable.slice(-DATA_CHECK.weekAgoNights).map(value));
}

const shareOf = (e: { judged: number; far: number }) =>
  e.judged >= DATA_CHECK.farMinJudged ? (100 * e.far) / e.judged : null;
const rateOf = (e: { kept: number; found: number }) =>
  e.found >= DATA_CHECK.rateMinFound ? e.kept / e.found : null;

/**
 * What one source's numbers say tonight: firing, judged and fine, and whether `blind` was held back
 * by `kept`. Every check here waits for the source's own 14 nights, counted after its reset; a `far`
 * break leaves the entries alone, so it restarts the far level only, never the ceiling.
 */
function judgeSource(
  source: string,
  today: DataCheckSourceNight,
  entries: (DataCheckSourceNight & { day: string })[],
  input: {
    breakDay: string | null;
    runDays: number;
    open: Record<string, DataCheckOpen>;
  },
): { firing: DataCheckFinding[]; fine: DataCheckKind[]; blindMuted: boolean } {
  const firing: DataCheckFinding[] = [];
  const fine: DataCheckKind[] = [];
  let blindMuted = false;
  const learned = entries.length >= DATA_CHECK.learnNights;
  const openFar = input.open[`far:${source}`];
  const openKept = input.open[`kept:${source}`];

  const share = shareOf(today);
  if (share !== null && learned) {
    const since = entries.filter((e) => !input.breakDay || e.day > input.breakDay);
    const shares = clean(since, 'far').flatMap((e) => shareOf(e) ?? []);
    const usual =
      shares.length >= DATA_CHECK.learnNights
        ? median(shares.slice(-DATA_CHECK.rollingNights))
        : null;
    // After a break there is no level yet. An open finding keeps the one it fired on: its nights are
    // odd, so none could ever be relearned under it. Opened by the ceiling alone: the ceiling judges.
    const level = usual ?? (openFar?.kind === 'far' ? openFar.usual : null);
    const relative =
      level !== null &&
      share >= DATA_CHECK.farTimesUsual * level &&
      today.far >= DATA_CHECK.farMinFar &&
      share - level >= DATA_CHECK.farMinPoints;
    const ceiling = share >= DATA_CHECK.farCeiling;
    if (relative || ceiling) {
      firing.push({
        kind: 'far',
        source,
        share: round(share, 1),
        usual: level === null ? null : round(level, 1),
        judged: today.judged,
        far: today.far,
        ceiling: ceiling && !relative,
      });
    } else fine.push('far');
  }

  const keptUsual = learned
    ? weekAgoUsual(entries, 'kept', (e) => e.kept, openKept?.openedOn)
    : null;
  if (
    keptUsual !== null &&
    keptUsual >= DATA_CHECK.keptMinUsual &&
    input.runDays >= DATA_CHECK.keptMinRunDays
  ) {
    if (today.kept < DATA_CHECK.keptUnder * keptUsual) {
      firing.push({ kind: 'kept', source, kept: today.kept, usual: Math.round(keptUsual) });
    } else fine.push('kept');
  }

  const rate = rateOf(today);
  const rates = clean(entries, 'rate').flatMap((e) => rateOf(e) ?? []);
  if (rate !== null && rates.length >= DATA_CHECK.learnNights) {
    const usual = median(rates.slice(-DATA_CHECK.rollingNights))!;
    if (rate < DATA_CHECK.rateUnder * usual) {
      firing.push({ kind: 'rate', source, rate: round(rate, 2), usual: round(usual, 2) });
    } else fine.push('rate');
  }

  if (learned) {
    // Held to the earlier of its own and `kept`'s opening, so judged and kept below are measured
    // against the same stretch. Under an open `kept` a fresh level would slide while kept's stays.
    const openedOn = [input.open[`blind:${source}`]?.openedOn, openKept?.openedOn]
      .filter((d) => d !== undefined)
      .sort()[0];
    const usual = weekAgoUsual(entries, 'blind', (e) => e.judged, openedOn);
    if (usual !== null && usual >= DATA_CHECK.blindMinUsual) {
      if (today.judged >= DATA_CHECK.blindUnder * usual) fine.push('blind');
      else {
        const keptToo = !!openKept || firing.some((f) => f.kind === 'kept');
        // Kept's level unknown (never with a finding open, which needed one): one line.
        const harder =
          !!keptUsual &&
          today.judged / usual < DATA_CHECK.blindUnderKept * (today.kept / keptUsual);
        if (keptToo && !harder) blindMuted = true;
        else firing.push({ kind: 'blind', source, judged: today.judged, usual: Math.round(usual) });
      }
    }
  }
  return { firing, fine, blindMuted };
}

const keyOf = (f: DataCheckFinding) =>
  f.source === null
    ? 'blind:compared'
    : f.kind === 'apart'
      ? `apart:${f.productId}:${f.bucket}:${f.source}:${f.other}`
      : `${f.kind}:${f.source}`;

/**
 * One morning's check: tonight's numbers, what fires, what stays open or closes, what to say. It
 * changes nothing it is given. A night already judged is the caller's to skip.
 */
export function judgeDataCheck(input: DataCheckInput): DataCheckResult {
  const state = input.state ?? emptyDataCheckState();
  const { day, breakDay } = input;
  const { night, pairs, leans } = numbersOf(input);
  // `apart` and `compared` need no level of a source, so they wait only for the first nights.
  const pastDays = Object.keys(state.days).sort();
  const started = pastDays.length >= DATA_CHECK.learnNights;

  const firing: DataCheckFinding[] = [];
  const fine = new Set<string>();
  const blindMuted = new Set<string>();
  const week = Array.from({ length: DATA_CHECK.weekDays }, (_, i) => dayBack(day, i));
  for (const [source, today] of Object.entries(night.sources)) {
    const entries = entriesOf(state, source);
    const result = judgeSource(source, today, entries, {
      breakDay,
      runDays: week.filter((d) => input.runDays[source]?.includes(d)).length,
      open: state.open,
    });
    firing.push(...result.firing);
    for (const kind of result.fine) fine.add(`${kind}:${source}`);
    if (result.blindMuted) blindMuted.add(source);
    if (entries.length >= DATA_CHECK.learnNights && leans[source]) {
      const { high, low } = leans[source];
      if (Math.abs(high - low) >= DATA_CHECK.leansNet) {
        firing.push({ kind: 'leans', source, high, low });
      } else fine.add(`leans:${source}`);
    }
  }
  if (started) {
    for (const p of pairs) {
      if (p.apart) firing.push(p.finding);
      else fine.add(keyOf(p.finding));
    }
    const old = pastDays.slice(0, Math.max(0, pastDays.length - DATA_CHECK.weekAgoSkip));
    const usual = median(old.slice(-DATA_CHECK.weekAgoNights).map((d) => state.days[d]!.compared));
    if (usual !== null) {
      if (night.compared > 0) fine.add('blind:compared');
      else if (usual >= DATA_CHECK.comparedMinUsual) {
        firing.push({ kind: 'blind', source: null, compared: 0, usual: Math.round(usual) });
      }
    }
  }

  // What is open now. Only a night judged and fine counts toward closing, so a server that was off
  // or a source gone thin never closes a finding. Closed then back says it again.
  const open: Record<string, DataCheckOpen> = {};
  const firingKeys = new Set<string>();
  for (const [key, o] of Object.entries(state.open)) open[key] = { ...o };
  for (const f of firing) {
    const key = keyOf(f);
    firingKeys.add(key);
    const was = open[key];
    open[key] = {
      ...f,
      key,
      openedOn: was?.openedOn ?? day,
      lastSeenOn: day,
      judgedOn: day,
      fine: 0,
      told: was?.told ?? false,
    };
  }
  for (const [key, o] of Object.entries(open)) {
    if (firingKeys.has(key)) continue;
    if (fine.has(key)) {
      o.judgedOn = day;
      o.fine++;
      if (o.fine >= DATA_CHECK.closeAfterFine) delete open[key];
    } else if (o.kind === 'apart' && daysBetween(o.judgedOn, day) >= DATA_CHECK.apartGoneDays) {
      delete open[key];
    }
  }

  // Source findings the morning they open; items in one group, so a day missed cannot lose them.
  const itemsDue =
    !state.itemsToldOn || daysBetween(state.itemsToldOn, day) >= DATA_CHECK.itemGroupDays;
  const told: DataCheckOpen[] = [];
  for (const [key, o] of Object.entries(open)) {
    if (o.told || !firingKeys.has(key) || (o.kind === 'apart' && !itemsDue)) continue;
    o.told = true;
    told.push(o);
  }
  // Source lines first: the message stops at 10 lines, and waiting items must not push them past it.
  const tell = told.toSorted((a, b) => Number(a.kind === 'apart') - Number(b.kind === 'apart'));

  // Nights under an open finding stay out of that number's level, so a bad stretch that fired does
  // not become the usual. A `blind` held back by `kept` too: its low nights are no level to judge by.
  const stored: DataCheckNight = { compared: night.compared, sources: {} };
  for (const [source, today] of Object.entries(night.sources)) {
    const odd = (['far', 'kept', 'rate', 'blind'] as const).filter(
      (k) => open[`${k}:${source}`] || (k === 'blind' && blindMuted.has(source)),
    );
    stored.sources[source] = odd.length ? { ...today, odd } : today;
  }

  return {
    night: stored,
    findings: firing,
    tell,
    state: {
      ...state,
      days: { ...state.days, [day]: stored },
      open,
      lastRun: day,
      itemsToldOn: tell.some((o) => o.kind === 'apart') ? day : state.itemsToldOn,
    },
  };
}

/** An admin accepts a source's numbers as they are: its levels start over, its findings close. */
export function resetDataCheckSource(
  state: DataCheckState,
  source: string,
  day: string,
): DataCheckState {
  const open = Object.fromEntries(
    Object.entries(state.open).filter(([, o]) => o.kind === 'apart' || o.source !== source),
  );
  return { ...state, open, resets: { ...state.resets, [source]: day } };
}

/**
 * The state, or nothing of it when these sources appear in it: one marked noAi after its numbers were
 * stored. Stripping its name would not do, since `leans` pooled against it and each night's `compared`
 * were shaped by it and would still pass for clean. The check starts over without it.
 */
export function dataCheckWithout(state: DataCheckState, sources: string[]): DataCheckState {
  const hidden = new Set(sources);
  const appears =
    Object.keys(state.resets).some((s) => hidden.has(s)) ||
    Object.values(state.days).some((n) => Object.keys(n.sources).some((s) => hidden.has(s))) ||
    Object.values(state.open).some(
      (o) => (o.source && hidden.has(o.source)) || (o.kind === 'apart' && hidden.has(o.other)),
    );
  if (!appears) return state;
  const { lastRun, firstSeen, itemsToldOn } = state;
  return { ...emptyDataCheckState(), lastRun, firstSeen, itemsToldOn };
}

/** What the page and the data tool say about a source: is anything watching it? */
export type DataCheckStatus =
  | { status: 'watching' }
  | { status: 'learning'; nights: number }
  | { status: 'tooFew' }
  | { status: 'notSeen'; lastSeen: string };

export function dataCheckStatus(state: DataCheckState | null, source: string): DataCheckStatus {
  const entries = state ? entriesOf(state, source) : [];
  const last = entries.at(-1);
  // It has numbers, but none from the last morning: it stopped, so nothing is watching it now. A night
  // has numbers while its 7 days hold a run or a row, so its last activity was that long before.
  if (last && last.day !== state?.lastRun) {
    return { status: 'notSeen', lastSeen: dayBack(last.day, DATA_CHECK.weekDays - 1) };
  }
  if (!last || entries.length < DATA_CHECK.learnNights) {
    return { status: 'learning', nights: entries.length };
  }
  return shareOf(last) !== null ? { status: 'watching' } : { status: 'tooFew' };
}

/** A finding with what a person calls its parts. */
export type DataCheckDescribed = DataCheckOpen & {
  label: string | null;
  otherLabel?: string;
  name?: string;
};

const thousands = (n: number) => n.toLocaleString('en-US');

/**
 * A finding as one line: the text's key in `alertText` and its values, for the message, the Activity
 * page and the Settings section alike.
 */
export function dataCheckLine(
  f: DataCheckDescribed,
  money: (minor: number) => string,
  condition: (bucket: string) => string,
): { key: string; params: Record<string, string | number> } {
  const source = f.label ?? f.source ?? '';
  switch (f.kind) {
    case 'far':
      return f.usual === null || f.ceiling
        ? { key: 'dataCheckFarCeiling', params: { source, share: f.share } }
        : { key: 'dataCheckFar', params: { source, share: f.share, usual: f.usual } };
    case 'kept':
      return {
        key: 'dataCheckKept',
        params: { source, kept: thousands(f.kept), usual: thousands(f.usual) },
      };
    case 'rate':
      return {
        key: 'dataCheckRate',
        params: { source, rate: Math.round(f.rate * 100), usual: Math.round(f.usual * 100) },
      };
    case 'blind':
      return f.source === null
        ? { key: 'dataCheckBlindCompared', params: { usual: f.usual } }
        : {
            key: 'dataCheckBlind',
            params: { source, judged: thousands(f.judged), usual: thousands(f.usual) },
          };
    case 'leans':
      return { key: 'dataCheckLeans', params: { source, high: f.high, low: f.low } };
    case 'apart':
      return {
        key: 'dataCheckApart',
        params: {
          name: f.name ?? f.productId,
          condition: condition(f.bucket),
          source,
          price: money(f.price),
          other: f.otherLabel ?? f.other,
          otherPrice: money(f.otherPrice),
          times: round(Math.max(f.price, f.otherPrice) / Math.min(f.price, f.otherPrice), 1),
        },
      };
  }
}
