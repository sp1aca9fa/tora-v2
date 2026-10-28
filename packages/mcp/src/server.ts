// Tora MCP server (requirements S4b): lets Claude read one user's collection data (read-only),
// for sanity checks, explanations and development feedback. Runs locally over stdio, started by
// Claude Code / Claude Desktop with the repo's .env; nothing is exposed online.
//
//   claude mcp add tora -- pnpm --silent --dir /path/to/tora-v2 mcp --user <username>
//
// stdout carries the protocol: log to stderr only.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { type Db, createDb, getUserByUsername, listUsers, loadTimeZone } from '@tora/db';
import { analysisCopyPath } from '@tora/db/backup';
import { dbConfigFromEnv, isRemoteUrl, loadRootEnv } from '@tora/db/env';
import { exitIfUnmigrated } from '@tora/db/migrate';
import { stat } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import {
  collectorStatus,
  dataChecks,
  listProducts,
  opportunities,
  portfolioSummary,
  priceHistoryOf,
  productDetail,
  querySql,
  reviewQueue,
  sales,
  watchlist,
} from './tools';

const { values } = parseArgs({ options: { user: { type: 'string' } }, strict: false });
loadRootEnv();
// Allowed under Claude Code: these tools read a few hundred rows; query_sql reads the analysis copy.
const config = dbConfigFromEnv(process.env, { allowClaude: true });
const db = createDb(config, 'mcp');
await exitIfUnmigrated(db);
// Times written follow the admin's time zone (S16 part 5).
await loadTimeZone(db);
const username = (values.user as string | undefined) ?? process.env.TORA_USER;
const users = await listUsers(db);
const user = username
  ? await getUserByUsername(db, username.trim().toLowerCase())
  : users.length === 1
    ? users[0]!
    : null;
if (!user) {
  console.error(`Pick a user with --user (one of: ${users.map((u) => u.username).join(', ')})`);
  process.exit(1);
}
console.error(
  `tora mcp: ${user.username} on ${isRemoteUrl(config.url) ? config.url : 'local file'}`,
);

// Heavy queries read last night's backup (unpacked by `pnpm backup`), never Turso (S19); a local
// database file is read directly.
let analysis: { db: Db; mtimeMs: number; asOf: string } | null = null;
async function analysisDb(): Promise<{ db: Db; asOf: string } | null> {
  if (!isRemoteUrl(config.url)) return { db, asOf: 'live' };
  const path = analysisCopyPath();
  const file = await stat(path).catch(() => null);
  if (!file) return null;
  if (analysis?.mtimeMs !== file.mtimeMs) {
    analysis?.db.$client.close();
    analysis = {
      db: createDb({ url: `file:${path}` }),
      mtimeMs: file.mtimeMs,
      asOf: new Date(file.mtimeMs).toISOString(),
    };
  }
  return analysis;
}

const json = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value) }],
});

const server = new McpServer({ name: 'tora', version: '0.1.0' });

server.registerTool(
  'portfolio_summary',
  {
    title: 'Portfolio summary',
    description:
      'Totals (spent, market value, unrealized P/L; opened items keep their cost), breakdown by kind, top products by value, biggest gains / losses, and value over time (first of each month + last 30 days). Yen amounts are integers.',
    inputSchema: {},
  },
  async () => json(await portfolioSummary(db, user.id)),
);

server.registerTool(
  'list_products',
  {
    title: 'List products',
    description:
      'Products the user holds, one row per product (lots combined): units, spent, value, P/L and how the value was computed (method, source, number of sales, window, pooled, confidence). Filters are optional.',
    inputSchema: {
      kind: z
        .string()
        .optional()
        .describe(
          'e.g. single, booster_box, deck, special_set, amiibo, controller, collectors_edition, other',
        ),
      franchise: z.string().optional().describe('e.g. pokemon, one_piece'),
      status: z
        .enum(['owned', 'all'])
        .optional()
        .describe('owned (default) or all lots incl. sold / opened'),
      unvalued: z
        .boolean()
        .optional()
        .describe('only products with lots that have no market value'),
      q: z.string().optional().describe('name contains'),
    },
  },
  async (args) => json(await listProducts(db, user.id, args)),
);

server.registerTool(
  'product_detail',
  {
    title: 'Product detail',
    description:
      'One product: its details, every lot (cost, date, shop, order ID, condition / grade, review flags) with how each lot is valued, its price sources (listing or saved search query, references, learned categories, last collected, sales count) pending link suggestions, its release date (from the set catalog, its own, or its first sale) and how many similar items share its group (same kind, franchise and language; games: kind and platform).',
    inputSchema: { productId: z.string() },
  },
  async ({ productId }) => json(await productDetail(db, user.id, productId)),
);

server.registerTool(
  'price_history',
  {
    title: 'Price history',
    description:
      'Daily sold medians of a product per source and condition bucket (e.g. graded:PSA:10, raw:A, sealed:shrink, cond:new), with the number of sales and how many had an estimated lot size.',
    inputSchema: {
      productId: z.string(),
      bucket: z.string().optional(),
      source: z
        .string()
        .optional()
        .describe('A source key (see the sources the collectors describe)'),
      days: z.number().int().min(1).max(1100).optional().describe('default 365'),
    },
  },
  async ({ productId, ...filter }) => json(await priceHistoryOf(db, productId, filter)),
);

server.registerTool(
  'watchlist',
  {
    title: 'Watchlist',
    description:
      'Items the user watches to buy (not owned yet, or more of): the condition bucket, the target price per unit (base currency, null when none), the note, and the market value now in that condition (method, source, number of sales, window, confidence), and the lowest asking price now in that condition with its source, day and listing count (asks, not sales; from the nightly collect). Also the buy timing: the buy strategy chosen for the type of item, its verdict (good / wait / fair / high / none), the buy zone and the numbers behind it (fair value, 180 / 365-day ranges, 2 / 4 / 12-week trends, days since release, the new-set pattern of similar items). From past prices only, never a sure thing.',
    inputSchema: {},
  },
  async () => json(await watchlist(db, user.id)),
);

server.registerTool(
  'opportunities',
  {
    title: 'Opportunities',
    description:
      "Items worth a look to buy, within their group of similar items (any person's items), best first: the signals on today (line_rising: the set line's 12-week change is +10 % or more; leader / laggard: the item 15 points above / under its rising line; sales_up: sales in 30 days 1.5x the 90 days before; strong_for_age / weak_for_age: the last 90 days against similar items at the same age; quick_rise: the last 14 days 20 % or more above the 60 before; other keys come from signal plug-ins, an admin's strategies), warnings (line_falling, sales_down), and each one's record on the group's past prices (checked 90 days later, how many higher, against buying on any day). Only signals proven (10+ checks, 5+ points better than any day) rank items. Also the lowest ask on the price source and a shop buy price. From past prices only, never a sure thing.",
    inputSchema: {
      itemType: z.string().optional().describe('e.g. sealed, card, game'),
      limit: z.number().int().min(1).max(200).optional().describe('default 30'),
    },
  },
  async (filter) => json(await opportunities(db, filter)),
);

server.registerTool(
  'sales',
  {
    title: 'Collected sales',
    description:
      'Individual collected sales of a product, newest first: price (per unit; lotPriceBase when a lot was divided), condition bucket, kept or left out (and why), listing title, whether the lot size was estimated or the user pasted it, Mercari category, link.',
    inputSchema: {
      productId: z.string(),
      source: z.string().optional(),
      status: z.enum(['kept', 'excluded', 'all']).optional(),
      limit: z.number().int().min(1).max(300).optional().describe('default 50'),
    },
  },
  async ({ productId, ...filter }) => json(await sales(db, productId, filter)),
);

server.registerTool(
  'collector_status',
  {
    title: 'Collector status',
    description:
      'Collector health per source (last runs, stale listings, pending matches, big median moves) and the 10 latest runs with requests and new sales.',
    inputSchema: {},
  },
  async () => json(await collectorStatus(db)),
);

server.registerTool(
  'review_queue',
  {
    title: 'Review queue',
    description:
      'What waits for the user: imported purchases to review (with reasons such as deadline_missed, no_delivery), products with link suggestions to confirm, and how many cards have no grade.',
    inputSchema: {},
  },
  async () => json(await reviewQueue(db, user.id)),
);

server.registerTool(
  'data_checks',
  {
    title: 'Data checks',
    description:
      'Runs the sanity checks and returns findings, each with what it means: unvalued lots, low-confidence or pooled values, look-alike products (duplicates), listings linked to two items, odd recent sales, weak searches, collector health, missing details (card number, set name, picture), estimated lot sizes, imports waiting for review. Start here for "does anything look off?".',
    inputSchema: {},
  },
  async () => json(await dataChecks(db, user.id)),
);

server.registerTool(
  'query_sql',
  {
    title: 'Read-only SQL',
    description:
      'One SELECT (or WITH ... SELECT), run read-only with a row limit, for questions the other tools do not cover. It reads the backup copy from last night (asOf in the result), not the live database: use the other tools for live numbers. Main tables: products, holdings (user_id, product_id, status, quantity, cost_total_base, acquired_at, ...), price_observations (product_id, source, bucket, price_base, observed_at, excluded, excluded_reason, raw JSON), product_sources (product_id, source, external_id, query JSON, state JSON), holding_values (holding_id, user_id, days JSON: date -> [value_base, method, source, samples, confidence, estimated]), holding_events. Times are ISO strings in the app time zone (with its offset).',
    inputSchema: {
      sql: z.string().max(4000),
      limit: z.number().int().min(1).max(1000).optional().describe('default 200'),
    },
  },
  async ({ sql, limit }) => {
    const copy = await analysisDb();
    if (!copy) {
      return json({
        error: `No analysis copy yet (${analysisCopyPath()}): run \`pnpm backup\` on the home PC.`,
      });
    }
    return json({ asOf: copy.asOf, ...(await querySql(copy.db, sql, limit)) });
  },
);

await server.connect(new StdioServerTransport());
