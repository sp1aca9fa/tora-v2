// Store notices (requirements S25): physical stores, the area a person watches, and which stores a
// post (a sighting of cards on sale) is about.

/** A physical store, as a store directory plug-in or the admin describes it. */
export interface StoreEntry {
  /** The chain's key ("yodobashi"); posts of a chain's board are matched to its stores. */
  chain: string;
  /** The chain as people read it ("ヨドバシカメラ"). */
  chainLabel?: string | null;
  name: string;
  /** What posters write for it: codes, short names ("梅田", "AKIBA"). */
  codes: string[];
  /** Prefecture or region, for picking stores by hand. */
  region?: string | null;
  lat?: number | null;
  lon?: number | null;
}

/** A point on the map (rounded when kept: about 100 m). */
export interface GeoPoint {
  lat: number;
  lon: number;
}

/** One way of saying where the person is: stores picked by hand, or a point and a distance. */
export type StoreAreaChoice =
  { mode: 'stores'; storeIds: string[] } | { mode: 'distance'; point: GeoPoint; km: number };

/** The stores a person watches (S25), and while travelling another area until a date. */
export interface StoreArea {
  home: StoreAreaChoice;
  travel?: StoreAreaChoice & { until: string };
  /** Stores never notified, whatever the area. */
  muted?: string[];
  /** Stores always notified, outside the area too (added by hand to a distance). */
  added?: string[];
}

export const STORE_NOTICE_KM = [1, 2, 5, 10, 20, 30, 50];

/** Kept points are rounded to about 100 m: enough for distances, not an address. */
export const roundPoint = (p: GeoPoint): GeoPoint => ({
  lat: Math.round(p.lat * 1000) / 1000,
  lon: Math.round(p.lon * 1000) / 1000,
});

/** Distance between two points in km (great circle). */
export function distanceKm(a: GeoPoint, b: GeoPoint): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** The area in effect on a day: the travel one until its date (inclusive), else home. */
export function activeArea(area: StoreArea, today: string): StoreAreaChoice {
  return area.travel && today <= area.travel.until ? area.travel : area.home;
}

/** The stores in an area (by id): the area's and the ones added by hand, muted ones left out. */
export function storesInArea(
  area: StoreArea | null | undefined,
  stores: (Pick<StoreEntry, 'lat' | 'lon'> & { id: string })[],
  today: string,
): Set<string> {
  if (!area) return new Set();
  const choice = activeArea(area, today);
  const muted = new Set(area.muted ?? []);
  const ids =
    choice.mode === 'stores'
      ? choice.storeIds
      : stores
          .filter(
            (s) =>
              s.lat != null &&
              s.lon != null &&
              distanceKm(choice.point, { lat: s.lat, lon: s.lon }) <= choice.km,
          )
          .map((s) => s.id);
  return new Set([...ids, ...(area.added ?? [])].filter((id) => !muted.has(id)));
}

/** Width, case and emoji variation marks aside (an emoji with or without U+FE0F alike). */
const norm = (s: string) =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\uFE0E\uFE0F]/g, '');
const ascii = /^[\x20-\x7e]+$/;

/** Whether a code is in a post: Latin codes as whole words ("AKB" not in "AKBX"), others anywhere. */
function mentions(text: string, code: string): boolean {
  const c = norm(code).trim();
  if (!c) return false;
  if (!ascii.test(c)) return text.includes(c);
  const escaped = c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`).test(text);
}

/**
 * The chain of places: an area's name or code with its location ("池袋", "⭐"), matched on every
 * board. Posters often name the area, not the store (one emoji per area, whatever the chain), and
 * some boards mix dozens of chains no store list covers.
 */
export const PLACE = 'place';

/**
 * The stores a post is about: those of its board's chain whose name or a code it mentions; when
 * none (or the board mixes chains), the places it names. A code inside a longer code that also
 * matched counts once ("新宿西口" wins over "新宿").
 */
export function storesInPost<T extends Pick<StoreEntry, 'chain' | 'name' | 'codes'>>(
  text: string,
  stores: T[],
  chain?: string | null,
): T[] {
  const t = norm(text);
  const find = (list: T[]) => {
    const hits = list.flatMap((s) => {
      const found = [s.name, ...s.codes].filter((c) => mentions(t, c)).map(norm);
      return found.length ? [{ s, longest: found.sort((a, b) => b.length - a.length)[0]! }] : [];
    });
    return hits
      .filter(
        (h) =>
          !hits.some(
            (o) => o !== h && o.longest.length > h.longest.length && o.longest.includes(h.longest),
          ),
      )
      .map((h) => h.s);
  };
  // A chain's codes are its board's own (the same emoji means an area on other boards): a board
  // mixing chains is matched to places only.
  const own = chain ? find(stores.filter((s) => s.chain === chain)) : [];
  return own.length ? own : find(stores.filter((s) => s.chain === PLACE));
}

/** What a person is told about their store feed (S25): no silent failures. */
export interface StoreFeedPrefs {
  /** Minutes without a word from the feed before it counts as stopped. */
  silentMinutes?: number;
  /** The hours the feed is meant to run ("08:00"-"23:00"); silence outside them is not told. */
  from?: string;
  to?: string;
  /** Posts about a store Tora does not recognise (on unless switched off). */
  unknown?: boolean;
}

export const FEED_SILENT_MINUTES = [5, 10, 15, 30, 60];
export const DEFAULT_FEED_PREFS = { silentMinutes: 10, from: '08:00', to: '23:00', unknown: true };

/** Whether a local time ("21:30") is within hours that may pass midnight ("22:00"-"02:00"). */
export function withinHours(time: string, from: string, to: string): boolean {
  return from <= to ? time >= from && time < to : time >= from || time < to;
}

/** A code posters use that is no store or place: a state, a chain's mark, a product. */
export interface CodeMeaning {
  code: string;
  meaning: string;
}

/**
 * The codes of the stores and places, each with what it stands for: the ones that are not just
 * the name or part of it ("UMD" for "マルチメディア梅田", not "梅田"), most used first.
 */
export function codeIndex<T extends Pick<StoreEntry, 'name' | 'codes'>>(
  stores: T[],
): { code: string; stores: T[] }[] {
  const by = new Map<string, T[]>();
  for (const s of stores) {
    const name = norm(s.name);
    for (const code of s.codes) {
      if (!code.trim() || name.includes(norm(code))) continue;
      by.set(code, [...(by.get(code) ?? []), s]);
    }
  }
  return [...by]
    .map(([code, list]) => ({ code, stores: list }))
    .sort((a, b) => b.stores.length - a.stores.length || a.code.localeCompare(b.code));
}
