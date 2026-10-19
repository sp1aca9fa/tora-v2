// The box opening value's cards (S20): once a week per set, each set card source lists the set's
// cards of every rarity in its pull rates; then the cards carrying most of the value get their
// recent sales, closer to what a copy really brings than the lowest ask.
import { openingValue } from '@tora/core';
import {
  type Db,
  type FoundSetCard,
  markOpeningRead,
  openingCardsOf,
  openingSetsDue,
  saveCardSales,
  saveOpeningCards,
} from '@tora/db';
import { errorText, type PoliteHttp } from './http';
import type { SetCardSource } from './types';

/** Cards per set whose sales are read. */
export const SOLD_CARDS = 10;
/**
 * Sets read in one night (about 40 requests each): the first nights spread the sets over a few
 * days, and the weekly reads stay spread the same way.
 */
export const SETS_PER_RUN = 5;

export async function readOpeningCards(
  db: Db,
  sources: SetCardSource[],
  http: PoliteHttp,
  opts: { log: (m: string) => void; now?: Date },
): Promise<{ sets: number; cards: number; failed: number }> {
  const now = opts.now ?? new Date();
  const ctx = { http, now, log: opts.log };
  const due = (await openingSetsDue(db, now)).slice(0, SETS_PER_RUN);
  let cards = 0;
  let failed = 0;
  let done = 0;
  for (const set of due) {
    const rarities = [...new Set(set.rates.tiers.map((t) => t.rarity))];
    try {
      for (const source of sources) {
        const found: FoundSetCard[] = [];
        for (const rarity of rarities)
          found.push(
            ...(await source.cards({ code: set.rates.code, name: set.set.name, rarity }, ctx)),
          );
        const unique = [...new Map(found.map((c) => [c.externalId, c])).values()];
        await saveOpeningCards(db, set.set.id, source.source, unique, now);
        cards += unique.length;
        if (!source.sold) continue;
        // The cards carrying the value, by their asks.
        const saved = ((await openingCardsOf(db, [set.set.id])).get(set.set.id) ?? []).filter(
          (c) => c.source === source.source && c.ask != null,
        );
        const value = openingValue({
          packsPerBox: set.rates.packsPerBox,
          tiers: set.rates.tiers,
          cards: saved.map((c) => ({ key: c.id, name: c.name, rarity: c.rarity, value: c.ask! })),
          runs: 1,
        });
        for (const share of value.cards.slice(0, SOLD_CARDS)) {
          const card = saved.find((c) => c.id === share.key)!;
          const sold = await source.sold(card.externalId, ctx);
          await saveCardSales(db, card.id, sold?.price ?? null, sold?.sales ?? 0);
        }
      }
      await markOpeningRead(db, set, now);
      done++;
      opts.log(`${set.set.name}: cards read`);
    } catch (error) {
      failed++;
      opts.log(`${set.set.name}: stopped (${errorText(error)})`);
    }
  }
  return { sets: done, cards, failed };
}
