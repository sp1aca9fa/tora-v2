// Store notices (requirements S25): physical stores, the area a person watches, and which stores a
// post (a sighting of cards on sale) is about.

/** A physical store, as a store directory plug-in or the admin describes it. */
export interface StoreEntry {
  /** The chain's key ("megastore"); posts of a chain's board are matched to its stores. */
  chain: string;
  /** The chain as people read it ("メガストア"). */
  chainLabel?: string | null;
  name: string;
  /** The language its name is written in ("ja"), when the list says. */
  language?: string | null;
  /**
   * Short labels for people reading another language, by language ({ en: "Megastore Ekimae" };
   * a place: { en: "Ekimae" }); without one, the chain and name as written.
   */
  labels?: Record<string, string> | null;
  /** What posters write for it: codes, short names ("中央", "KITA"). */
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

/** Whether a code is in a post: Latin codes as whole words ("KTA" not in "KTAX"), others anywhere. */
function mentions(text: string, code: string): boolean {
  const c = norm(code).trim();
  if (!c) return false;
  if (!ascii.test(c)) return text.includes(c);
  const escaped = c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`).test(text);
}

/**
 * A store's label for a person reading `locale`, or null for its chain and name as written: the
 * label in that language, else (the name being in another language) the English one.
 */
export function storeLabelIn(
  store: Pick<StoreEntry, 'language' | 'labels'>,
  locale: string,
): string | null {
  if (store.language === locale) return null;
  return store.labels?.[locale] ?? (store.language ? (store.labels?.en ?? null) : null);
}

/**
 * The chain of places: an area's name or code with its location ("駅前", "◆"), matched on every
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
  /**
   * The boards the feed should watch, chosen in the app (the feed follows at its next push);
   * unset, the feed's own choice stands.
   */
  boards?: string[];
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
  /** A product ("X1": Expansion X1), named in notices next to the store. */
  product?: boolean;
}

/**
 * The codes of the stores and places, each with what it stands for: the ones that are not just
 * the name or part of it ("MID" for "メガストア中央", not "中央"), most used first.
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

/** How far a store may be from a place to count as in it (the area "Ekimae" holds its stores). */
export const LOCATION_KM = 1.5;

/**
 * Each store's location, by id: the nearest place within `km`, else the store itself (a place
 * is its own; so is a store without a point).
 */
export function locationsOf(
  stores: (Pick<StoreEntry, 'chain' | 'lat' | 'lon'> & { id: string })[],
  km = LOCATION_KM,
): Map<string, string> {
  const places = stores.filter((s) => s.chain === PLACE && s.lat != null && s.lon != null);
  const out = new Map<string, string>();
  for (const s of stores) {
    let best: { id: string; d: number } | null = null;
    if (s.chain !== PLACE && s.lat != null && s.lon != null) {
      for (const p of places) {
        const d = distanceKm({ lat: s.lat, lon: s.lon }, { lat: p.lat!, lon: p.lon! });
        if (d <= km && (!best || d < best.d)) best = { id: p.id, d };
      }
    }
    out.set(s.id, best?.id ?? s.id);
  }
  return out;
}

/**
 * The codes a post uses, spelled out, in the order written: stores' and places' codes (not the
 * ones that are just their name) and other codes ("🍐": none). A code inside a longer one found
 * counts once ("🦏🥚" over "🥚").
 */
export function codesInPost(text: string, codes: CodeMeaning[]): CodeMeaning[] {
  const t = norm(text);
  const found = codes.filter((c) => mentions(t, c.code));
  const kept = found.filter(
    (c) =>
      !found.some(
        (o) =>
          o !== c &&
          norm(o.code).length > norm(c.code).length &&
          norm(o.code).includes(norm(c.code)),
      ),
  );
  const seen = new Set<string>();
  return kept
    .map((c) => ({ c, at: t.indexOf(norm(c.code).trim()) }))
    .sort((a, b) => a.at - b.at)
    .map((x) => x.c)
    .filter((c) => !seen.has(`${c.code}|${c.meaning}`) && seen.add(`${c.code}|${c.meaning}`));
}

/** Width and emoji variation marks aside, case kept (product codes "b" and "B" differ). */
const plain = (s: string) => s.normalize('NFKC').replace(/[︎️]/g, '');
/** What separates the runs of a post (spaces, brackets, punctuation; not the long vowel mark). */
const RUN_BREAK = /[\s()[\]{}「」『』【】〈〉《》・、。,.!?:;/~〜|'"`+=*#@&%$^<>-]+/;
/** Words around codes in posts: they neither name a product nor make a run unreadable. */
const FILLERS = [
  'あり',
  'なし',
  '有り',
  '無し',
  '有',
  '無',
  '在庫',
  '販売',
  '抽選',
  '整理券',
  '完売',
  '終了',
  '入荷',
  '開始',
  '品切れ',
  '少量',
  '多数',
  '再販',
  '予定',
  '本日',
  '今日',
  '明日',
  '列',
  '並び',
  'box',
  'BOX',
  'パック',
  '個',
  '箱',
  '人',
  '枚',
  '種',
  'の',
  'と',
  'も',
  'は',
  'が',
  'で',
  'に',
];
const isAlnum = (c: string | undefined) => !!c && /[A-Za-z0-9]/.test(c);

/**
 * The products a post names by their codes, in the order found. A post is read in runs (between
 * spaces and punctuation). Codes count anywhere (Latin ones as whole words) when an admin added
 * them (`byHand`), when they are emoji or symbols, or when three characters or longer. A feed's
 * shorter ones ("X", "b") count only in a run made entirely of codes, numbers ("(1)", "5P",
 * "16:00"), other known codes (`others`: stores, emoji states) and common words, so a one-letter
 * code inside an ordinary word is not taken for a product. An admin's code wins over a feed's.
 */
export function productsInPost(
  text: string,
  products: (CodeMeaning & { byHand?: boolean })[],
  others: string[] = [],
): CodeMeaning[] {
  const codes = products
    .filter((p) => p.product)
    .map((p) => {
      const key = plain(p.code).trim();
      return { entry: p, key, strong: !!p.byHand || key.length >= 3 || !/[\p{L}\p{N}]/u.test(key) };
    })
    .filter((c) => c.key)
    .sort((a, b) => Number(!!b.entry.byHand) - Number(!!a.entry.byHand));
  const fillers = [...others.map((o) => plain(o).trim()), ...FILLERS].filter(Boolean);
  const found: CodeMeaning[] = [];
  for (const run of plain(text).split(RUN_BREAK).filter(Boolean)) {
    const hits: { entry: CodeMeaning; key: string; strong: boolean }[] = [];
    let covered = true;
    let i = 0;
    // A word starting and ending here, not inside a longer Latin word or number.
    const fits = (key: string) =>
      run.startsWith(key, i) &&
      !(isAlnum(key[0]) && isAlnum(run[i - 1])) &&
      !(isAlnum(key.at(-1)) && isAlnum(run[i + key.length]));
    while (i < run.length) {
      const code = codes.filter((c) => fits(c.key)).sort((a, b) => b.key.length - a.key.length)[0];
      const filler = fillers.filter(fits).sort((a, b) => b.length - a.length)[0];
      const number = run.slice(i).match(/^\d+[A-Za-z]?/)?.[0];
      if (code && code.key.length >= (filler?.length ?? 0)) {
        hits.push(code);
        i += code.key.length;
      } else if (filler) i += filler.length;
      else if (number && !isAlnum(run[i - 1])) i += number.length;
      else {
        covered = false;
        i++;
      }
    }
    for (const h of hits) {
      if ((covered || h.strong) && !found.some((f) => f.meaning === h.entry.meaning))
        found.push(h.entry);
    }
  }
  return found;
}
