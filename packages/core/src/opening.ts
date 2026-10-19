// Box opening value (requirements S20): what the hit cards of a box are worth on average, the
// spread between boxes, and at what box price opening pays. Pull rates are community numbers,
// entered per set by the admin; cards below the hit rarities count as nothing.

/** Hits of one rarity (or part of one) in a box. */
export interface PullTier {
  /** As the shops write it: "SAR", "AR", "UR"... */
  rarity: string;
  /** How many a box holds on average (0.2: one box in five). */
  perBox: number;
  /**
   * Only the cards of the rarity whose name holds this text (e.g. "ex"); the rarity's tier
   * without one takes the rest.
   */
  match?: string | null;
}

/** A set's pull rates: the admin's, else the suggested ones. */
export interface PullRates {
  /** The set code the shops use in card titles ("SV2a"). */
  code: string;
  packsPerBox: number;
  tiers: PullTier[];
  /** Where the rates come from (site, video, own boxes). */
  source: string | null;
}

export interface OpeningCard {
  key: string;
  name: string;
  rarity: string;
  /** What one copy brings after the selling fee (base currency, smallest unit). */
  value: number;
}

export interface OpeningTier extends PullTier {
  cards: number;
  /** A card's average value in the tier; null when no card was found. */
  average: number | null;
  /** The tier's part of a box's value. */
  expected: number;
}

export interface OpeningCardShare {
  key: string;
  /** Copies a box holds on average. */
  perBox: number;
  /** Its part of a box's value. */
  expected: number;
  /** Its part as a share of the whole (0-1). */
  share: number;
}

export interface OpeningValue {
  /** A box's hits on average: opening pays below this box price (break-even). */
  expected: number;
  median: number;
  /** One box in ten is worth less than `low`, one in ten more than `high`. */
  low: number;
  high: number;
  /** Share of boxes worth at least the box price (null without one). */
  chanceBack: number | null;
  tiers: OpeningTier[];
  /** Cards by their part of the value, largest first. */
  cards: OpeningCardShare[];
}

const sameRarity = (a: string, b: string) =>
  a.normalize('NFKC').toUpperCase() === b.normalize('NFKC').toUpperCase();

/** Each card's tier (index), or -1 when no tier takes it. */
export function tierOf(tiers: PullTier[], card: Pick<OpeningCard, 'name' | 'rarity'>): number {
  const own = tiers
    .map((t, i) => [t, i] as const)
    .filter(([t]) => sameRarity(t.rarity, card.rarity));
  const name = card.name.normalize('NFKC');
  const matched = own.find(([t]) => t.match && name.includes(t.match.normalize('NFKC')));
  return (matched ?? own.find(([t]) => !t.match))?.[1] ?? -1;
}

/** Small seeded random numbers: the same rates and prices give the same spread every view. */
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const at = (sorted: number[], q: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;

/**
 * The value of opening one box. The average comes from the rates directly; the spread from
 * simulated boxes, where each pack has a hit of a tier with the same chance (perBox / packs) and a
 * hit is any card of the tier alike.
 */
export function openingValue(input: {
  packsPerBox: number;
  tiers: PullTier[];
  cards: OpeningCard[];
  boxPrice?: number | null;
  runs?: number;
}): OpeningValue {
  const { tiers, cards } = input;
  const packs = Math.max(1, Math.round(input.packsPerBox));
  const groups = tiers.map(() => [] as OpeningCard[]);
  for (const card of cards) {
    const i = tierOf(tiers, card);
    if (i >= 0) groups[i]!.push(card);
  }
  const tierRows: OpeningTier[] = tiers.map((t, i) => {
    const list = groups[i]!;
    const average = list.length ? list.reduce((n, c) => n + c.value, 0) / list.length : null;
    return {
      ...t,
      cards: list.length,
      average,
      expected: average === null ? 0 : t.perBox * average,
    };
  });
  const expected = tierRows.reduce((n, t) => n + t.expected, 0);
  const shares = tiers.flatMap((t, i) =>
    groups[i]!.map((c) => {
      const perBox = t.perBox / groups[i]!.length;
      return {
        key: c.key,
        perBox,
        expected: perBox * c.value,
        share: expected > 0 ? (perBox * c.value) / expected : 0,
      };
    }),
  );
  shares.sort((a, b) => b.expected - a.expected);

  const runs = input.runs ?? 20_000;
  const next = random(packs * 7919 + Math.round(expected));
  const boxes = new Array<number>(runs);
  const drawn = tiers.flatMap((t, i) => {
    const list = groups[i]!;
    return list.length && t.perBox > 0 ? [{ p: Math.min(1, t.perBox / packs), list }] : [];
  });
  for (let r = 0; r < runs; r++) {
    let value = 0;
    for (const { p, list } of drawn) {
      for (let k = 0; k < packs; k++) {
        if (next() < p) value += list[Math.floor(next() * list.length)]!.value;
      }
    }
    boxes[r] = value;
  }
  boxes.sort((a, b) => a - b);
  const price = input.boxPrice;
  return {
    expected,
    median: at(boxes, 0.5),
    low: at(boxes, 0.1),
    high: at(boxes, 0.9),
    chanceBack: price != null && price > 0 ? boxes.filter((v) => v >= price).length / runs : null,
    tiers: tierRows,
    cards: shares,
  };
}
