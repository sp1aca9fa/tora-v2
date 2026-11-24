import {
  BlockedError,
  HttpError,
  RequestCapError,
  type Collector,
  type CollectorContext,
  type FoundListing,
  type SupplyInput,
} from '@tora/collector-sdk';
import { isGameItem, type SourceInfo } from '@tora/core';
import type { Product } from '@tora/db';

/**
 * New and used copies of a game by its product code (JAN), across the shops of Yahoo! JAPAN
 * Shopping, through its official item search API (requirements S36 B5). It never searches by name:
 * the JAN comes from the identity shop's page (S36 A5, `product_sources.facts.jan`) and is the
 * link's id, made by the candidates step with no request (`linksByCode`). A collect makes two
 * requests: new copies in stock and used copies in stock, cheapest first. The cheapest new copy is
 * by item price (the API does not say whether its price sort counts shipping). Used copies get
 * the bucket `cond:used`, which no watch, wish or holding can have (theirs come from Core 6's
 * conditions, and `cond` is a reserved list name): the API gives no condition grade, so they are
 * shown apart and never an alert's or an ask's copy (S36 Terms "Condition"). A collect stores
 * nothing when the item's code is not the link's any more (the linking step follows it).
 *
 * Needs `YAHOO_SHOPPING_CLIENT_ID` (a Client ID from the provider's developer site) in the root
 * `.env`; without it the plug-in is not registered. The Client ID is a secret: it is sent only to the
 * API host, and every error text is masked before it leaves this file (the SDK's errors name the URL).
 */

export const YAHOO_SHOPPING = 'yahoo_shopping';
const API = 'https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch';
/** Hits per condition: enough for the cheapest copy and the three cheapest sellers. */
const RESULTS = 20;
const CURRENCY = 'JPY';
/** The bucket of a new copy (Core 6's item conditions). */
const NEW = 'cond:new';
/**
 * The bucket of a used copy of no known grade: not one of Core 6's (`deriveBucket` never gives it),
 * so no '' (any condition) wish or graded wish reads it as its ask.
 */
export const USED = 'cond:used';
/** The API's shipping code for free shipping (1: not set, 3: free under a condition). */
const FREE_SHIPPING = 2;

const SCOPE_TEXT =
  'the Yahoo! JAPAN application lacks the shopping API (insufficient_scope): add it to the application at the developer site';

/**
 * Whether a code is a 13-digit JAN with a valid check digit. A short (8-digit) code is not sent: a
 * request the API refuses stops the run for this source, and one game would stop it every night.
 * Only digits: it goes into the request's address.
 */
export function validJan(code: string): boolean {
  if (!/^\d{13}$/.test(code)) return false;
  const digits = [...code].map(Number);
  const check = digits.pop()!;
  // From the right, the digits before the check digit weigh 3, 1, 3, 1...
  const sum = digits.reverse().reduce((n, d, i) => n + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

/** The Client ID out of a text: the `appid` parameter and the value itself, raw or URL-encoded. */
export function maskClientId(text: string, clientId: string): string {
  let out = text.replace(/appid=[^&\s#"']*/gi, 'appid=***');
  for (const form of new Set([clientId, encodeURIComponent(clientId)]))
    if (form) out = out.split(form).join('***');
  return out;
}

/**
 * An error from the polite client with the Client ID taken out. Refusals stop the source for the
 * run and are never retried around (the next night tries again): 403 and 429 (the SDK's), any
 * server error (the API's limited state answers 500), 401 (the Client ID refused) and 400 (the
 * application refused: the reference read does not tell its causes apart, so it is taken as one).
 */
function masked(e: unknown, clientId: string, what: string): Error {
  if (e instanceof RequestCapError) return e;
  if (e instanceof BlockedError) {
    const body = maskClientId(e.body, clientId);
    if (/insufficient_scope/.test(body)) return new BlockedError(SCOPE_TEXT, body);
    return new BlockedError(maskClientId(e.message, clientId), body);
  }
  if (e instanceof HttpError) {
    if (e.status >= 500)
      return new BlockedError(
        `HTTP ${e.status} from the shopping API for ${what}: limited for now`,
      );
    if (e.status === 401)
      return new BlockedError(
        `HTTP 401 from the shopping API for ${what}: the Client ID was refused`,
      );
    if (e.status === 400)
      return new BlockedError(
        `HTTP 400 from the shopping API for ${what}: the application or its request was refused`,
      );
    // Never a "listing gone" (404): the code stays linked.
    return new Error(`HTTP ${e.status} from the shopping API for ${what}`);
  }
  const error = new Error(maskClientId(e instanceof Error ? e.message : String(e), clientId));
  if (e instanceof Error && e.name !== 'Error') error.name = e.name;
  return error;
}

/** A hit as the API gives it; only the fields read here (unknown ones are ignored). */
interface Hit {
  name?: unknown;
  url?: unknown;
  code?: unknown;
  price?: unknown;
  shipping?: { code?: unknown } | null;
  inStock?: unknown;
  condition?: unknown;
  janCode?: unknown;
  seller?: { sellerId?: unknown } | null;
}

/** One search's answer, read. */
interface Search {
  /** Matches the API counts for the search (it may hold hits of another code). */
  total: number;
  /** Hits returned. */
  returned: number;
  /** The hits that are this item's copies, cheapest first. */
  kept: FoundListing[];
}

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);
const count = (v: unknown) => {
  const n = typeof v === 'string' && v.trim() ? Number(v) : v;
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : null;
};

/** A hit kept as a listing: this JAN, this condition, in stock, with an id and a yen price. */
export function hitListing(hit: Hit, jan: string, condition: 'new' | 'used'): FoundListing | null {
  const code = text(hit.code);
  const price = count(hit.price);
  if (!code || !price) return null;
  if (String(hit.janCode ?? '').trim() !== jan) return null;
  if (hit.inStock === false) return null;
  if (hit.condition != null && hit.condition !== condition) return null;
  return {
    ref: code,
    title: text(hit.name) ?? '',
    url: text(hit.url),
    price,
    currency: CURRENCY,
    seller: text(hit.seller?.sellerId),
    category: null,
    shippingPayerId: null,
    // Free shipping only when the hit says so; a conditional one is not known for one copy.
    shipping: count(hit.shipping?.code) === FREE_SHIPPING ? 'included' : 'unknown',
  };
}

/** Reads an answer body; throws on a refusal or an answer that is not a search's. */
export function readAnswer(body: string, jan: string, condition: 'new' | 'used'): Search {
  let answer: unknown;
  try {
    answer = JSON.parse(body);
  } catch {
    // The API's limited state answers a page, not JSON: a refusal.
    throw new BlockedError(
      `the shopping API answered a page that is not JSON (${condition} copies)`,
    );
  }
  if (!answer || typeof answer !== 'object' || Array.isArray(answer))
    throw new Error(`the shopping API answered no search (${condition} copies)`);
  const a = answer as Record<string, unknown>;
  if (a.error !== undefined || a.Error !== undefined) {
    if (/insufficient_scope/.test(JSON.stringify(answer))) throw new BlockedError(SCOPE_TEXT);
    // Any error answer is a refusal of the application: the run stops for this source rather
    // than one request per game against it (the next night tries again).
    throw new BlockedError(`the shopping API answered an error (${condition} copies)`);
  }
  // The first position (spelled `firstResultsPosition` or `firstResultPosition`) is not needed:
  // one page from the start is read. Unknown fields are ignored.
  const total = count(a.totalResultsAvailable);
  const hits = Array.isArray(a.hits) ? (a.hits as Hit[]) : null;
  if (total === null || (hits === null && total > 0))
    throw new Error(`the shopping API answered no search (${condition} copies)`);
  const kept = (hits ?? [])
    .map((h) => (h && typeof h === 'object' ? hitListing(h, jan, condition) : null))
    .filter((l): l is FoundListing => l !== null)
    // Stable: equal prices keep the API's order.
    .toSorted((x, y) => x.price - y.price);
  return { total, returned: hits?.length ?? 0, kept };
}

/**
 * One condition's row. Listings: the API's count when every hit returned was kept; when some were
 * another code's, the kept ones if every match was returned, else not known. No copy kept: 0 when
 * every match was seen, else not known (a copy may sit past the hits returned).
 */
export function supplyRow(bucket: string | null, s: Search): SupplyInput {
  const seenAll = s.total <= s.returned;
  const listings = s.kept.length === s.returned ? s.total : seenAll ? s.kept.length : null;
  const first = s.kept[0];
  return {
    bucket,
    lowestAsk: first?.price ?? null,
    currency: CURRENCY,
    listings,
    url: first?.url ?? null,
    raw: { total: s.total },
    offers: s.kept,
  };
}

/** Whether a new copy is in stock: false only when every match was seen and none was this item's. */
export function soldNew(s: Search): boolean | null {
  if (s.kept.length) return true;
  return s.total <= s.returned ? false : null;
}

async function search(
  ctx: CollectorContext,
  clientId: string,
  jan: string,
  condition: 'new' | 'used',
): Promise<Search> {
  const params = new URLSearchParams({
    appid: clientId,
    jan_code: jan,
    condition,
    in_stock: 'true',
    sort: '+price',
    results: String(RESULTS),
  });
  let body: string;
  try {
    // As text: a body that is not JSON is a refusal here, not a parse error.
    body = await ctx.http.text(`${API}?${params}`, { Accept: 'application/json' });
  } catch (e) {
    throw masked(e, clientId, `${condition} copies`);
  }
  try {
    return readAnswer(body, jan, condition);
  } catch (e) {
    throw masked(e, clientId, `${condition} copies`);
  }
}

/** The collector, with its Client ID (kept in this closure only: never stored or logged). */
export function yahooShopping(clientId: string): Collector {
  return {
    source: YAHOO_SHOPPING,
    label: 'Yahoo! Shopping',
    // The API allows one request a second; the SDK never goes under 2 s anyway. No retry on a server
    // error: the API's limited state answers 500, and a refusal is never retried around.
    http: { minDelayMs: 1_100, retries: 0 },
    linksByCode: true,
    // Game items of the home market (Japan); a game with no region is judged by its JAN alone.
    supports: (p: Product) => isGameItem(p) && (p.region == null || p.region === 'jp'),
    async findCandidates(product, ctx) {
      // From the stored facts, no request; no JAN, no link (never a search by name).
      const jan = await ctx.productCode?.(product);
      if (!jan || !validJan(jan)) return [];
      return [{ externalId: jan, title: `JAN ${jan}`, url: null, score: 1 }];
    },
    async collect(link, product, ctx) {
      const jan = link.externalId;
      if (!jan || !validJan(jan)) throw new Error('the link is not a valid JAN');
      // The item's code now: another one (a corrected JAN, a relinked identity page) or none means
      // these copies may be another game's, so nothing is stored (never "gone": the link stays).
      const now = (await ctx.productCode?.(product)) ?? null;
      if (now === null)
        throw new Error(
          'the item has no product code from its identity shop now (none stored, or its pages disagree): nothing stored',
        );
      if (now !== jan)
        throw new Error(
          `the item's product code is now ${now}, not the link's ${jan}: nothing stored until the link follows it`,
        );
      const fresh = await search(ctx, clientId, jan, 'new');
      const used = await search(ctx, clientId, jan, 'used');
      const sold = soldNew(fresh);
      return {
        state: null,
        complete: true,
        supply: [supplyRow(NEW, fresh), supplyRow(USED, used)],
        // Only what the search said: left out when it could not tell (the stored day stays its own).
        ...(sold !== null && {
          facts: { releaseDate: null, listPrice: null, jan: null, maker: null, soldNew: sold },
        }),
      };
    },
  };
}

/** How the app shows it; the credit line is the provider's required attribution (W15 shows it). */
export const yahooShoppingSource: SourceInfo = {
  key: YAHOO_SHOPPING,
  label: 'Yahoo! Shopping',
  badge: 'YS',
  market: 'jp',
  currency: CURRENCY,
  priceKinds: ['listing'],
  categories: ['game'],
  // A new source is compared until its numbers are checked.
  roles: { game: 'comparison' },
  priority: 60,
  credit: { text: 'Web Services by Yahoo! JAPAN', url: 'https://developer.yahoo.co.jp/sitemap/' },
};
