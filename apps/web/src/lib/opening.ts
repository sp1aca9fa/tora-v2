import 'server-only';
import { type OpeningValue, convertMinor, openingValue } from '@tora/core';
import {
  type Db,
  type OpeningCardRow,
  type Product,
  type SetRates,
  currentSupply,
  latestRates,
  latestSignals,
  lowestAsk,
  openingCardsOf,
  openingFee,
  openingRates,
} from '@tora/db';
import { getBase } from './money-server';

/** A sealed box's price is the shrink-wrapped one. */
const BOX_BUCKET = 'sealed:shrink';

export interface PricedCard extends OpeningCardRow {
  /** What a copy brings after the fee (base currency); null without a price. */
  value: number | null;
}

export interface BoxOpening {
  product: Product;
  set: SetRates;
  cards: PricedCard[];
  value: OpeningValue;
  /** Today's market value of the box, else its lowest ask (base currency). */
  boxPrice: number | null;
  fee: number;
  /** When the cards were last read; null before the first read. */
  readAt: string | null;
}

/**
 * The opening value of each booster box among the products (S20): its set's pull rates and hit
 * cards, each card at its recent sales (else its lowest ask) less the selling fee.
 */
export async function loadOpenings(db: Db, products: Product[]): Promise<Map<string, BoxOpening>> {
  const boxes = products.filter((p) => p.kind === 'booster_box' && p.setId);
  const out = new Map<string, BoxOpening>();
  if (!boxes.length) return out;
  const setIds = [...new Set(boxes.map((p) => p.setId!))];
  const [rates, cardsBySet, fee, base, signals, supply] = await Promise.all([
    openingRates(db, setIds),
    openingCardsOf(db, setIds),
    openingFee(db),
    getBase(),
    latestSignals(
      db,
      boxes.map((p) => ({ productId: p.id, bucket: BOX_BUCKET })),
    ),
    currentSupply(
      db,
      boxes.map((p) => p.id),
    ),
  ]);
  const currencies = [...new Set([...cardsBySet.values()].flat().map((c) => c.currency))].filter(
    (c) => c !== base,
  );
  const fx = await latestRates(db, currencies);
  for (const product of boxes) {
    const set = rates.get(product.setId!);
    if (!set) continue;
    const cards: PricedCard[] = (cardsBySet.get(set.set.id) ?? []).map((c) => {
      const price = c.sold ?? c.ask;
      const rate = c.currency === base ? 1 : fx[c.currency]?.rate;
      return {
        ...c,
        value:
          price == null || rate == null
            ? null
            : Math.round(convertMinor(price, c.currency, base, rate) * (1 - fee)),
      };
    });
    const ask = lowestAsk(supply.get(product.id) ?? [], BOX_BUCKET);
    const boxPrice =
      signals.get(`${product.id}|${BOX_BUCKET}`)?.stats.fair ?? ask?.lowestAskBase ?? null;
    const value = openingValue({
      packsPerBox: set.rates.packsPerBox,
      tiers: set.rates.tiers,
      cards: cards.flatMap((c) =>
        c.value == null ? [] : [{ key: c.id, name: c.name, rarity: c.rarity, value: c.value }],
      ),
      boxPrice,
    });
    const readAt = cards.reduce<string | null>((a, c) => (a && a > c.readAt ? a : c.readAt), null);
    out.set(product.id, { product, set, cards, value, boxPrice, fee, readAt });
  }
  return out;
}
