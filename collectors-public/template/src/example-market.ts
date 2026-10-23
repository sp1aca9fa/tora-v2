import type { Collector, PriceInput } from '@tora/collector-sdk';
import { termCoverage } from '@tora/collector-sdk';
import { gradedBucket, parseGrade, productClass, toLocalIso } from '@tora/core';
import type { Product } from '@tora/db';

/**
 * Template plug-in (docs/collectors.md): Example Market, a made-up card marketplace with one page
 * per card and a JSON API for its search and its sales history. Copy this file, rename the key,
 * and replace the URLs and the parsing with your site's. Nothing here talks to a real site.
 *
 * - Search:  GET {BASE}/api/search?q=<words>
 *            { items: [{ id, title, url, image, price, currency }] }
 * - Sales:   GET {BASE}/api/items/<id>/sales?page=<n>   (newest first, 20 per page)
 *            { title, url, image, hasMore, sales: [{ id, price, currency, condition, soldAt }] }
 */

export const BASE = 'https://example-market.test';
/** The site's currency (its `SourceInfo` says the same). */
export const CURRENCY = 'JPY';
/** Pages read per listing per run: a long history is read over several runs. */
export const MAX_PAGES = 5;

interface SearchItem {
  id: string;
  title: string;
  url: string;
  image: string | null;
  price: number;
  currency: string;
}

interface Sale {
  id: string;
  /** In the currency's smallest unit (yen; cents for dollars). */
  price: number;
  currency: string;
  /** As the site writes it: "A", "B", "PSA 10", ... */
  condition: string;
  /** ISO time with its offset. */
  soldAt: string;
}

interface SalesPage {
  title: string;
  url: string;
  image: string | null;
  hasMore: boolean;
  sales: Sale[];
}

/**
 * What the collect stores on the link between runs (`product_sources.state`): the newest sale
 * time already saved, and where an unfinished backfill resumes.
 */
export interface ExampleState {
  through?: string;
  resumePage?: number;
  pendingNewest?: string;
}

/** The site's condition as a price bucket (`raw:A`, `graded:PSA:10`); null when unreadable. */
export function bucketOf(condition: string): string | null {
  const grade = parseGrade(condition);
  if (!grade) return null;
  return grade.grading === 'raw'
    ? `raw:${grade.rawGrade}`
    : gradedBucket(grade.grader, grade.grade);
}

const later = (a: string | undefined, b: string | undefined) =>
  !a ? b : !b ? a : Date.parse(a) > Date.parse(b) ? a : b;

export const exampleMarket: Collector = {
  // Stored with every price: never change it once data exists.
  source: 'example',
  label: 'Example Market',

  // Cards only: the item type is `card` for TCG singles (docs/categories.md).
  supports: (p: Product) => productClass(p) === 'card',

  async findCandidates(product, ctx) {
    const words = [product.name, product.cardNumber].filter((w): w is string => !!w);
    const q = encodeURIComponent(words.join(' '));
    const found = await ctx.http.json<{ items: SearchItem[] }>(`${BASE}/api/search?q=${q}`);
    return found.items
      .map((item) => {
        // 0-1: how sure this is the same card. Over 0.9 with one clear match is safe to show
        // first; the user confirms every candidate in the app.
        let score = termCoverage([product.name], item.title) * 0.6;
        if (product.cardNumber && item.title.includes(product.cardNumber)) score += 0.4;
        return {
          externalId: item.id,
          title: item.title,
          url: item.url,
          imageUrl: item.image,
          // In the site's own currency; a listing priced in another has none.
          price: item.currency === CURRENCY ? item.price : null,
          score: Math.round(score * 100) / 100,
        };
      })
      .filter((c) => c.score >= 0.3)
      .sort((a, b) => b.score - a.score);
  },

  async collect(link, product, ctx) {
    // Listing-based: every link has the ID its candidate or pasted link gave.
    if (!link.externalId) throw new Error('example: link without a listing ID');
    const id = encodeURIComponent(link.externalId);
    const prev = (link.state ?? {}) as ExampleState;
    let page = prev.resumePage ?? 1;
    let newest = prev.resumePage ? prev.pendingNewest : undefined;
    let last: SalesPage | null = null;
    for (let read = 0; read < MAX_PAGES; read++, page++) {
      last = await ctx.http.json<SalesPage>(`${BASE}/api/items/${id}/sales?page=${page}`);
      const fresh = last.sales.filter(
        (s) => !prev.through || Date.parse(s.soldAt) > Date.parse(prev.through),
      );
      const rows: PriceInput[] = fresh.flatMap((s) => {
        const bucket = bucketOf(s.condition);
        // A condition we cannot read is left out rather than guessed.
        if (!bucket) return [];
        return [
          {
            productId: product.id,
            source: 'example',
            observationType: 'sold' as const,
            bucket,
            price: s.price,
            priceOriginal: s.price,
            currency: s.currency,
            observedAt: toLocalIso(new Date(s.soldAt)),
            fetchedAt: toLocalIso(ctx.now),
            // Unique per source: saving the same sale twice is a no-op.
            externalRef: s.id,
            title: last!.title,
            url: last!.url,
            raw: { condition: s.condition },
          },
        ];
      });
      await ctx.save(rows);
      newest = later(newest, last.sales[0]?.soldAt);
      const reachedSaved = fresh.length < last.sales.length;
      if (reachedSaved || !last.hasMore) {
        return {
          state: { through: later(prev.through, newest) } satisfies ExampleState,
          complete: true,
          title: last.title,
          url: last.url,
          imageUrl: last.image,
        };
      }
    }
    // Page budget used up: the next run resumes here.
    ctx.log(`example: ${link.externalId} resumes at page ${page}`);
    return {
      state: {
        through: prev.through,
        resumePage: page,
        pendingNewest: newest,
      } satisfies ExampleState,
      complete: false,
      title: last?.title ?? null,
      url: last?.url ?? link.url,
      imageUrl: last?.image ?? null,
    };
  },
};
