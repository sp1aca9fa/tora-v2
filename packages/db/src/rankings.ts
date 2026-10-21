// Rankings (requirements S13 part 3): a site's popularity list read once a day by a ranking
// plug-in. Each ranked item is matched to an item Tora knows (by the source's id, else by its set
// or name); the top ones nobody tracks become candidates, created and collected like watched items
// while they stay in the ranking.
import { type Category, type ProductKind, type Region, localDate } from '@tora/core';
import { and, desc, eq, gte, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import type { Db } from './client';
import { createProduct } from './mutations';
import { linkSets, matchSet } from './release';
import { readSetting, saveSetting } from './registry';
import {
  type Product,
  holdings,
  productSources,
  products,
  rankings,
  tcgSets,
  watches,
} from './schema';
import { linkSource } from './sources';

/** Ranked this high, an item nobody tracks becomes a candidate. */
export const CANDIDATE_TOP = 30;
/** A candidate is collected while it was in the top within this many days. */
export const CANDIDATE_DAYS = 30;

const DAY = 86_400_000;

/** A ranking plug-in as Tora needs it (the SDK's `RankingSource` without its reader). */
export interface RankingInfo {
  key: string;
  /** The collector source whose ids the ranked items carry ("snkrdunk"). */
  source: string;
  /** What a candidate made from it is. */
  item: { category: Category; franchise?: string | null; region?: Region | null };
}

/** One ranked item, in rank order. */
export interface RankedEntry {
  externalId: string;
  title: string;
  kind: ProductKind;
  url?: string | null;
  price?: number | null;
  numbers?: Record<string, number>;
  imageUrl?: string | null;
}

/** Names compared without width, spaces or brackets' style. */
const nameKey = (s: string) =>
  s
    .normalize('NFKC')
    .replace(/[\s「」『』]/g, '')
    .toLowerCase();

/**
 * The set a sealed product's title names: in 「」, else between the pack word and the box word
 * ("拡張パック フュージョンアーツ ボックス"), a note in brackets left out.
 */
export function setNameOf(title: string): string | null {
  const t = title.normalize('NFKC');
  const quoted = t.match(/「([^」]+)」/)?.[1];
  if (quoted) return quoted.replace(/\([^)]*\)/g, '').trim() || null;
  const bare = t.match(/パック\s+(.+?)\s*(?:ボックス|BOX)/i)?.[1];
  return bare?.replace(/\([^)]*\)/g, '').trim() || null;
}

/**
 * Saves a day's ranking (a second read the same day replaces it) and makes candidates of the top
 * items nobody tracks. An item is the product linked to its id on the source, else one of the same
 * kind from the same catalog set or with the same name (not linked: matching stays the
 * collectors'), else, in the top, a new candidate linked to the source.
 */
export async function saveRanking(
  db: Db,
  info: RankingInfo,
  items: RankedEntry[],
  now = new Date(),
): Promise<{ saved: number; matched: number; candidates: number }> {
  const day = localDate(now);
  const ids = [...new Set(items.map((i) => i.externalId))];
  const linked = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 200) {
    for (const r of await db
      .select({ externalId: productSources.externalId, productId: productSources.productId })
      .from(productSources)
      .where(
        and(
          eq(productSources.source, info.source),
          inArray(productSources.externalId, ids.slice(i, i + 200)),
        ),
      )) {
      if (r.productId && r.externalId) linked.set(r.externalId, r.productId);
    }
  }
  const known = await db.select().from(products).where(eq(products.category, info.item.category));
  const sets =
    info.item.category === 'tcg'
      ? await db
          .select()
          .from(tcgSets)
          .where(
            and(
              info.item.franchise ? eq(tcgSets.franchise, info.item.franchise) : undefined,
              info.item.region ? eq(tcgSets.region, info.item.region) : undefined,
            ),
          )
      : [];
  /** An item Tora knows of the same kind: same catalog set, else the same name. */
  const sameItem = (entry: RankedEntry): Product | undefined => {
    const setName = setNameOf(entry.title);
    const set = setName
      ? matchSet(
          {
            kind: entry.kind,
            franchise: info.item.franchise ?? null,
            region: info.item.region ?? null,
            setCode: null,
            setName,
          },
          sets,
        ).sure
      : null;
    const sameKind = known.filter((p) => p.kind === entry.kind);
    return (
      (set ? sameKind.find((p) => p.setId === set.id) : undefined) ??
      sameKind.find((p) => nameKey(p.name) === nameKey(entry.title))
    );
  };

  let matched = 0;
  let candidates = 0;
  const made: string[] = [];
  const rows: (typeof rankings.$inferInsert)[] = [];
  for (const [index, entry] of items.entries()) {
    const rank = index + 1;
    let productId = linked.get(entry.externalId) ?? sameItem(entry)?.id ?? null;
    if (productId) matched++;
    else if (rank <= CANDIDATE_TOP) {
      const product = await createProduct(db, null, {
        category: info.item.category,
        kind: entry.kind,
        name: entry.title,
        franchise: info.item.franchise ?? null,
        region: info.item.region ?? null,
      });
      await linkSource(
        db,
        product.id,
        { source: info.source, externalId: entry.externalId, url: entry.url, title: entry.title },
        entry.imageUrl,
      );
      known.push(product);
      made.push(product.id);
      productId = product.id;
      candidates++;
    }
    rows.push({
      ranking: info.key,
      source: info.source,
      day,
      rank,
      externalId: entry.externalId,
      productId,
      title: entry.title,
      url: entry.url ?? null,
      price: entry.price ?? null,
      numbers: entry.numbers ?? null,
    });
  }
  await db.transaction(async (tx) => {
    await tx.delete(rankings).where(and(eq(rankings.ranking, info.key), eq(rankings.day, day)));
    for (let i = 0; i < rows.length; i += 100) {
      await tx.insert(rankings).values(rows.slice(i, i + 100));
    }
  });
  // Candidates take their catalog set (release date, line) at once.
  if (made.length) await linkSets(db, made);
  return { saved: rows.length, matched, candidates };
}

/** Items in a ranking's top within the last 30 days: candidates are collected while there. */
export async function rankedProductIds(
  db: Pick<Db, 'selectDistinct'>,
  now = new Date(),
): Promise<string[]> {
  const since = localDate(new Date(now.getTime() - CANDIDATE_DAYS * DAY));
  const rows = await db
    .selectDistinct({ id: rankings.productId })
    .from(rankings)
    .where(
      and(
        gte(rankings.day, since),
        lte(rankings.rank, CANDIDATE_TOP),
        isNotNull(rankings.productId),
      ),
    );
  return rows.map((r) => r.id!);
}

/** An item's place in a ranking: today's (its last day within 3 days) and a week before. */
export interface RankView {
  ranking: string;
  day: string;
  rank: number;
  /** The rank 7 days before (a day either way), null when not ranked then. */
  weekAgo: number | null;
  url: string | null;
  price: number | null;
  numbers: Record<string, number> | null;
}

/** The latest rank of each item in each ranking (within 3 days), with its rank a week before. */
export async function latestRanks(
  db: Pick<Db, 'select'>,
  productIds: string[],
  now = new Date(),
): Promise<Map<string, RankView[]>> {
  const out = new Map<string, RankView[]>();
  if (!productIds.length) return out;
  const since = localDate(new Date(now.getTime() - 11 * DAY));
  const rows: (typeof rankings.$inferSelect)[] = [];
  for (let i = 0; i < productIds.length; i += 200) {
    rows.push(
      ...(await db
        .select()
        .from(rankings)
        .where(
          and(inArray(rankings.productId, productIds.slice(i, i + 200)), gte(rankings.day, since)),
        )
        .orderBy(desc(rankings.day))),
    );
  }
  const fresh = localDate(new Date(now.getTime() - 3 * DAY));
  const dayNumber = (d: string) => Date.parse(`${d}T00:00:00Z`) / DAY;
  for (const r of rows) {
    if (r.day < fresh) continue;
    const list = out.get(r.productId!) ?? [];
    if (list.some((v) => v.ranking === r.ranking)) continue;
    const before = rows.find(
      (o) =>
        o.productId === r.productId &&
        o.ranking === r.ranking &&
        Math.abs(dayNumber(r.day) - dayNumber(o.day) - 7) <= 1,
    );
    list.push({
      ranking: r.ranking,
      day: r.day,
      rank: r.rank,
      weekAgo: before?.rank ?? null,
      url: r.url,
      price: r.price,
      numbers: r.numbers,
    });
    out.set(r.productId!, list);
  }
  return out;
}

/** When the ranking was last read (any ranking), for the page. */
export async function lastRankingDay(db: Pick<Db, 'select'>): Promise<string | null> {
  const [row] = await db
    .select({ day: rankings.day })
    .from(rankings)
    .orderBy(desc(rankings.day))
    .limit(1);
  return row?.day ?? null;
}

const RANKINGS_KEY = 'rankingSources';

/** Saves the ranking plug-ins' names for the app (only when they changed). */
export async function saveRankingSources(
  db: Db,
  list: { key: string; label: string; source: string }[],
): Promise<void> {
  const had = await readSetting<typeof list>(db, RANKINGS_KEY);
  if (JSON.stringify(had ?? []) !== JSON.stringify(list)) await saveSetting(db, RANKINGS_KEY, list);
}

/** Each ranking's name by its key. */
export async function rankingLabels(db: Pick<Db, 'select'>): Promise<Map<string, string>> {
  const list = await readSetting<{ key: string; label: string }[]>(db, RANKINGS_KEY);
  return new Map((list ?? []).map((r) => [r.key, r.label]));
}

/** A ranking's last day, its items in order with what the person has of each. */
export interface RankingBoard {
  ranking: string;
  label: string;
  day: string;
  items: (RankView & {
    productId: string | null;
    title: string;
    kind: string | null;
    itemType: string | null;
    owned: boolean;
    watching: boolean;
    /** Made by Tora from the ranking (nobody added it). */
    candidate: boolean;
  })[];
}

/** Every ranking's last day (within 3 days), for the Opportunities page. */
export async function rankingBoards(
  db: Db,
  userId: string,
  now = new Date(),
): Promise<RankingBoard[]> {
  const fresh = localDate(new Date(now.getTime() - 3 * DAY));
  const last = await db
    .select({ ranking: rankings.ranking, day: sql<string>`max(${rankings.day})` })
    .from(rankings)
    .where(gte(rankings.day, fresh))
    .groupBy(rankings.ranking);
  if (!last.length) return [];
  const labels = await rankingLabels(db);
  const [owned, watched] = await Promise.all([
    db
      .selectDistinct({ id: holdings.productId })
      .from(holdings)
      .where(and(eq(holdings.userId, userId), eq(holdings.status, 'owned'))),
    db.selectDistinct({ id: watches.productId }).from(watches).where(eq(watches.userId, userId)),
  ]);
  const own = new Set(owned.map((r) => r.id));
  const watching = new Set(watched.map((r) => r.id));
  const boards: RankingBoard[] = [];
  for (const { ranking, day } of last) {
    const rows = await db
      .select({ row: rankings, product: products })
      .from(rankings)
      .leftJoin(products, eq(products.id, rankings.productId))
      .where(and(eq(rankings.ranking, ranking), eq(rankings.day, day)))
      .orderBy(rankings.rank);
    const ids = rows.flatMap((r) => (r.row.productId ? [r.row.productId] : []));
    const ranks = await latestRanks(db, ids, now);
    boards.push({
      ranking,
      label: labels.get(ranking) ?? ranking,
      day,
      items: rows.map(({ row, product }) => {
        const view = row.productId
          ? ranks.get(row.productId)?.find((v) => v.ranking === ranking)
          : undefined;
        return {
          ranking,
          day,
          rank: row.rank,
          weekAgo: view?.weekAgo ?? null,
          url: row.url,
          price: row.price,
          numbers: row.numbers,
          productId: row.productId,
          title: product?.name ?? row.title,
          kind: product?.kind ?? null,
          itemType: product?.itemType ?? null,
          owned: !!row.productId && own.has(row.productId),
          watching: !!row.productId && watching.has(row.productId),
          candidate: !!product && !product.createdBy,
        };
      }),
    });
  }
  return boards;
}
