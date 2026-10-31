// "Download my data" (requirements S6): an account's own data as one JSON file. Collected sale
// prices are left out (other sites' terms, eBay's among them, do not allow passing them on); each
// lot carries its current value instead. Sign-in secrets are never included.
import { appTimeZone, baseCurrency, newId } from '@tora/core';
import { type Table, asc, eq, getTableColumns, inArray } from 'drizzle-orm';
import type { Db } from './client';
import { loadSourceRegistry } from './registry';
import {
  LOTTERY_MARKS,
  canceledOrders,
  holdingEvents,
  holdings,
  importRuns,
  lotteryMarks,
  manualPrices,
  productSources,
  products,
  purchaseLinks,
  storePosts,
  tcgSets,
  users,
  watches,
} from './schema';
import { portfolioValuation } from './valuation';

export const ACCOUNT_DATA_FORMAT = 'tora-account';
export const ACCOUNT_DATA_VERSION = 1;

export async function accountData(db: Db, userId: string, now = new Date()) {
  const registry = await loadSourceRegistry(db);
  const [user] = await db
    .select({
      username: users.username,
      role: users.role,
      preferences: users.preferences,
      noticeLevels: users.noticeLevels,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, userId));
  const lots = await db
    .select()
    .from(holdings)
    .where(eq(holdings.userId, userId))
    .orderBy(asc(holdings.acquiredAt), asc(holdings.createdAt));
  const lotIds = lots.map((l) => l.id);
  const manual = await db.select().from(manualPrices).where(eq(manualPrices.userId, userId));
  const watched = await db.select().from(watches).where(eq(watches.userId, userId));
  const productIds = [
    ...new Set([
      ...lots.map((l) => l.productId),
      ...manual.map((m) => m.productId),
      ...watched.map((w) => w.productId),
    ]),
  ];
  const items = productIds.length
    ? await db
        .select()
        .from(products)
        .where(inArray(products.id, productIds))
        .orderBy(asc(products.name))
    : [];
  const history = lotIds.length
    ? await db
        .select()
        .from(holdingEvents)
        .where(inArray(holdingEvents.holdingId, lotIds))
        .orderBy(asc(holdingEvents.occurredAt))
    : [];
  // Which listings each item is linked to; their collected sales and progress stay out.
  const listings = productIds.length
    ? await db
        .select({
          id: productSources.id,
          productId: productSources.productId,
          source: productSources.source,
          externalId: productSources.externalId,
          title: productSources.title,
          url: productSources.url,
          active: productSources.active,
        })
        .from(productSources)
        .where(inArray(productSources.productId, productIds))
    : [];
  const values = new Map(
    (await portfolioValuation(db, userId, now)).rows.map((r) => [r.holding.id, r.valuation]),
  );
  return {
    format: ACCOUNT_DATA_FORMAT,
    version: ACCOUNT_DATA_VERSION,
    exportedAt: now.toISOString(),
    app: { baseCurrency: baseCurrency(registry), timeZone: appTimeZone() },
    account: user ?? null,
    items,
    lots: lots.map((l) => {
      const v = values.get(l.id);
      return {
        ...l,
        currentValueBase: v?.valueBase ?? null,
        valueMethod: v?.method ?? null,
      };
    }),
    history,
    manualPrices: manual,
    watches: watched,
    listings,
    importRuns: await db.select().from(importRuns).where(eq(importRuns.userId, userId)),
    purchaseLinks: await db.select().from(purchaseLinks).where(eq(purchaseLinks.userId, userId)),
    canceledOrders: await db.select().from(canceledOrders).where(eq(canceledOrders.userId, userId)),
    // Marks on lottery posts (posts are the install's and kept 30 days: a load skips those gone).
    lotteryMarks: await db
      .select({
        postId: lotteryMarks.postId,
        mark: lotteryMarks.mark,
        updatedAt: lotteryMarks.updatedAt,
      })
      .from(lotteryMarks)
      .where(eq(lotteryMarks.userId, userId)),
  };
}

/** No lots, watches or manual prices: a download can be loaded into it. */
export async function accountIsEmpty(db: Pick<Db, 'select'>, userId: string): Promise<boolean> {
  for (const table of [holdings, watches, manualPrices]) {
    const [any] = await db
      .select({ id: table.id })
      .from(table)
      .where(eq(table.userId, userId))
      .limit(1);
    if (any) return false;
  }
  return true;
}

export type AccountLoadError = 'format' | 'version' | 'currency' | 'notEmpty';

export interface AccountLoadResult {
  /** Items in the file, and those this install did not have (added). */
  items: number;
  itemsAdded: number;
  lots: number;
  history: number;
  watches: number;
  manualPrices: number;
}

type Row = Record<string, unknown>;

/** The rows of `key` in the file (an array of objects with an id, else none). */
const rowsOf = (data: Row, key: string): Row[] =>
  Array.isArray(data[key])
    ? (data[key] as unknown[]).filter(
        (r): r is Row => !!r && typeof r === 'object' && typeof (r as Row).id === 'string',
      )
    : [];

/** Only the table's own columns (the file adds a lot's value, which is worked out again). */
function columnsOf(table: Table, row: Row): Row {
  const out: Row = {};
  for (const key of Object.keys(getTableColumns(table))) if (key in row) out[key] = row[key];
  return out;
}

/**
 * Loads a "Download my data" file into an empty account (requirements S15, S6's "later"): moving
 * an account to another install, or back after a reset. The person's rows get new ids (the same
 * install may still hold the originals), every id inside them is renamed to match; items this
 * install has are used as they are, others are added with their listings (the next collect fetches
 * their sales). Amounts are in the file's base currency, so it must be this install's. All or
 * nothing.
 */
export async function loadAccountData(
  db: Db,
  userId: string,
  file: unknown,
): Promise<AccountLoadResult | { error: AccountLoadError }> {
  if (!file || typeof file !== 'object') return { error: 'format' };
  const data = file as Row;
  if (data.format !== ACCOUNT_DATA_FORMAT) return { error: 'format' };
  if (data.version !== ACCOUNT_DATA_VERSION) return { error: 'version' };
  const registry = await loadSourceRegistry(db);
  const app = data.app as { baseCurrency?: unknown } | undefined;
  if (app?.baseCurrency !== baseCurrency(registry)) return { error: 'currency' };
  if (!(await accountIsEmpty(db, userId))) return { error: 'notEmpty' };

  const items = rowsOf(data, 'items');
  // References stay inside the file: a lot, its history and its links point only at the file's own
  // lots and imports (an id of someone else's lot on this install would reach into their data).
  const fileLots = new Set(rowsOf(data, 'lots').map((l) => l.id as string));
  const fileRuns = new Set(rowsOf(data, 'importRuns').map((r) => r.id as string));
  const inFile = (set: Set<string>, value: unknown) =>
    typeof value === 'string' && set.has(value) ? value : null;
  const lots = rowsOf(data, 'lots').map((l): Row => ({
    ...l,
    parentHoldingId: inFile(fileLots, l.parentHoldingId),
    importRunId: inFile(fileRuns, l.importRunId),
  }));
  const history = rowsOf(data, 'history').filter((e) => inFile(fileLots, e.holdingId));
  const manual = rowsOf(data, 'manualPrices');
  const watched = rowsOf(data, 'watches');
  // Files saved before 2026-10-26 spell `cancelled` (the orders, an import's count).
  const runs = rowsOf(data, 'importRuns').map((r) => {
    const counts = r.counts as Record<string, number> | undefined;
    if (!counts || !('cancelled' in counts)) return r;
    const { cancelled, ...rest } = counts;
    return { ...r, counts: { ...rest, canceled: cancelled } };
  });
  const links = rowsOf(data, 'purchaseLinks').map((l): Row => ({
    ...l,
    holdingId: inFile(fileLots, l.holdingId),
    importRunId: inFile(fileRuns, l.importRunId),
  }));
  const canceled = [...rowsOf(data, 'canceledOrders'), ...rowsOf(data, 'cancelledOrders')];

  // New ids for the person's rows; any string equal to an old one (a lot's box, a split's other
  // side in its history) is renamed with it.
  const ids = new Map<string, string>();
  for (const r of [...lots, ...history, ...manual, ...watched, ...runs, ...links, ...canceled]) {
    ids.set(r.id as string, newId());
  }
  const rename = (value: unknown): unknown => {
    if (typeof value === 'string') return ids.get(value) ?? value;
    if (Array.isArray(value)) return value.map(rename);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rename(v)]));
    }
    return value;
  };
  const own = (table: Table, row: Row) => ({ ...columnsOf(table, rename(row) as Row), userId });

  const itemIds = items.map((i) => i.id as string);
  const present = new Set<string>();
  for (let i = 0; i < itemIds.length; i += 500) {
    const chunk = itemIds.slice(i, i + 500);
    for (const p of await db
      .select({ id: products.id })
      .from(products)
      .where(inArray(products.id, chunk))) {
      present.add(p.id);
    }
  }
  const setIds = new Set((await db.select({ id: tcgSets.id }).from(tcgSets)).map((s) => s.id));
  const added = items.filter((i) => !present.has(i.id as string));
  const addedIds = new Set(added.map((i) => i.id as string));
  const listings = rowsOf(data, 'listings').filter((l) => addedIds.has(l.productId as string));
  // Lottery marks (no id of their own), on posts this install still has.
  const marks = (Array.isArray(data.lotteryMarks) ? (data.lotteryMarks as unknown[]) : []).filter(
    (m): m is Row =>
      !!m &&
      typeof m === 'object' &&
      typeof (m as Row).postId === 'string' &&
      typeof (m as Row).updatedAt === 'string' &&
      (LOTTERY_MARKS as readonly unknown[]).includes((m as Row).mark),
  );
  const posts = new Set<string>();
  const postIds = [...new Set(marks.map((m) => m.postId as string))];
  for (let i = 0; i < postIds.length; i += 500) {
    for (const p of await db
      .select({ id: storePosts.id })
      .from(storePosts)
      .where(inArray(storePosts.id, postIds.slice(i, i + 500)))) {
      posts.add(p.id);
    }
  }

  // Boxes before the pulls taken from them.
  const order = (rows: Row[]) => {
    const done = new Set<string>();
    const out: Row[] = [];
    let left = rows;
    while (left.length) {
      const ready = left.filter(
        (r) =>
          !r.parentHoldingId ||
          done.has(r.parentHoldingId as string) ||
          !lots.some((l) => l.id === r.parentHoldingId),
      );
      if (!ready.length) break;
      for (const r of ready) done.add(r.id as string);
      out.push(...ready);
      left = left.filter((r) => !done.has(r.id as string));
    }
    return [...out, ...left];
  };

  // Rows a unique index may already hold (canceled orders, purchase links and lottery marks are
  // not part of "empty") are kept as they are.
  const insert = async (
    tx: Pick<Db, 'insert'>,
    table: Table,
    rows: Row[],
    keepExisting = false,
  ) => {
    for (let i = 0; i < rows.length; i += 50) {
      const values = tx.insert(table).values(rows.slice(i, i + 50) as never);
      await (keepExisting ? values.onConflictDoNothing() : values);
    }
  };
  // Checked again inside the write transaction: two tabs loading the same file load it once.
  // The transaction takes the write lock at its start (drizzle's libsql driver opens every one in
  // libsql's "write" mode, BEGIN IMMEDIATE, and ignores `{ behavior }`), so the second tab waits
  // for the first and then finds the account filled, rather than failing on a lock upgrade.
  const notEmpty = new Error('notEmpty');
  try {
    await db.transaction(async (tx) => {
      if (!(await accountIsEmpty(tx, userId))) throw notEmpty;
      await insert(
        tx,
        products,
        added.map((p) => ({
          ...columnsOf(products, p),
          createdBy: userId,
          setId: p.setId && setIds.has(p.setId as string) ? p.setId : null,
        })),
      );
      await insert(
        tx,
        productSources,
        listings.map((l) => ({ ...columnsOf(productSources, l), id: newId() })),
      );
      await insert(
        tx,
        importRuns,
        runs.map((r) => own(importRuns, r)),
      );
      await insert(
        tx,
        holdings,
        order(lots).map((l) => own(holdings, l)),
      );
      await insert(
        tx,
        holdingEvents,
        history.map((e) => columnsOf(holdingEvents, rename(e) as Row)),
      );
      await insert(
        tx,
        manualPrices,
        manual.map((m) => own(manualPrices, m)),
      );
      await insert(
        tx,
        watches,
        watched.map((w) => own(watches, w)),
      );
      await insert(
        tx,
        purchaseLinks,
        links.map((l) => own(purchaseLinks, l)),
        true,
      );
      await insert(
        tx,
        canceledOrders,
        canceled.map((c) => own(canceledOrders, c)),
        true,
      );
      await insert(
        tx,
        lotteryMarks,
        marks
          .filter((m) => posts.has(m.postId as string))
          .map((m) => ({ ...columnsOf(lotteryMarks, m), userId })),
        true,
      );
      const account = data.account as { preferences?: unknown; noticeLevels?: unknown } | null;
      if (account) {
        await tx
          .update(users)
          .set(
            columnsOf(users, {
              preferences: rename(account.preferences ?? null),
              noticeLevels: account.noticeLevels ?? null,
            }),
          )
          .where(eq(users.id, userId));
      }
    });
  } catch (error) {
    if (error === notEmpty) return { error: 'notEmpty' };
    throw error;
  }
  return {
    items: items.length,
    itemsAdded: added.length,
    lots: lots.length,
    history: history.length,
    watches: watched.length,
    manualPrices: manual.length,
  };
}
