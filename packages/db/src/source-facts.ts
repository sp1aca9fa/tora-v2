// What a game's identity shop shows about the item beside its prices (requirements S36 A5): release
// date, list price, product code (JAN) and maker, read from the two pages its nightly read already
// fetches, kept on the link (`product_sources.facts`). Games only (the SDK checks `isGameItem` before
// writing): the shop is the identity source of sealed products too, and nothing new is written for
// them (S36 Scope rule). The list price is kept on its own and is never the item's retail price
// (`retail_price_base`, which a value falls back on). The release date fills the item's own date only
// while that is empty, never over one already there, and only once the day has come (on or before
// today in the app's zone): a pre-order's announced date stays in the facts alone, follows a delay
// there, and fills the item the night it has passed (S9 "New release: wait" counts from it).
import { and, eq, isNull, or } from 'drizzle-orm';
import type { Db } from './client';
import { productSources, products } from './schema';

/** Whether the list price includes tax: `unknown` unless the page says so (S36 A5). */
export type ListPriceTax = 'included' | 'excluded' | 'unknown';

/** The list price as the page shows it, in its own currency (never converted). */
export interface ListPrice {
  /** In `currency`'s smallest unit (yen). */
  amount: number;
  /** ISO 4217. */
  currency: string;
  tax: ListPriceTax;
}

/** What a plug-in read tonight; a field the pages do not show is null, never guessed. */
export interface SourceFactsInput {
  /** `YYYY-MM-DD`. */
  releaseDate: string | null;
  listPrice: ListPrice | null;
  /** EAN-13 or EAN-8, check digit verified. */
  jan: string | null;
  maker: string | null;
}

/** A stored list price: `seenAt`, the last read whose page showed it; null when stored without one. */
export interface StoredListPrice extends ListPrice {
  seenAt: string | null;
}

/**
 * As stored (`product_sources.facts`). `seenAt`: the last read that wrote them. A field the pages
 * left out tonight keeps what an earlier read of the same listing showed (a sold-out item's row drops
 * its list price, the item's facts did not change); a field shown tonight replaces it. The list price
 * carries its own `seenAt`, kept with it, so one kept from months ago never looks seen tonight.
 */
export interface SourceFacts extends Omit<SourceFactsInput, 'listPrice'> {
  listPrice: StoredListPrice | null;
  seenAt: string;
}

const TAX = new Set<ListPriceTax>(['included', 'excluded', 'unknown']);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);

/**
 * A link's stored facts; null when none are stored. A field of unknown shape reads as null (or the
 * tax as `unknown`), never a guess.
 */
export function sourceFacts(stored: unknown): SourceFacts | null {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return null;
  const f = stored as Record<string, unknown>;
  const lp = f.listPrice as Record<string, unknown> | null | undefined;
  const amount = lp && typeof lp === 'object' ? lp.amount : null;
  const currency = lp && typeof lp === 'object' ? str(lp.currency) : null;
  const releaseDate = str(f.releaseDate);
  return {
    releaseDate: releaseDate && DAY.test(releaseDate) ? releaseDate : null,
    listPrice:
      typeof amount === 'number' && Number.isFinite(amount) && amount > 0 && currency
        ? {
            amount,
            currency,
            tax: TAX.has(lp!.tax as ListPriceTax) ? (lp!.tax as ListPriceTax) : 'unknown',
            // Stored before the list price had its own: not known.
            seenAt: str(lp!.seenAt),
          }
        : null,
    jan: str(f.jan),
    maker: str(f.maker),
    seenAt: str(f.seenAt) ?? '',
  };
}

/** Tonight's facts over the stored ones: a field shown tonight wins, one left out keeps the stored. */
export function mergeFacts(
  stored: unknown,
  tonight: SourceFactsInput,
  seenAt: string,
): SourceFacts {
  const was = sourceFacts(stored);
  return {
    releaseDate: tonight.releaseDate ?? was?.releaseDate ?? null,
    listPrice: tonight.listPrice ? { ...tonight.listPrice, seenAt } : (was?.listPrice ?? null),
    jan: tonight.jan ?? was?.jan ?? null,
    maker: tonight.maker ?? was?.maker ?? null,
    seenAt,
  };
}

/**
 * Stores a game's facts on its link and fills the item's release date when it has none and the day
 * has come (S36 A5; `today`, `YYYY-MM-DD` in the app's zone). The caller checks the item is a game.
 * Returns whether the item's release date was filled.
 */
export async function saveSourceFacts(
  db: Db,
  link: { id: string; productId: string; facts: unknown },
  tonight: SourceFactsInput,
  seenAt: string,
  today: string,
): Promise<{ releaseDateFilled: boolean }> {
  const facts = mergeFacts(link.facts, tonight, seenAt);
  return db.transaction(async (tx) => {
    await tx
      .update(productSources)
      .set({ facts: { ...facts } })
      .where(eq(productSources.id, link.id));
    // Only a date the pages show tonight fills the item: one kept from an earlier read may be a
    // day the game was since moved from. A date still to come (a pre-order) stays in the facts.
    const day = tonight.releaseDate;
    if (!day || day > today) return { releaseDateFilled: false };
    // Only while empty, checked in the write itself: a date set since the run read the item stays.
    const filled = await tx
      .update(products)
      .set({ releaseDate: day })
      .where(
        and(
          eq(products.id, link.productId),
          or(isNull(products.releaseDate), eq(products.releaseDate, '')),
        ),
      )
      .returning({ id: products.id });
    return { releaseDateFilled: filled.length > 0 };
  });
}
