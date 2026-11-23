// Whether a lowest ask may be used (requirements S36 Scope rule, Terms "Checked listing" and
// "Confirmed", step A2's first sentence): a game's ask from a search-based marketplace is mostly not
// the game, so until that source's listings are confirmed for the item it is "unverified": shown,
// labeled, and used for nothing (no gap to a target, no sort, no signal, no deal list, no alert).
// Cards and sealed products are never games: their asks are used as before.
import { type GameItem, type ItemRulesRow, isGameItem } from '@tora/core';
import { inArray } from 'drizzle-orm';
import type { Db } from './client';
import { type Confirmations, confirmationsMany } from './item-rules';
import { type ProductSource, type Supply, productSources } from './schema';
import { QUERY_SOURCE_ID } from './sources';

/**
 * - `not_game`: the item is not a game (S36 Scope rule): nothing changes for it.
 * - `checked`: a game's ask from a source linked by the item's own page there (S36 Terms "Checked
 *   listing": checked by that link), or from a source whose listings are confirmed for the item.
 * - `unverified`: a game's ask from a saved search at a source not confirmed for the item.
 */
export type AskStatus = 'not_game' | 'checked' | 'unverified';

type Link = Pick<ProductSource, 'source' | 'query' | 'externalId' | 'active'>;

/**
 * A link is a search (not the item's own page) when it is a saved search (`externalId` is
 * `QUERY_SOURCE_ID`, as everywhere else in the code) or carries a stored query (the runner may write
 * one onto any link it searched with).
 */
const isSearch = (l: Link) => l.externalId === QUERY_SOURCE_ID || l.query != null;

/**
 * The status of the ask a supply row reports. `links` are the item's links (any source; only the
 * row's active ones count: a link set aside reads nothing). A source is checked by its links only
 * when every active link of the item there is an item page: a search beside it may be where the ask
 * came from. A game with no active link at the row's source (unknown) is unverified unless confirmed.
 */
export function askStatus(
  product: Pick<GameItem, 'category' | 'kind'>,
  rules: Pick<ItemRulesRow, 'gameRules'> | null | undefined,
  row: Pick<Supply, 'source'>,
  links: readonly Link[],
  confirmations: Pick<Confirmations, 'isConfirmed'> | null | undefined,
): AskStatus {
  if (!isGameItem(product, rules)) return 'not_game';
  const here = links.filter((l) => l.active && l.source === row.source);
  if (here.length > 0 && !here.some(isSearch)) return 'checked';
  if (confirmations?.isConfirmed('listings', row.source)) return 'checked';
  return 'unverified';
}

/**
 * Platform and region are required (null when the item has none): both decide the item's rules and
 * so the hash a confirmation is read under; a projection without them must not compile.
 */
type AskItem = Pick<GameItem, 'category' | 'kind'> & {
  id: string;
  platform: string | null;
  region: string | null;
};

/** The batched form: every item of a page or a job read at once (`askChecks`). */
export interface AskChecks {
  /** Whether the item (passed to `askChecks`) is a game by its rules: only a game's asks can be unverified. */
  isGame(productId: string): boolean;
  /** The status of the ask of `row` (an item passed to `askChecks`). */
  status(row: Pick<Supply, 'productId' | 'source'>): AskStatus;
  /** The rows whose ask may be used: all of them but the unverified ones. */
  usable<T extends Pick<Supply, 'productId' | 'source'>>(rows: readonly T[]): T[];
}

/**
 * `askStatus` for many items in a few batched reads (S19: never one read per row). Only items of the
 * game category can be games, so a page with none reads nothing. Asking about an item not passed in
 * is a mistake in the caller, never a guess: it throws.
 */
export async function askChecks(
  db: Pick<Db, 'select'>,
  items: readonly AskItem[],
): Promise<AskChecks> {
  const byId = new Map(items.map((p) => [p.id, p]));
  // Items of the game category, whatever their kind: their own rules may turn the game rules on.
  const maybe = [...byId.values()].filter((p) => isGameItem(p, { gameRules: 1 }));
  const known = await confirmationsMany(db, maybe);
  const games = maybe.filter((p) => isGameItem(p, known.get(p.id)?.rules)).map((p) => p.id);
  const links = new Map<string, Link[]>();
  for (let i = 0; i < games.length; i += 500) {
    for (const l of await db
      .select({
        productId: productSources.productId,
        source: productSources.source,
        query: productSources.query,
        externalId: productSources.externalId,
        active: productSources.active,
      })
      .from(productSources)
      .where(inArray(productSources.productId, games.slice(i, i + 500)))) {
      links.set(l.productId, [...(links.get(l.productId) ?? []), l]);
    }
  }
  const status = (row: Pick<Supply, 'productId' | 'source'>): AskStatus => {
    const item = byId.get(row.productId);
    if (!item) throw new Error(`askChecks: item ${row.productId} was not read`);
    const k = known.get(row.productId);
    return askStatus(item, k?.rules, row, links.get(row.productId) ?? [], k?.confirmations);
  };
  const gameIds = new Set(games);
  return {
    isGame: (productId) => {
      if (!byId.has(productId)) throw new Error(`askChecks: item ${productId} was not read`);
      return gameIds.has(productId);
    },
    status,
    usable: (rows) => rows.filter((r) => status(r) !== 'unverified'),
  };
}

/** In one condition, the ask to act on and the unverified one to mention (`chooseAsk`). */
export interface AskChoice<T> {
  /** The cheapest usable ask (checked, or any ask of an item that is not a game); null: none. */
  ask: T | null;
  /**
   * The cheapest unverified ask when it is cheaper than `ask` or there is no `ask`; else null. Shown
   * muted and labeled, never as a price to act on (S36 A2).
   */
  unverified: T | null;
}

/**
 * From an item's ask rows (any sources), in `bucket`: the price to act on and the unverified one to
 * mention. Pure; `status` is `AskChecks.status`, or the same answer from what a page already knows.
 * For an item that is not a game no row is unverified, so `ask` is exactly `lowestAsk(rows, bucket)`
 * (the first of the cheapest) and `unverified` is null. Rows without a price are skipped.
 */
export function chooseAsk<T extends Pick<Supply, 'bucket' | 'lowestAskBase'>>(
  rows: readonly T[],
  bucket: string,
  status: (row: T) => AskStatus,
): AskChoice<T> {
  let ask: T | null = null;
  let unverified: T | null = null;
  for (const r of rows) {
    if (r.bucket !== bucket || r.lowestAskBase === null) continue;
    if (status(r) === 'unverified') {
      if (!unverified || r.lowestAskBase < unverified.lowestAskBase!) unverified = r;
    } else if (!ask || r.lowestAskBase < ask.lowestAskBase!) ask = r;
  }
  if (ask && unverified && unverified.lowestAskBase! >= ask.lowestAskBase!) unverified = null;
  return { ask, unverified };
}
