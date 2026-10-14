import type { Collector, CollectorContext, PoliteHttp } from '@tora/collector-sdk';
import { tokyoDate, toTokyoIso } from '@tora/core';
import type { Product } from '@tora/db';

/**
 * TCGplayer prices through TCGCSV (tcgcsv.com: TCGplayer's catalog and daily prices as public
 * JSON files, updated once a day). US market prices for comparison only: they never feed the
 * valuation. One prices file per set (group) per run, shared by every product of that set.
 */

/** TCGplayer categories: Pokemon (English) and Pokemon Japan. */
const CATEGORIES: Record<string, number> = { en: 3, jp: 85 };
const KINDS = new Set(['single', 'booster_box', 'booster_pack', 'deck', 'special_set']);
const BASE = 'https://tcgcsv.com/tcgplayer';

interface Group {
  groupId: number;
  name: string;
  abbreviation: string;
  publishedOn: string;
}
interface TcgProduct {
  productId: number;
  name: string;
  url: string;
  imageUrl: string;
  extendedData: { name: string; value: string }[];
}
interface TcgPrice {
  productId: number;
  lowPrice: number | null;
  midPrice: number | null;
  highPrice: number | null;
  marketPrice: number | null;
  subTypeName: string;
}

/** Files fetched in this run (one polite client per run). */
const runCache = new WeakMap<PoliteHttp, Map<string, Promise<unknown>>>();
function cached<T>(http: PoliteHttp, url: string): Promise<T> {
  let files = runCache.get(http);
  if (!files) runCache.set(http, (files = new Map()));
  let file = files.get(url);
  if (!file) {
    file = url.endsWith('.txt')
      ? http.text(url).then((t) => t.trim())
      : http.json<{ results?: unknown }>(url).then((r) => r.results ?? r);
    files.set(url, file);
    // A failed fetch is not remembered (the next product tries again).
    file.catch(() => files.delete(url));
  }
  return file as Promise<T>;
}

const groupsOf = (http: PoliteHttp, cat: number) => cached<Group[]>(http, `${BASE}/${cat}/groups`);
const productsOf = (http: PoliteHttp, cat: number, group: number) =>
  cached<TcgProduct[]>(http, `${BASE}/${cat}/${group}/products`);
const pricesOf = (http: PoliteHttp, cat: number, group: number) =>
  cached<TcgPrice[]>(http, `${BASE}/${cat}/${group}/prices`);

const numberOf = (p: TcgProduct) => p.extendedData.find((e) => e.name === 'Number')?.value ?? null;
/** Name with the card number, when the name does not already carry it. */
const titleOf = (p: TcgProduct) => {
  const n = numberOf(p);
  return n && !p.name.includes(n) ? `${p.name} ${n}` : p.name;
};
/** "105/100", "232/SV-P", "020" -> 105, 232, 20. */
const leading = (n: string | null) => {
  const m = n?.normalize('NFKC').match(/^\s*0*(\d+)/);
  return m ? Number(m[1]) : null;
};

/** TCGplayer's URL slug of a group name ("S-P: Sword & Shield Promos" -> "s-p-sword-and-shield-promos"). */
export const groupSlug = (name: string) =>
  name
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** Whether a sealed product's name fits a kind (a box is not its packs, nor a case of boxes). */
const SEALED_FITS: Record<string, (name: string) => boolean> = {
  booster_box: (n) => /booster box|booster display/i.test(n) && !/case/i.test(n),
  booster_pack: (n) => /\bpack\b/i.test(n) && !/box|case|bundle/i.test(n),
  deck: (n) => /deck/i.test(n) && !/sleeve|shield|deck (box|case)/i.test(n),
  special_set: (n) => /box|set|collection/i.test(n) && !/booster (box|pack)|deck|case/i.test(n),
};

const days = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;

async function candidateGroups(
  product: Product,
  ctx: CollectorContext,
  groups: Group[],
): Promise<{ group: Group; byCode: boolean }[]> {
  const set = await ctx.setOf?.(product);
  const code = (product.setCode ?? set?.code)?.toLowerCase();
  const byCode = code ? groups.filter((g) => g.abbreviation.toLowerCase() === code) : [];
  if (byCode.length) return byCode.map((group) => ({ group, byCode: true }));
  // Sealed products of sets without a code (special sets, decks): the sets released that day.
  const release = product.releaseDate ?? set?.releaseDate;
  if (!release || product.kind === 'single') return [];
  return groups
    .filter((g) => days(g.publishedOn.slice(0, 10), release) <= 3)
    .map((group) => ({ group, byCode: false }));
}

export const tcgcsv: Collector = {
  source: 'tcgcsv',
  label: 'TCGplayer',
  supports: (p) =>
    p.category === 'tcg' &&
    p.franchise === 'pokemon' &&
    !!p.region &&
    p.region in CATEGORIES &&
    KINDS.has(p.kind),

  async findCandidates(product, ctx) {
    const cat = CATEGORIES[product.region!]!;
    const groups = await groupsOf(ctx.http, cat);
    let found: { p: TcgProduct; group: Group; score: number; fit?: boolean }[] = [];
    for (const { group, byCode } of await candidateGroups(product, ctx, groups)) {
      const items = await productsOf(ctx.http, cat, group.groupId);
      if (product.kind === 'single') {
        const want = leading(product.cardNumber);
        if (want === null) continue;
        const same = items.filter((p) => leading(numberOf(p)) === want);
        for (const p of same) found.push({ p, group, score: same.length === 1 ? 0.9 : 0.7 });
      } else {
        const fits = SEALED_FITS[product.kind];
        for (const p of items.filter((p) => !numberOf(p))) {
          const fit = fits?.(p.name) ?? false;
          found.push({ p, group, score: (byCode ? 0.6 : 0.4) + (fit ? 0.2 : 0), fit });
        }
      }
    }
    // Sealed: only products of the same kind (the box, not its packs), across all the candidate
    // sets; the others only when none fits.
    if (found.some((f) => f.fit)) found = found.filter((f) => f.fit !== false);
    return found
      .sort((a, b) => b.score - a.score)
      .map(({ p, group, score }) => ({
        externalId: String(p.productId),
        title: `${titleOf(p)} (${group.name})`,
        url: p.url,
        imageUrl: p.imageUrl,
        score,
      }));
  },

  async collect(link, product, ctx) {
    const cat = CATEGORIES[product.region ?? ''] ?? CATEGORIES.jp!;
    const state = (link.state ?? {}) as { groupId?: number };
    let groupId = state.groupId;
    if (!groupId) {
      // The set is in the listing's URL: /product/<id>/pokemon-japan-<group slug>-<card slug>.
      const path = (link.url ?? '').toLowerCase();
      const prefix = cat === 85 ? 'pokemon-japan-' : 'pokemon-';
      const group = (await groupsOf(ctx.http, cat))
        .filter((g) => path.includes(`/${prefix}${groupSlug(g.name)}-`))
        .sort((a, b) => b.name.length - a.name.length)[0];
      if (!group) throw new Error(`set of TCGplayer product ${link.externalId} not found`);
      groupId = group.groupId;
    }
    const id = Number(link.externalId);
    const [items, prices, updated] = await Promise.all([
      productsOf(ctx.http, cat, groupId),
      pricesOf(ctx.http, cat, groupId),
      cached<string>(ctx.http, 'https://tcgcsv.com/last-updated.txt').catch(() => null),
    ]);
    const item = items.find((p) => p.productId === id);
    // When TCGCSV last refreshed its prices (e.g. "2026-10-10T20:06:02+0000").
    const at = updated && !Number.isNaN(Date.parse(updated)) ? new Date(updated) : ctx.now;
    const day = tokyoDate(at);
    const fx = await ctx.fx?.('USDJPY', day);
    if (!fx) throw new Error('no USD/JPY rate stored yet');
    const rows = prices
      .filter((p) => p.productId === id)
      .flatMap((p) => {
        const usd = p.marketPrice ?? p.midPrice;
        if (!usd) return [];
        return [
          {
            productId: product.id,
            source: 'tcgcsv',
            // A daily market price (TCGplayer's estimate from recent sales), not one sale.
            observationType: 'listing' as const,
            bucket: null,
            priceBase: Math.round(usd * fx.rate),
            priceOriginal: Math.round(usd * 100),
            currency: 'USD',
            fxRate: fx.rate,
            observedAt: toTokyoIso(at),
            fetchedAt: toTokyoIso(ctx.now),
            externalRef: `${id}|${p.subTypeName}|${day}`,
            title: item?.name ?? null,
            url: item?.url ?? link.url,
            raw: {
              subType: p.subTypeName,
              market: p.marketPrice,
              low: p.lowPrice,
              mid: p.midPrice,
              high: p.highPrice,
              fxDate: fx.date,
            },
          },
        ];
      });
    await ctx.save(rows);
    return {
      state: { groupId },
      complete: true,
      title: item ? titleOf(item) : null,
      url: item?.url ?? link.url,
      imageUrl: item?.imageUrl ?? null,
    };
  },
};
