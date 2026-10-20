// Box opening value data (requirements S20): each set's pull rates (the admin's, else the
// suggested ones) and its hit cards with their prices, read once a week by the home PC.
import {
  type PullRates,
  type SuggestedRates,
  localDate,
  suggestedRates,
  toLocalIso,
} from '@tora/core';
import { and, eq, inArray, notInArray, or } from 'drizzle-orm';
import type { Db } from './client';
import { readSetting, saveSetting } from './registry';
import {
  type OpeningCardRow,
  type Product,
  type TcgSet,
  holdings,
  openingCards,
  openingSets,
  products,
  tcgSets,
  watches,
} from './schema';

/** The selling fee taken off every card's price (share, admin setting). */
const FEE_KEY = 'openingFee';
export const DEFAULT_OPENING_FEE = 0.1;
/** When each set's cards were last read, and for which code and rarities. */
const READ_KEY = 'openingCardsRead';
const READ_EVERY_DAYS = 7;

/** The pull rates the plug-ins suggest (saved by the home PC with the other plug-in data). */
const SUGGESTED_KEY = 'suggestedPullRates';

/** Saves the plug-ins' suggested rates (written only when they changed). */
export async function saveSuggestedRates(db: Db, list: SuggestedRates[]): Promise<void> {
  if (JSON.stringify(await readSetting(db, SUGGESTED_KEY)) !== JSON.stringify(list))
    await saveSetting(db, SUGGESTED_KEY, list);
}

export async function suggestedRateList(db: Pick<Db, 'select'>): Promise<SuggestedRates[]> {
  return (await readSetting<SuggestedRates[]>(db, SUGGESTED_KEY)) ?? [];
}

export interface SetRates {
  set: TcgSet;
  rates: PullRates;
  /** The admin's own (false: the suggested rates). */
  saved: boolean;
  updatedAt: string | null;
}

/** The rates of each set (by set id) that has any. */
export async function openingRates(db: Db, setIds: string[]): Promise<Map<string, SetRates>> {
  const out = new Map<string, SetRates>();
  if (!setIds.length) return out;
  const [sets, saved, suggested] = await Promise.all([
    db.select().from(tcgSets).where(inArray(tcgSets.id, setIds)),
    db.select().from(openingSets).where(inArray(openingSets.setId, setIds)),
    suggestedRateList(db),
  ]);
  const own = new Map(saved.map((r) => [r.setId, r]));
  for (const set of sets) {
    const row = own.get(set.id);
    const rates: PullRates | null = row
      ? { code: row.code, packsPerBox: row.packsPerBox, tiers: row.tiers, source: row.source }
      : suggestedRates(set, suggested);
    if (rates) out.set(set.id, { set, rates, saved: !!row, updatedAt: row?.updatedAt ?? null });
  }
  return out;
}

/** Sets of every booster box anyone tracks (the ones the admin page lists). */
export async function boxSets(db: Db): Promise<TcgSet[]> {
  const rows = await db
    .selectDistinct({ set: tcgSets })
    .from(products)
    .innerJoin(tcgSets, eq(tcgSets.id, products.setId))
    .where(eq(products.kind, 'booster_box'));
  return rows
    .map((r) => r.set)
    .sort((a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? ''));
}

export async function saveOpeningRates(db: Db, setId: string, rates: PullRates, userId: string) {
  const values = { ...rates, updatedBy: userId };
  await db
    .insert(openingSets)
    .values({ setId, ...values })
    .onConflictDoUpdate({ target: openingSets.setId, set: { ...values, updatedAt: toLocalIso() } });
}

/** Back to the suggested rates. */
export async function clearOpeningRates(db: Db, setId: string) {
  await db.delete(openingSets).where(eq(openingSets.setId, setId));
}

export async function openingFee(db: Pick<Db, 'select'>): Promise<number> {
  return (await readSetting<number>(db, FEE_KEY)) ?? DEFAULT_OPENING_FEE;
}

export async function setOpeningFee(db: Db, fee: number) {
  await saveSetting(db, FEE_KEY, fee);
}

type ReadLog = Record<string, { day: string; key: string }>;
const readKey = (r: PullRates) =>
  [r.code, ...new Set(r.tiers.map((t) => t.rarity.normalize('NFKC').toUpperCase()))].join('|');

/**
 * Sets whose cards are due: never read, read a week ago or more, or read for another code or
 * other rarities; the ones never read first (newest sets first), then the longest ago.
 */
export async function openingSetsDue(db: Db, now = new Date()): Promise<SetRates[]> {
  const sets = await boxSets(db);
  const rates = await openingRates(
    db,
    sets.map((s) => s.id),
  );
  const log = (await readSetting<ReadLog>(db, READ_KEY)) ?? {};
  const before = localDate(new Date(now.getTime() - READ_EVERY_DAYS * 86_400_000));
  const day = (r: SetRates) => log[r.set.id]?.day ?? '';
  return [...rates.values()]
    .filter((r) => {
      const last = log[r.set.id];
      return !last || last.day <= before || last.key !== readKey(r.rates);
    })
    .sort(
      (a, b) =>
        day(a).localeCompare(day(b)) ||
        (b.set.releaseDate ?? '').localeCompare(a.set.releaseDate ?? ''),
    );
}

export async function markOpeningRead(db: Db, set: SetRates, now = new Date()) {
  const log = (await readSetting<ReadLog>(db, READ_KEY)) ?? {};
  log[set.set.id] = { day: localDate(now), key: readKey(set.rates) };
  await saveSetting(db, READ_KEY, log);
}

export interface FoundSetCard {
  externalId: string;
  name: string;
  number: string | null;
  rarity: string;
  currency: string;
  ask: number | null;
  url: string | null;
}

/**
 * A source's cards of a set as just read: new and known ones saved (their sales kept), the ones
 * no longer found removed.
 */
export async function saveOpeningCards(
  db: Db,
  setId: string,
  source: string,
  cards: FoundSetCard[],
  now = new Date(),
): Promise<void> {
  const readAt = toLocalIso(now);
  for (const c of cards) {
    await db
      .insert(openingCards)
      .values({ setId, source, ...c, readAt })
      .onConflictDoUpdate({
        target: [openingCards.setId, openingCards.source, openingCards.externalId],
        // Sales are read again for the cards that carry the value now.
        set: {
          name: c.name,
          number: c.number,
          rarity: c.rarity,
          currency: c.currency,
          ask: c.ask,
          url: c.url,
          readAt,
          sold: null,
          sales: null,
        },
      });
  }
  const keep = cards.map((c) => c.externalId);
  await db
    .delete(openingCards)
    .where(
      and(
        eq(openingCards.setId, setId),
        eq(openingCards.source, source),
        keep.length ? notInArray(openingCards.externalId, keep) : undefined,
      ),
    );
}

export async function saveCardSales(db: Db, id: string, sold: number | null, sales: number) {
  await db.update(openingCards).set({ sold, sales }).where(eq(openingCards.id, id));
}

export async function openingCardsOf(
  db: Db,
  setIds: string[],
): Promise<Map<string, OpeningCardRow[]>> {
  const out = new Map<string, OpeningCardRow[]>();
  if (!setIds.length) return out;
  for (const row of await db
    .select()
    .from(openingCards)
    .where(inArray(openingCards.setId, setIds))) {
    out.set(row.setId, [...(out.get(row.setId) ?? []), row]);
  }
  return out;
}

/** The booster boxes a person holds or watches. */
export async function trackedBoxes(db: Db, userId: string): Promise<Product[]> {
  return db
    .select()
    .from(products)
    .where(
      and(
        eq(products.kind, 'booster_box'),
        or(
          inArray(
            products.id,
            db
              .select({ id: holdings.productId })
              .from(holdings)
              .where(and(eq(holdings.userId, userId), eq(holdings.status, 'owned'))),
          ),
          inArray(
            products.id,
            db.select({ id: watches.productId }).from(watches).where(eq(watches.userId, userId)),
          ),
        ),
      ),
    );
}
