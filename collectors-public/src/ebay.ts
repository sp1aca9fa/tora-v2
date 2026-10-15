import type { Collector, CollectorContext, PriceInput } from '@tora/collector-sdk';
import { GRADERS, gradedBucket, median, localDate, toLocalIso, withoutOutliers } from '@tora/core';
import type { Product } from '@tora/db';

/**
 * eBay asking prices through eBay's official Browse API (active listings only: sold data is closed
 * to new developers). US market, for comparison only: never in the valuation. One search per
 * product per run; each day stores, per condition (ungraded, PSA 10, ...), the median ask, the
 * lowest and how many are listed, plus the IDs seen for 14 days, so listings that vanish early can
 * be read as probable sales (requirements S7). eBay's terms: no data to AI models (the source is
 * marked `noAi`), copies only while needed (no titles or links stored, IDs dropped after 14 days).
 *
 * Needs EBAY_CLIENT_ID and EBAY_CLIENT_SECRET (a production keyset) in the root .env.
 */

const API = 'https://api.ebay.com';
const SEARCH = `${API}/buy/browse/v1/item_summary/search`;
/** Listings per search (the API's maximum page size). */
const LIMIT = 200;

interface EbayItem {
  itemId: string;
  title: string;
  price?: { value: string; currency: string };
  condition?: string;
  itemWebUrl?: string;
  image?: { imageUrl?: string };
  itemLocation?: { country?: string };
  buyingOptions?: string[];
}

/** Application token (client credentials), one per run. */
let token: { value: string; until: number } | null = null;
async function appToken(fetchImpl: typeof fetch = fetch): Promise<string> {
  if (token && token.until > Date.now() + 60_000) return token.value;
  const id = process.env.EBAY_CLIENT_ID;
  const secret = process.env.EBAY_CLIENT_SECRET;
  if (!id || !secret) throw new Error('EBAY_CLIENT_ID / EBAY_CLIENT_SECRET not set');
  const res = await fetchImpl(`${API}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
    },
    body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope',
  });
  if (!res.ok) throw new Error(`eBay token: HTTP ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: body.access_token, until: Date.now() + body.expires_in * 1000 };
  return token.value;
}
/** For tests. */
export const resetEbayToken = () => {
  token = null;
};

const NOT_ONE_ITEM =
  /\b(lot|lots|bundle|bulk|proxy|custom|orica|fan ?art|replica|reprint|choose|pick|you pick|select|set of|x\s?\d{1,2}|\d{1,2}\s?x)\b/i;
const JAPANESE = /japan|japanese|\bjpn?\b|日本/i;

/** "Pikachu - 208/S-P" (TCGplayer) -> "Pikachu 208/S-P". */
const fromTcgplayer = (title: string) => title.replace(/\s+-\s+/, ' ').trim();

/** Keywords for a product: its TCGplayer title when linked (eBay titles are English). */
export async function ebayKeywords(product: Product, ctx: CollectorContext): Promise<string> {
  const tcgplayer = (await ctx.linkedListings?.(product.id))?.find(
    (l) => l.source === 'tcgcsv' && l.title,
  )?.title;
  const words = tcgplayer
    ? [fromTcgplayer(tcgplayer)]
    : [product.setCode, product.cardNumber, product.kind === 'single' ? null : product.setName];
  if (product.region === 'jp') words.push('japanese');
  if (product.franchise === 'pokemon' && !tcgplayer) words.push('pokemon');
  return words.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

/** The card number's leading digits ("208/S-P" -> "208"), which a matching title must carry. */
const numberOf = (product: Product) =>
  product.cardNumber?.normalize('NFKC').match(/^0*(\d+)/)?.[1] ?? null;

/** Graded bucket in a title ("PSA 10", "BGS 9.5"); null for an ungraded card. */
export function gradeOf(title: string): string | null {
  const m = title.match(
    /\b(PSA|BGS|CGC|SGC|ARS|TAG|BECKETT)\s*(?:GEM\s*(?:MT|MINT)\s*)?(10|9\.5|9|8\.5|8|7|6|5)\b/i,
  );
  if (!m) return null;
  const name = m[1]!.toUpperCase() === 'BECKETT' ? 'BGS' : m[1]!.toUpperCase();
  const grader = GRADERS.find((g) => g.toUpperCase() === name) ?? 'other';
  return gradedBucket(grader, m[2]!);
}

/** Listings that are this item, grouped by condition (ungraded under null). */
export function groupListings(product: Product, items: EbayItem[]) {
  const number = numberOf(product);
  const groups = new Map<string | null, EbayItem[]>();
  for (const item of items) {
    const title = item.title.normalize('NFKC');
    if (!item.price || item.price.currency !== 'USD') continue;
    if (NOT_ONE_ITEM.test(title)) continue;
    if (product.region === 'jp' ? !JAPANESE.test(title) : JAPANESE.test(title)) continue;
    if (
      product.kind === 'single' &&
      number &&
      !new RegExp(`(?<!\\d)0*${number}(?!\\d)`).test(title)
    )
      continue;
    const bucket = product.kind === 'single' ? gradeOf(title) : null;
    groups.set(bucket, [...(groups.get(bucket) ?? []), item]);
  }
  return groups;
}

const label = (bucket: string | null) =>
  bucket ? bucket.replace(/^graded:/, '').replace(':', ' ') : 'Ungraded';

export const ebay: Collector = {
  source: 'ebay',
  label: 'eBay',
  supports: (p) => p.category === 'tcg' && p.kind !== 'supply' && p.kind !== 'other' && !!p.region,
  // A search per product; its keywords are filled in on the first run (from the TCGplayer title
  // once linked), then editable in the app.
  defaultQuery: () => ({ keywords: [], extra: { auto: true, v: 1 } }),
  queryVersion: 1,
  findCandidates: async () => [],

  async collect(link, product, ctx) {
    let query = link.query ?? {};
    const extra = (query.extra ?? {}) as { edited?: boolean };
    // Built from the product until the user edits it; rebuilt once a TCGplayer title appears.
    let keywords = query.keywords?.join(' ') ?? '';
    if (!extra.edited) {
      const built = await ebayKeywords(product, ctx);
      if (built && built !== keywords) {
        keywords = built;
        query = { ...query, keywords: [built] };
      }
    }
    if (!keywords) throw new Error('no keywords for the eBay search');
    const params = new URLSearchParams({
      q: keywords,
      limit: String(LIMIT),
      filter: 'buyingOptions:{FIXED_PRICE},priceCurrency:USD',
    });
    const res = await ctx.http.json<{ itemSummaries?: EbayItem[]; total?: number }>(
      `${SEARCH}?${params}`,
      {
        Authorization: `Bearer ${await appToken()}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
      },
    );
    const items = (res.itemSummaries ?? []).filter(
      (i) =>
        !(query.excludeKeywords ?? []).some((w) => i.title.toLowerCase().includes(w.toLowerCase())),
    );
    const day = localDate(ctx.now);
    const searchUrl = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(keywords)}&LH_BIN=1`;
    const rows: PriceInput[] = [];
    for (const [bucket, list] of groupListings(product, items)) {
      const prices = list.map((i) => Number(i.price!.value)).filter((n) => n > 0);
      const kept = withoutOutliers(prices);
      const usd = median(kept);
      if (usd === null) continue;
      rows.push({
        productId: product.id,
        source: 'ebay',
        // The day's median asking price of the active listings: not a sale.
        observationType: 'listing',
        bucket,
        price: Math.round(usd * 100),
        priceOriginal: Math.round(usd * 100),
        currency: 'USD',
        observedAt: toLocalIso(ctx.now),
        fetchedAt: toLocalIso(ctx.now),
        externalRef: `${product.id}|${bucket ?? 'ungraded'}|${day}`,
        title: `${list.length} listing(s)`,
        url: searchUrl,
        raw: {
          subType: label(bucket),
          stat: 'median_ask',
          count: list.length,
          min: Math.min(...prices),
          // Every listing seen today (kept 14 days, see the source description): those gone
          // before their end may have sold. No titles or links are kept (eBay's terms allow
          // copies only while needed).
          ids: list.map((i) => i.itemId),
        },
      });
    }
    await ctx.save(rows);
    return {
      state: {
        total: res.total ?? null,
        matched: rows.reduce((n, r) => n + Number((r.raw as { count: number }).count), 0),
      },
      complete: true,
      title: `"${keywords}"`,
      url: searchUrl,
      query: query === link.query ? undefined : query,
    };
  },
};
