// A game wish's buy alert, one read night at a time (requirements S36 C3; plan W16 sections 2 and
// 9). Pure: the copies come from `wishCopies` (packages/db), the state is stored in the watch's
// `alert_state.wish`. Counts are in read nights (Terms "Night": a night no checked source read is
// skipped in every count). Percent tests are on whole minor units, never floats.
import type { Paid } from './wish-level';

/** "Unless it was last in under 14 nights ago" and the reference's age (S36 C3, "to start"). */
export const WISH_QUIET_NIGHTS = 14;
/** "A copy 3 % or more below the reference alerts again" (S36 C3, "to start"). */
export const WISH_AGAIN_SHARE = 0.03;
/** `cost * 100 <= reference * 97`: the 3 % test in integers. */
const AGAIN = 100 - Math.round(WISH_AGAIN_SHARE * 100);

/** One checked copy in the wish's condition or a better one, as the alert step reads it. */
export interface WishNightCopy {
  /** `source|ref`: the listing. A shop entry's ref is a fixed slot: its key adds its run. */
  slot: string;
  source: string;
  title: string;
  url: string | null;
  seller: string | null;
  /** The stored price, in the base currency's minor unit. */
  price: number;
  paid: Paid;
  /** Dated N: an alert may name it. False: kept from its source's last read before N (in/out only). */
  tonight: boolean;
  /** The identity shop's entry (S36 A6): the key adds the first night of its in-stock run. */
  run: boolean;
  /** The shop's own copy (else an outside seller's entry, or a marketplace listing). */
  own: boolean;
}

export interface WishReference {
  cost: number;
  /** The alerted copy's key; null: a fixed price, taken from another copy (moves only at an alert). */
  key: string | null;
  /** The read night (`reads`) it was set on. */
  at: number;
}

/** Stored as the watch's `alert_state.wish`. */
export interface WishAlertState {
  /** The last read night counted (YYYY-MM-DD); null: none yet. */
  night: string | null;
  /** Read nights counted (N of the last one). */
  reads: number;
  in: boolean;
  /**
   * In on kept copies only, from out (stored only when true): no alert may name a kept copy, so the
   * next night reads it as out and `lastIn` does not move (fix round 1, item 2).
   */
  keptIn?: boolean;
  /** `reads` of the last read night it was in; null: not since the start (or the last save). */
  lastIn: number | null;
  /** As of the read night before `night`: a rerun of the same night steps from these. */
  was: { in: boolean; lastIn: number | null; reference: WishReference | null };
  /** The read night of the last alert: a rerun that night only takes the 3 % test (plan 9.B). */
  sent: number | null;
  reference: WishReference | null;
  /** Copy key -> the cost it was alerted at (S36 C3 "A copy is alerted once"). */
  alerted: Record<string, number>;
  /** Shop slot -> the first night of its current in-stock run (plan 9.C). */
  runs: Record<string, string>;
  /**
   * Shop slot of an outside entry with no seller named -> `reads` of its last alert (stored only
   * when it holds one): that price is news again 14 read nights later (see `stepWish`).
   */
  told?: Record<string, number>;
}

export interface WishNightInput {
  /** N, the day of the last collect run. */
  night: string;
  /** The checked sources read on N. None: not a read night (nothing changes). */
  read: readonly string[];
  /** The person's price; null, not finite or not positive: no price, nothing changes. */
  price: number | null;
  /** Tonight's and the kept copies. */
  copies: readonly WishNightCopy[];
  /**
   * Every shop slot its sources read on N stored, in any condition, marked or not (`wishCopies`):
   * a run ends only on a read night its slot is not among them.
   */
  shopSeen: readonly string[];
  /** The wish reads check needed: the night counts, nothing is in (plan 9.I). */
  checkNeeded: boolean;
}

export type WishKeyedCopy = WishNightCopy & { key: string; cost: number };

export interface WishAlert {
  copy: WishKeyedCopy;
  /** The cost is the stored price: what the buyer pays on top is not known. */
  plusShipping: boolean;
  /** Up to 3 of tonight's copies, cheapest first, from sellers not listed before. */
  sellers: WishKeyedCopy[];
  /** Every listed seller is known (plan Q11: unknown sellers are never claimed different). */
  distinct: boolean;
  /** No other copy of tonight at or under the price. */
  only: boolean;
  /** Tonight's cheapest copy above the price; null: none. */
  nextUp: WishKeyedCopy | null;
}

/** C3: an unknown added cost counts on the stored price. */
export const wishCost = (c: Pick<WishNightCopy, 'price' | 'paid'>) =>
  c.paid.known ? c.paid.amount : c.price;

const FRESH: WishAlertState = {
  night: null,
  reads: 0,
  in: false,
  lastIn: null,
  was: { in: false, lastIn: null, reference: null },
  sent: null,
  reference: null,
  alerted: {},
  runs: {},
};

const positive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
const sourceOf = (key: string) => key.split('|')[0]!;
const byCost = (a: WishKeyedCopy, b: WishKeyedCopy) =>
  a.cost - b.cost || Number(b.paid.known) - Number(a.paid.known) || (a.key < b.key ? -1 : 1);

/**
 * One step: null when nothing changes (no price, no checked source read, or an older night than
 * the stored one). Otherwise the new state and the alert, if one goes (plan section 2's table with
 * section 9's changes).
 */
export function stepWish(
  prev: WishAlertState | null,
  input: WishNightInput,
): { state: WishAlertState; alert: WishAlert | null } | null {
  const s = prev ?? FRESH;
  const price = input.price;
  if (!positive(price) || !input.read.length) return null;
  if (s.night !== null && input.night < s.night) return null;
  const fresh = s.night !== input.night;
  const n = fresh ? s.reads + 1 : s.reads;
  const was = fresh ? { in: s.in && !s.keptIn, lastIn: s.lastIn, reference: s.reference } : s.was;
  const sentTonight = !fresh && s.sent === n;
  const wasIn = sentTonight || was.in;
  const ref = sentTonight ? s.reference : was.reference;
  const read = new Set(input.read);
  const valid = input.copies.filter(
    (c) => positive(c.price) && (!c.paid.known || positive(c.paid.amount)),
  );

  // A shop entry's run starts the first read night it is there and ends a read night its source
  // stored it in no condition (fix round 1, item 3: a condition saved away and back, or a mark
  // taken back, keeps the run, so the copy is not new).
  const seen = new Set([
    ...input.shopSeen,
    ...valid.filter((c) => c.tonight && c.run).map((c) => c.slot),
  ]);
  // An unnamed outside entry told less than 14 read nights ago keeps its run through nights it is
  // not stored: the shop stores one outside entry per item (the cheapest, new or used), so the
  // slot comes and goes with other sellers' offers while the copy told is still there.
  const recent = (slot: string) => {
    const at = s.told?.[slot];
    return at !== undefined && n - at < WISH_QUIET_NIGHTS;
  };
  const runs = { ...s.runs };
  for (const slot of Object.keys(runs))
    if (read.has(sourceOf(slot)) && !seen.has(slot) && !recent(slot)) delete runs[slot];
  for (const c of valid) if (c.tonight && c.run && !(c.slot in runs)) runs[c.slot] = input.night;
  // An outside entry the shop does not name the seller of is the cheapest outside seller's price
  // only: which seller it is cannot be told, so nothing is read from how its price moves. It is
  // one copy for its run, like the shop's own; 14 read nights after its last alert its run starts
  // anew, so what is listed then counts as a copy not yet alerted (the wish's own rules, out to in
  // and 3 % under the reference, still decide whether it is told).
  const unnamed = (c: WishNightCopy) => c.run && !c.own && c.seller === null;
  const told = { ...s.told };
  for (const slot of Object.keys(told)) if (!(slot in runs)) delete told[slot];
  for (const c of valid) {
    const at = c.tonight && unnamed(c) ? told[c.slot] : undefined;
    if (at !== undefined && n - at >= WISH_QUIET_NIGHTS) {
      runs[c.slot] = input.night;
      delete told[c.slot];
    }
  }
  const runKey = (c: WishNightCopy) => `${c.slot}|${runs[c.slot] ?? input.night}`;
  const keyOf = (c: WishNightCopy) => {
    if (!c.run) return c.slot;
    return c.own || c.seller === null ? runKey(c) : `${runKey(c)}|${c.seller}`;
  };
  const all = valid.map((c): WishKeyedCopy => ({ ...c, key: keyOf(c), cost: wishCost(c) }));
  const tonight = all.filter((c) => c.tonight).toSorted(byCost);

  const isIn = !input.checkNeeded && all.some((c) => c.cost <= price);
  // Kept copies hold a wish in (a source not read is no way out), but cannot turn it in: from out,
  // the night the copy is read is the out-to-in one.
  const keptIn = isIn && !wasIn && !tonight.some((x) => x.cost <= price);
  const quiet = was.lastIn !== null && n - was.lastIn < WISH_QUIET_NIGHTS;
  const blocked = (c: WishKeyedCopy) =>
    c.key in s.alerted && c.cost * 100 > s.alerted[c.key]! * AGAIN;
  const c = input.checkNeeded ? undefined : tonight.find((x) => x.cost <= price && !blocked(x));
  const fire = !!c && (ref === null || (!wasIn && !quiet) || c.cost * 100 <= ref.cost * AGAIN);

  let reference = ref;
  let alerted = s.alerted;
  let alert: WishAlert | null = null;
  if (fire) {
    alerted = { ...s.alerted, [c.key]: c.cost };
    if (unnamed(c)) told[c.slot] = n;
    reference = { cost: c.cost, key: c.key, at: n };
    alert = alertOf(c, tonight, price);
  } else if (!input.checkNeeded && ref?.key) {
    // The reference moves when its copy is gone (its source read tonight, the copy not there) or
    // 14 read nights after its alert: to the cheapest other copy of tonight, at any price; with
    // none, it stays (C3 "with no other checked listing that night"). A fixed one stays.
    const gone = read.has(sourceOf(ref.key)) && !tonight.some((x) => x.key === ref.key);
    const other = tonight.find((x) => x.key !== ref.key);
    if ((gone || n - ref.at >= WISH_QUIET_NIGHTS) && other)
      reference = { cost: other.cost, key: null, at: n };
  }
  return {
    state: {
      night: input.night,
      reads: n,
      in: isIn,
      ...(keptIn ? { keptIn: true } : {}),
      lastIn: isIn && !keptIn ? n : was.lastIn,
      was,
      sent: fire ? n : s.sent,
      reference,
      alerted,
      runs,
      ...(Object.keys(told).length ? { told } : {}),
    },
    alert,
  };
}

function alertOf(c: WishKeyedCopy, tonight: WishKeyedCopy[], price: number): WishAlert {
  const sellers: WishKeyedCopy[] = [];
  const seen = new Set<string>();
  let distinct = true;
  for (const x of tonight) {
    if (sellers.length === 3) break;
    const who = x.own ? `${x.source}|own` : x.seller ? `${x.source}|${x.seller}` : null;
    if (who !== null && seen.has(who)) continue;
    if (who === null) distinct = false;
    else seen.add(who);
    sellers.push(x);
  }
  const others = tonight.filter((x) => x.key !== c.key);
  return {
    copy: c,
    plusShipping: !c.paid.known,
    sellers,
    distinct,
    only: !others.some((x) => x.cost <= price),
    nextUp: others.find((x) => x.cost > price) ?? null,
  };
}

/**
 * The person saved a price or condition (S36 C3 "the first night with a copy not yet alerted at or
 * under the new price alerts"): in and out start over, the reference is gone; what was alerted and
 * the shop's runs stay, and so do the read nights counted.
 */
export function restartWish(state: WishAlertState): WishAlertState {
  const { keptIn: _, ...rest } = state;
  return {
    ...rest,
    in: false,
    lastIn: null,
    was: { in: false, lastIn: null, reference: null },
    sent: null,
    reference: null,
  };
}

/**
 * An alert delivered whose state lost to a save: the save stands, the sent copy is remembered, and
 * with it the run the step started for a shop entry (`stepped`: the step's state).
 */
export function mergeDelivered(
  state: WishAlertState | null,
  alert: WishAlert,
  stepped?: WishAlertState,
): WishAlertState {
  const s = state ?? FRESH;
  // A shop entry's key holds its run's first night: the run the step had for it goes with it (the
  // saved state is the one before the step, its run the same or an older one), or the next night
  // would start another run and alert the same copy under a new key.
  const slot = alert.copy.slot;
  const run = alert.copy.run ? stepped?.runs[slot] : undefined;
  const at = alert.copy.run ? stepped?.told?.[slot] : undefined;
  return {
    ...s,
    alerted: { ...s.alerted, [alert.copy.key]: alert.copy.cost },
    ...(run !== undefined ? { runs: { ...s.runs, [slot]: run } } : {}),
    ...(at !== undefined ? { told: { ...s.told, [slot]: at } } : {}),
  };
}

/**
 * Two items merged into one (fix round 1, item 7): the dropped wish's memory of what was sent joins
 * the kept wish's (none: a fresh one), so a copy alerted on either is not alerted again. A copy
 * alerted on both keeps the lower cost (the 3 % test reads from it); a shop slot tracked by both
 * keeps the run a sent copy is keyed by, else the kept wish's.
 */
export function mergeWishMemory(
  kept: WishAlertState | null,
  dropped: WishAlertState,
): WishAlertState {
  const s = kept ?? FRESH;
  const alerted = { ...s.alerted };
  for (const [key, cost] of Object.entries(dropped.alerted))
    alerted[key] = key in alerted ? Math.min(alerted[key]!, cost) : cost;
  const keyedBy = (slot: string, day: string) =>
    Object.keys(alerted).some((k) => k === `${slot}|${day}` || k.startsWith(`${slot}|${day}|`));
  const runs = { ...s.runs };
  for (const [slot, day] of Object.entries(dropped.runs))
    if (!(slot in runs) || (keyedBy(slot, day) && !keyedBy(slot, runs[slot]!))) runs[slot] = day;
  // An unnamed outside entry told on the dropped wish only counts as told on the kept wish's last
  // read night (the two count their nights apart): 14 of them pass before it is news again.
  const told = { ...s.told };
  for (const slot of Object.keys(dropped.told ?? {})) if (!(slot in told)) told[slot] = s.reads;
  return { ...s, alerted, runs, ...(Object.keys(told).length ? { told } : {}) };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const count = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const countOrNull = (v: unknown) => v === null || count(v);
const isRef = (v: unknown) =>
  v === null ||
  (isRecord(v) && positive(v.cost) && (v.key === null || typeof v.key === 'string') && count(v.at));
const allOf = (v: unknown, test: (x: unknown) => boolean) =>
  isRecord(v) && Object.values(v).every(test);

/**
 * A stored state read back: null when there is none; `invalid` when it is not one (skipped and
 * counted, never reset to empty, which could alert a copy twice).
 */
export function parseWishState(raw: unknown): WishAlertState | null | 'invalid' {
  if (raw === undefined || raw === null) return null;
  if (!isRecord(raw) || !isRecord(raw.was)) return 'invalid';
  const ok =
    (raw.night === null || typeof raw.night === 'string') &&
    count(raw.reads) &&
    typeof raw.in === 'boolean' &&
    (raw.keptIn === undefined || typeof raw.keptIn === 'boolean') &&
    countOrNull(raw.lastIn) &&
    typeof raw.was.in === 'boolean' &&
    countOrNull(raw.was.lastIn) &&
    isRef(raw.was.reference) &&
    countOrNull(raw.sent) &&
    isRef(raw.reference) &&
    allOf(raw.alerted, positive) &&
    allOf(raw.runs, (d) => typeof d === 'string') &&
    (raw.told === undefined || allOf(raw.told, count));
  return ok ? (raw as unknown as WishAlertState) : 'invalid';
}
