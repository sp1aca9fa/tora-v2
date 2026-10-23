import type { Collector, PoliteHttp } from '@tora/collector-sdk';
import { localDate, toLocalIso } from '@tora/core';

/**
 * Cardmarket prices through TCGdex (tcgdex.dev: an open, keyless card database, MIT licensed,
 * with Cardmarket's price guide in euros refreshed daily). One price per card per day: the
 * "trend" Cardmarket computes from its own sales, saved as that day's sale of a near-mint raw
 * card (`priceKinds: ['market']`). Single cards of the international (English) prints only:
 * TCGdex has no sealed product prices. Opt-in (`ENABLE_CARDMARKET=1`): loaded, it would search
 * every English card each night.
 */

const BASE = 'https://api.tcgdex.net/v2/en';

interface TcgdexSet {
  id: string;
  name: string;
  cardCount: { official: number };
  cards: { id: string; localId: string; name: string; image?: string }[];
}
interface TcgdexCard {
  id: string;
  localId: string;
  name: string;
  image?: string;
  set: { name: string; cardCount: { official: number } };
  pricing?: {
    cardmarket?: {
      updated: string;
      unit: string;
      idProduct: number;
      trend: number | null;
      avg: number | null;
      low: number | null;
      avg1: number | null;
      avg7: number | null;
      avg30: number | null;
    } | null;
  };
}

/** Answers fetched in this run (one polite client per run). */
const runCache = new WeakMap<PoliteHttp, Map<string, Promise<unknown>>>();
function cached<T>(http: PoliteHttp, path: string): Promise<T> {
  let answers = runCache.get(http);
  if (!answers) runCache.set(http, (answers = new Map()));
  let answer = answers.get(path);
  if (!answer) {
    answer = http.json<T>(`${BASE}/${path}`);
    answers.set(path, answer);
    // A failed fetch is not remembered (the next product tries again).
    answer.catch(() => answers.delete(path));
  }
  return answer as Promise<T>;
}

/** "215/203", "TG05", "020" -> "215", "tg5", "20": the number as printed, without zero padding. */
const plain = (n: string | null) =>
  n
    ?.normalize('NFKC')
    .split('/')[0]!
    .trim()
    .toLowerCase()
    .replace(/^([a-z]*)0+(?=\d)/, '$1') ?? null;

/** TCGdex's card picture in the small size. */
const picture = (image?: string) => (image ? `${image}/low.webp` : null);

export const tcgdex: Collector = {
  source: 'tcgdex',
  label: 'Cardmarket',
  supports: (p) =>
    p.category === 'tcg' && p.franchise === 'pokemon' && p.region === 'en' && p.kind === 'single',

  async findCandidates(product, ctx) {
    const want = plain(product.cardNumber);
    const code = (product.setCode ?? (await ctx.setOf?.(product))?.code)?.trim();
    if (!want || !code) return [];
    // The printed set code ("EVS") is TCGdex's official abbreviation; a TCGdex set ID also works.
    const q = encodeURIComponent(code);
    const sets = [
      ...(await cached<{ id: string }[]>(ctx.http, `sets?abbreviation.official=eq:${q}`)),
      ...(await cached<{ id: string }[]>(ctx.http, `sets?id=eq:${q}`)),
    ];
    const found = [];
    for (const { id } of new Map(sets.map((s) => [s.id, s])).values()) {
      const set = await cached<TcgdexSet>(ctx.http, `sets/${id}`);
      const same = set.cards.filter((c) => plain(c.localId) === want);
      for (const c of same)
        found.push({
          externalId: c.id,
          title: `${c.name} ${c.localId}/${set.cardCount.official} (${set.name})`,
          url: `${BASE}/cards/${c.id}`,
          imageUrl: picture(c.image),
          score: same.length === 1 ? 0.9 : 0.7,
        });
    }
    return found;
  },

  async collect(link, product, ctx) {
    // A card TCGdex no longer has answers 404: the run sets the listing aside after a few nights.
    const card = await ctx.http.json<TcgdexCard>(`${BASE}/cards/${link.externalId}`);
    const cm = card.pricing?.cardmarket;
    const title = `${card.name} ${card.localId}/${card.set.cardCount.official} (${card.set.name})`;
    const rows = [];
    if (cm?.trend && cm.unit === 'EUR') {
      // When Cardmarket's price guide was last read (TCGdex refreshes it daily).
      const at = Number.isNaN(Date.parse(cm.updated)) ? ctx.now : new Date(cm.updated);
      const cents = Math.round(cm.trend * 100);
      rows.push({
        productId: product.id,
        source: 'tcgdex',
        // One market price a day, counted as one sale (`priceKinds: ['market']`).
        observationType: 'sold' as const,
        // Cardmarket's guide prices ungraded cards, mostly near mint.
        bucket: 'raw:A',
        price: cents,
        priceOriginal: cents,
        currency: 'EUR',
        observedAt: toLocalIso(at),
        fetchedAt: toLocalIso(ctx.now),
        externalRef: `${cm.idProduct}|${localDate(at)}`,
        title,
        url: link.url,
        raw: {
          trend: cm.trend,
          avg: cm.avg,
          low: cm.low,
          avg1: cm.avg1,
          avg7: cm.avg7,
          avg30: cm.avg30,
        },
      });
    }
    await ctx.save(rows);
    return {
      state: null,
      complete: true,
      title,
      url: link.url ?? `${BASE}/cards/${card.id}`,
      imageUrl: picture(card.image),
    };
  },
};
