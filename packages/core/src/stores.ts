// Store notices (requirements S25): physical stores, the area a person watches, and which stores a
// post (a sighting of cards on sale) is about.
import { toLocalIso } from './time';

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

/**
 * Whether a local time ("21:30") is within hours that may pass midnight ("22:00"-"02:00"); the
 * same time twice ("00:00"-"00:00") is all day.
 */
export function withinHours(time: string, from: string, to: string): boolean {
  if (from === to) return true;
  return from < to ? time >= from && time < to : time >= from || time < to;
}

/** A code posters use that is no store or place: a state, a chain's mark, a product. */
export interface CodeMeaning {
  code: string;
  meaning: string;
  /** A product ("X1": Expansion X1), named in notices next to the store. */
  product?: boolean;
  /**
   * A chain's name or mark, the meaning its name ("▲": Arcade): a post naming it and only areas
   * (or no store) is that chain's branch there ("Arcade · Harbor").
   */
  chain?: boolean;
  /** A word for a lottery ("raffle", "draw"): posts using it are listed on Stores > Lotteries. */
  lottery?: boolean;
  /**
   * A phrase of posts that only mention a lottery ("only the raffle", "raffle queue"): posts using
   * it are left off Stores > Lotteries (2026-10-31). Never shown as a post's code.
   */
  notLottery?: boolean;
  /**
   * A word saying a sale has begun ("started"): such a post sends a notice at once to people who
   * chose only sales starting (S29). Never shown as a post's code.
   */
  saleStart?: boolean;
  /** A phrase saying it has not ("not started yet"): the post sends no notice for its words. */
  notSaleStart?: boolean;
  /**
   * An application word ("apply", "deadline"): with a lottery word, the post is a lottery's own
   * announcement and can leave Now (S29). Never shown as a post's code.
   */
  lotteryCue?: boolean;
}

/** Glossary entries that only steer notices and lists: never a post's code, never a product's run. */
export const isWordOnly = (g: CodeMeaning): boolean =>
  !!(g.notLottery || g.saleStart || g.notSaleStart || g.lotteryCue);

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

/** The chains a post names by their names or marks (once each, in the order written). */
export function chainsInPost(text: string, glossary: CodeMeaning[]): string[] {
  return [
    ...new Set(
      codesInPost(
        text,
        glossary.filter((g) => g.chain),
      ).map((g) => g.meaning),
    ),
  ];
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

// ---- Sales starting and confirmed lotteries (requirements S29) ----

/** Posts this old or older make no notice (a feed's first push brings a page of old ones). */
export const STORE_FRESH_MINUTES = 30;
/** Posts about one store within this time after a notice make no new one. */
export const STORE_QUIET_MINUTES = 30;
/** S29: how late a start word may reach Tora and still be told, at its real time. */
export const STORE_LATE_WORD_MINUTES = 120;
/** S29: this many different authors on one store, within this time, is a burst, whatever the words. */
export const BURST_AUTHORS = 3;
export const BURST_MINUTES = 15;
/** The cut of a post's first line in a short notice (S29: about 80 characters). */
const FIRST_LINE_CHARS = 80;

/** What a person is sent about their stores: everything (the default), only starts, or nothing. */
export const STORE_NOTICE_MODES = ['all', 'starts', 'off'] as const;
export type StoreNoticeMode = (typeof STORE_NOTICE_MODES)[number];

/** A person's choice; none or anything unknown (an old account file) is today's: everything. */
export function storeNoticeModeOf(prefs: { storeNoticeMode?: unknown } | null | undefined) {
  return STORE_NOTICE_MODES.find((m) => m === prefs?.storeNoticeMode) ?? 'all';
}

type WordKind = 'lottery' | 'notLottery' | 'saleStart' | 'notSaleStart' | 'lotteryCue';

/** Whether a text uses a word of this kind, as codes are found: Latin ones as whole words. */
const usesWord = (text: string, glossary: CodeMeaning[], kind: WordKind) => {
  const t = norm(text);
  return glossary.some((g) => g[kind] && mentions(t, g.code));
};

/** S29 (a): a sale start word and no not-start phrase. */
export const hasSaleStart = (text: string, glossary: CodeMeaning[]): boolean =>
  usesWord(text, glossary, 'saleStart') && !usesWord(text, glossary, 'notSaleStart');

/**
 * S29: a lottery's own announcement: a first post (not a reply) with a lottery word, an application
 * cue, no "not a lottery" phrase and no sale starting. A post only mentioning a lottery, or also
 * saying something is on sale, is not one: unsure stays.
 */
export const confirmedLottery = (
  post: { text: string; replyTo?: string | null },
  glossary: CodeMeaning[],
): boolean =>
  !post.replyTo &&
  usesWord(post.text, glossary, 'lottery') &&
  usesWord(post.text, glossary, 'lotteryCue') &&
  !usesWord(post.text, glossary, 'notLottery') &&
  !hasSaleStart(post.text, glossary);

/** Without both kinds of word nothing can be confirmed: callers spare their reads. */
export const canConfirmLottery = (glossary: CodeMeaning[]): boolean =>
  glossary.some((g) => g.lottery) && glossary.some((g) => g.lotteryCue);

/** A post with what places it in a thread. */
export interface ThreadedPost {
  id: string;
  source: string;
  externalId: string;
  text: string;
  replyTo: string | null;
  thread: string | null;
}

export const postRef = (p: { source: string; externalId: string }) => `${p.source}|${p.externalId}`;

/**
 * The ids of those `posts` that are a confirmed lottery or in one's thread (replies to replies too).
 * `known` holds the posts answered (by `postRef`); a thread whose first post is not known is
 * unsure, so it stays.
 */
export function lotteryPostIds<T extends ThreadedPost>(
  posts: T[],
  known: Map<string, ThreadedPost>,
  glossary: CodeMeaning[],
): Set<string> {
  const out = new Set<string>();
  if (!canConfirmLottery(glossary)) return out;
  for (const post of posts) {
    let at: ThreadedPost | undefined = post;
    const seen = new Set<string>();
    while (at?.replyTo && !seen.has(at.id)) {
      seen.add(at.id);
      at =
        known.get(`${at.source}|${at.thread ?? at.replyTo}`) ??
        known.get(`${at.source}|${at.replyTo}`);
    }
    if (at && !at.replyTo && confirmedLottery(at, glossary)) out.add(post.id);
  }
  return out;
}

/**
 * The most different authors in any window of BURST_MINUTES (both ends counted) holding the moment
 * `at`. The same author twice counts once; every post with no author together counts as one
 * author, never many. Moments are compared as instants, so the time zone's offset plays no part.
 */
export function burstAuthors(
  posts: { author: string | null; postedAt: string }[],
  at: string,
): number {
  const moment = Date.parse(at);
  if (!Number.isFinite(moment)) return 0;
  const span = BURST_MINUTES * 60_000;
  const timed = posts
    .map((p) => ({ when: Date.parse(p.postedAt), who: norm(p.author ?? '').trim() }))
    .filter((p) => Number.isFinite(p.when));
  let most = 0;
  for (const start of timed) {
    if (start.when > moment || start.when + span < moment) continue;
    const inside = timed.filter((p) => p.when >= start.when && p.when <= start.when + span);
    most = Math.max(most, new Set(inside.map((p) => p.who)).size);
  }
  return most;
}

/** A post as the notice rules read it. */
export interface NoticePost extends ThreadedPost {
  author: string | null;
  postedAt: string;
  receivedAt: string;
  storeIds: string[];
}

/** A store to tell about under 'starts': the post to show, and why. */
export interface SaleStart<T extends NoticePost = NoticePost> {
  storeId: string;
  post: T;
  why: 'word' | 'burst';
  /** A burst: how many people. */
  people: number | null;
  /** The line to show: the one holding the start word; a burst: the newest post's first. */
  line: string;
}

/** New posts recent enough to make a notice, naming a store. */
export const noticeablePosts = <T extends Pick<NoticePost, 'storeIds' | 'postedAt'>>(
  fresh: T[],
  now: Date,
): T[] => {
  const since = toLocalIso(new Date(now.getTime() - STORE_FRESH_MINUTES * 60_000));
  return fresh.filter((p) => p.storeIds.length && p.postedAt >= since);
};

/** How far back a start word can still be told, at most 2 hours late. */
const lateWordSince = (now: Date): string =>
  toLocalIso(new Date(now.getTime() - STORE_LATE_WORD_MINUTES * 60_000));

/**
 * From when stored posts matter to the rules below: as far back as a late start word counts, and a
 * quiet time further, so the word that opened a quiet time is still seen.
 */
export const startsReadSince = (now: Date): string =>
  toLocalIso(new Date(now.getTime() - (STORE_LATE_WORD_MINUTES + STORE_QUIET_MINUTES) * 60_000));

/** New posts that may make a 'starts' notice, naming a store: a start word may come in late. */
export const startsPosts = <T extends Pick<NoticePost, 'storeIds' | 'postedAt'>>(
  fresh: T[],
  now: Date,
): T[] => {
  const since = lateWordSince(now);
  return fresh.filter((p) => p.storeIds.length && p.postedAt >= since);
};

/** The moment a notice sent at this time or earlier no longer keeps the store quiet. */
const quietFrom = (at: Date) => toLocalIso(new Date(at.getTime() - STORE_QUIET_MINUTES * 60_000));

/** 'all' (S25, unchanged): the stores of the area named by new first posts. */
export const postedStores = (
  mine: Pick<NoticePost, 'storeIds' | 'replyTo'>[],
  area: Set<string>,
): string[] =>
  [...new Set(mine.filter((p) => !p.replyTo).flatMap((p) => p.storeIds))].filter((id) =>
    area.has(id),
  );

/**
 * 'all' (S25, unchanged): the latest new post per store not told within the quiet time, and every
 * reply; `told` holds the stores whose quiet time starts with this notice.
 */
export function postsToTell<T extends Pick<NoticePost, 'storeIds' | 'replyTo' | 'postedAt'>>(
  mine: T[],
  area: Set<string>,
  last: Map<string, string>,
  now: Date,
): { chosen: T[]; told: Set<string> } {
  const quiet = quietFrom(now);
  const told = new Set<string>();
  const chosen: T[] = [];
  for (const id of postedStores(mine, area)) {
    if ((last.get(id) ?? '') > quiet) continue;
    const post = mine.filter((p) => !p.replyTo && p.storeIds.includes(id)).at(-1)!;
    told.add(id);
    if (!chosen.includes(post)) chosen.push(post);
  }
  chosen.push(...mine.filter((p) => p.replyTo));
  chosen.sort((a, b) => a.postedAt.localeCompare(b.postedAt));
  return { chosen, told };
}

/**
 * 'starts' (S29): which stores of the area to tell about now, one notice per store per quiet time.
 * `fresh` is this push's posts (`startsPosts`), `recent` what is stored since `startsReadSince`,
 * never a post received later than now. Posts in `lottery` (a confirmed lottery's thread) neither
 * fire nor count. A store is looked at when a new post names it.
 *
 * A start word (no not-start phrase) tells the store when its post is fresh, or the feed brought it
 * late, up to 2 hours (the notice shows its real time) and posted after the last notice, which
 * already covered anything older. Its post must have come in after the last
 * notice's quiet time; one that came in then and is still untold had its send fail, so it goes
 * again. Exception: a notice with no start word in by its time was a burst's, and its quiet time
 * must not swallow a real start: the first word after it goes through, then that word's own quiet
 * time holds.
 *
 * A burst: 3 different authors within 15 minutes among posts fresh and in after the last notice's
 * quiet time, so sustained chatter needs three people anew. Places (`places`, areas holding many
 * stores) make no burst, only words do.
 */
export function salesStarting<T extends NoticePost>(opts: {
  fresh: T[];
  recent: T[];
  area: Set<string>;
  places: Set<string>;
  lottery: Set<string>;
  last: Map<string, string>;
  glossary: CodeMeaning[];
  now: Date;
}): SaleStart<T>[] {
  const { fresh, recent, area, places, lottery, last, glossary, now } = opts;
  const quiet = quietFrom(now);
  const since = toLocalIso(new Date(now.getTime() - STORE_FRESH_MINUTES * 60_000));
  const lateSince = lateWordSince(now);
  const stored = [...new Map([...recent, ...fresh].map((p) => [p.id, p])).values()]
    .filter((p) => !lottery.has(p.id))
    .sort((a, b) => a.postedAt.localeCompare(b.postedAt) || a.id.localeCompare(b.id));
  const woken = new Set(
    fresh.flatMap((p) => (lottery.has(p.id) ? [] : p.storeIds)).filter((id) => area.has(id)),
  );
  const cameLate = (p: T) =>
    Date.parse(p.receivedAt) - Date.parse(p.postedAt) > STORE_FRESH_MINUTES * 60_000;
  const out: SaleStart<T>[] = [];
  for (const storeId of woken) {
    const told = last.get(storeId) ?? '';
    const toldAt = told ? Date.parse(told) : Number.NEGATIVE_INFINITY;
    const onStore = stored.filter((p) => p.storeIds.includes(storeId));
    const afterQuiet = (p: T) => {
      const came = Date.parse(p.receivedAt);
      return !(Number.isFinite(came) && told > quietFrom(new Date(came)));
    };
    const words = onStore.filter((p) => hasSaleStart(p.text, glossary));
    const burstsOnly = !!told && !words.some((p) => Date.parse(p.receivedAt) <= toldAt);
    const word = words
      .filter(
        (p) =>
          p.postedAt >= lateSince &&
          (p.postedAt >= since || (cameLate(p) && Date.parse(p.postedAt) > toldAt)) &&
          (afterQuiet(p) || (burstsOnly && Date.parse(p.receivedAt) > toldAt)),
      )
      .at(-1);
    if (word && (told <= quiet || burstsOnly)) {
      out.push({
        storeId,
        post: word,
        why: 'word',
        people: null,
        line: startLineOf(word.text, glossary),
      });
      continue;
    }
    if (told > quiet || places.has(storeId)) continue;
    const open = onStore.filter((p) => p.postedAt >= since && afterQuiet(p));
    const people = Math.max(0, ...open.map((p) => burstAuthors(open, p.postedAt)));
    if (people >= BURST_AUTHORS) {
      const newest = open.at(-1)!;
      out.push({ storeId, post: newest, why: 'burst', people, line: firstLineOf(newest.text) });
    }
  }
  return out.sort((a, b) => a.post.postedAt.localeCompare(b.post.postedAt));
}

/** A post's first line that says something, cut to about 80 characters (emoji kept whole). */
export function firstLineOf(text: string): string {
  const line =
    text
      .split('\n')
      .map((l) => l.trim())
      .find(Boolean) ?? '';
  const chars = [...line];
  return chars.length > FIRST_LINE_CHARS ? `${chars.slice(0, FIRST_LINE_CHARS).join('')}…` : line;
}

/** The line of a post holding a start word (the first such), cut as `firstLineOf` cuts. */
export function startLineOf(text: string, glossary: CodeMeaning[]): string {
  const line = text.split('\n').find((l) => usesWord(l, glossary, 'saleStart'));
  return firstLineOf(line ?? text);
}
