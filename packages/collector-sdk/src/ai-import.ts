// Import purchases from any shop through Claude (requirements S4c). The user drops what they have
// (screenshots of an order list, PDFs, CSV or copied text) in a folder; Haiku reads the files and
// lists every purchase, matched to the user's products or described as a new one. The code then
// checks each row with signals it computes itself (missing price or date, a product match the
// title does not support, a price far from the product's value, the model saying it is unsure),
// and Sonnet reads again the files with flagged rows. What remains goes through the same import
// plan as receipt emails and lands in Review import.
import { createHash } from 'node:crypto';
import {
  type Category,
  EMPTY_REGISTRY,
  type Grader,
  GRADERS,
  BUILT_IN_CATEGORIES,
  pickName,
  type ProductKind,
  type Region,
  type SourceRegistry,
  baseCurrency,
  shopOf,
  sourceName,
  toMinor,
  localTime,
  toLocalIso,
} from '@tora/core';
import {
  type Db,
  type Product,
  type ProductInput,
  holdingsWithProducts,
  loadSourceRegistry,
  schema,
} from '@tora/db';
import { eq } from 'drizzle-orm';
import type { ClaudeResult, ModelAlias } from './claude';
import { termCoverage } from './match';
import type { PurchaseImporter, PurchaseReceipt } from './types';

export const FILE_TYPES = /\.(png|jpe?g|webp|gif|pdf|txt|csv|tsv|html?|md|json|eml)$/i;
/** Files per Haiku call (each image is read with the Read tool). */
export const BATCH = 6;

export interface ExtractedRow {
  file: string;
  shop: string;
  orderId: string | null;
  title: string;
  url: string | null;
  /** Total paid for this item (shipping and fees included when shown), as shown (e.g. 12.5). */
  price: number | null;
  /** ISO 4217 code of the price when the page shows it; null: the shop's currency. */
  currency?: string | null;
  quantity: number;
  /** YYYY-MM-DD */
  date: string | null;
  dateApprox: boolean;
  status: 'purchased' | 'cancelled' | 'not_purchase';
  collectible: boolean;
  /** An existing product of the user's (from the list given to the model). */
  productId: string | null;
  product: NewProduct | null;
  /** "PSA 10" when the item is a graded slab. */
  gradedAs: string | null;
  sealedState: 'shrink' | 'no_shrink' | null;
  unsure: string | null;
  /** Rows of different files the model thinks are one purchase share this tag. */
  samePurchase?: string | null;
  sameConfidence?: number | null;
}

interface NewProduct {
  category: Category;
  kind: ProductKind;
  name: string;
  franchise: string | null;
  setName: string | null;
  setCode: string | null;
  cardNumber: string | null;
  rarity: string | null;
  platform: string | null;
  region: string | null;
}

const str = { type: ['string', 'null'] };

/** The categories a new product may be in: the admin's (S16), else the built-in TCG and games. */
const categoriesOf = (registry: SourceRegistry) =>
  (registry.taxonomy?.categories ?? BUILT_IN_CATEGORIES).filter((c) => !c.hidden);

/** The rows' JSON schema, with the admin's categories and kinds. */
export const rowsSchema = (registry: SourceRegistry = EMPTY_REGISTRY) => {
  const categories = categoriesOf(registry);
  const kinds = [
    ...new Set(categories.flatMap((c) => c.kinds.filter((k) => !k.hidden).map((k) => k.key))),
  ];
  return {
    ...ROWS_SCHEMA,
    properties: {
      rows: {
        ...ROWS_SCHEMA.properties.rows,
        items: {
          ...ROWS_SCHEMA.properties.rows.items,
          properties: {
            ...ROWS_SCHEMA.properties.rows.items.properties,
            product: {
              ...ROWS_SCHEMA.properties.rows.items.properties.product,
              properties: {
                ...ROWS_SCHEMA.properties.rows.items.properties.product.properties,
                category: { type: 'string', enum: categories.map((c) => c.key) },
                kind: { type: 'string', enum: kinds },
              },
            },
          },
        },
      },
    },
  };
};

/** "watch (Watches): kinds wrist (Wristwatch)": the admin's own categories, for the prompt. */
function ownCategories(registry: SourceRegistry): string {
  const name = (names: Record<string, string> | undefined, key: string) => {
    const n = pickName(names, 'en', key);
    return n === key ? key : `${key} (${n})`;
  };
  return categoriesOf(registry)
    .filter((c) => !BUILT_IN_CATEGORIES.some((b) => b.key === c.key))
    .map(
      (c) =>
        `${name(c.names, c.key)}: kinds ${c.kinds
          .filter((k) => !k.hidden)
          .map((k) => name(k.names, k.key))
          .join(', ')}`,
    )
    .join('; ');
}

const ROWS_SCHEMA = {
  type: 'object',
  properties: {
    rows: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          shop: { type: 'string' },
          orderId: str,
          title: { type: 'string' },
          url: str,
          price: { type: ['number', 'null'] },
          currency: str,
          quantity: { type: 'integer' },
          date: str,
          dateApprox: { type: 'boolean' },
          status: { type: 'string', enum: ['purchased', 'cancelled', 'not_purchase'] },
          collectible: { type: 'boolean' },
          productId: str,
          product: {
            type: ['object', 'null'],
            properties: {
              // The admin's categories and kinds: see `rowsSchema`.
              category: { type: 'string' },
              kind: { type: 'string' },
              name: { type: 'string' },
              franchise: str,
              setName: str,
              setCode: str,
              cardNumber: str,
              rarity: str,
              platform: str,
              region: str,
            },
            required: ['category', 'kind', 'name'],
          },
          gradedAs: str,
          sealedState: { type: ['string', 'null'], enum: ['shrink', 'no_shrink', null] },
          unsure: str,
          samePurchase: str,
          sameConfidence: { type: ['number', 'null'] },
        },
        required: [
          'file',
          'shop',
          'orderId',
          'title',
          'price',
          'currency',
          'quantity',
          'date',
          'dateApprox',
          'status',
          'collectible',
          'productId',
          'product',
          'unsure',
        ],
      },
    },
  },
  required: ['rows'],
};

const PAIRS_SCHEMA = {
  type: 'object',
  properties: {
    pairs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          pair: { type: 'integer' },
          same: { type: 'boolean' },
          confidence: { type: 'number' },
        },
        required: ['pair', 'same', 'confidence'],
      },
    },
  },
  required: ['pairs'],
};

/** "snkrdunk (スニダン), ..., " from the described shops' aliases, for the reader's prompt. */
function shopList(registry: SourceRegistry): string {
  const shops = registry.sources.filter((s) => s.aliases?.length);
  return shops
    .map((s) => {
      const names = (s.aliases ?? []).filter((a) => a.toLowerCase() !== s.key);
      return `${s.key}${names.length ? ` (${names.join(' / ')})` : ''}, `;
    })
    .join('');
}

/** "; SNKRDUNK: 取引ID ..." from the described shops' ID hints. */
function idHints(registry: SourceRegistry): string {
  return registry.sources
    .filter((s) => s.orderIds?.hint)
    .map((s) => `; ${s.label}: ${s.orderIds!.hint}`)
    .join('');
}

export const EXTRACT_SYSTEM = `You read a collector's purchase history from Japanese shops (screenshots of order lists or order pages, PDFs, CSV or copied text) and list every item they bought, as JSON. You never invent data: a field that is not shown is null.`;

export function extractPrompt(
  files: string[],
  products: ProductLine[],
  hints?: { rows: ExtractedRow[]; flags: Record<string, string[]> },
  registry: SourceRegistry = EMPTY_REGISTRY,
): string {
  const own = ownCategories(registry);
  return `Open each of these files with the Read tool (they are in the current folder) and list every item bought in them:
${files.map((f) => `- ${f}`).join('\n')}

These files show things the user bought: a sold listing page or an order page is their purchase. Only rows that clearly show the user's own sales (売上, 出品した商品, 販売履歴) are "not_purchase".

One file may hold several purchases (an order list): one row each. One purchase may also be shown in several files (a listing page with the full title and description, and an order or transaction page with the date, order ID and amount paid; or a list and an order detail page): give each file's view its own row, with the same samePurchase tag (e.g. "p1") on the rows you think are one purchase, and sameConfidence (0 to 1) for how sure you are. They are one purchase when the item matches (same picture, a cut-off title that starts like the full one) and nothing disagrees (price, date, order ID).

One row per distinct item in an order. Several of the same item are one row with quantity: a set of N of the same item (N個セット, N枚セット, ×N, N点 of one item) has quantity N and the item's name without the count. For each row:
- file: the file it is in.
- samePurchase, sameConfidence: see above; null when the purchase is shown in one file only.
- shop: ${shopList(registry)}or the shop's name in lowercase.
- orderId: exactly as shown (an order number, transaction ID or item ID${idHints(registry)}); null when none is shown.
- title: the item's title as shown. url: when shown.
- price: what was paid for this item: item price plus shipping and fees when charged separately, minus coupons and discounts (クーポン利用, 割引). Points or balance used to pay (メルペイ残高, ポイント利用, PayPay) are a way of paying, not a discount. The item price when that is all there is. Several items in one order: each item's own price.
- currency: the ISO 4217 code of that price when the page shows it (¥ or 円: JPY; $ on a US site: USD; €: EUR), else null.
- quantity: number of copies (1 unless shown or the title says a set of N of the same item).
- date: the order / purchase date as YYYY-MM-DD (購入日時, 注文日). An order date missing its year: your best guess with dateApprox true. A listing page's age or update time (半年以上前, 3日前, 更新) is not the purchase date: null. Not shown at all: null.
- status: "cancelled" for cancelled or returned orders (キャンセル, 返品, 返金済み); "not_purchase" for anything that was not bought (recommendations, ads, items sold rather than bought).
- collectible: true for trading cards (singles, boxes, packs, decks, sets, card supplies), video games, consoles, controllers, amiibo and figures${own ? ', and items of the other categories below' : ''}; false for anything else.
- productId: when the item is clearly one of the user's products listed below (same card name and number, same box or set, same game and platform), its id; else null.
- product: for a collectible with no productId, the new product: category "tcg" (trading cards) or "game" (games, consoles, controllers, amiibo, figures); kind ("supply" for sleeves (スリーブ, デッキシールド), deck cases, playmats and loaders; "deck" only for a playable deck of cards); name (the item's own name, without seller words like 美品, 送料無料, 即購入OK, 匿名配送, "X様専用"); franchise (pokemon, one_piece, yugioh, ...); setName; setCode (e.g. SV2a, M-P); cardNumber (e.g. 206/165, or 208 for a promo 208/S-P); rarity (SAR, AR, SR, P, ...); platform for games (switch, switch2, ps5, ps4, n64, ...); region: one of jp, en, zh_cn, zh_tw, kr, other ("jp" unless the item itself is an English or other-language version, 英語版 / 海外版; where it was sold does not matter). Null for non-collectibles.${own ? `\n  Other categories (category: its kinds): ${own}. Their items have only category, kind and name; the other fields are null.` : ''}
- gradedAs: "PSA 10" (grader and grade) when the item is a graded slab; else null.
- sealedState: for sealed boxes and packs, "shrink" or "no_shrink" when the title says (シュリンク付き / シュリンクなし); else null.
- unsure: null, or a short reason when you guessed a field from what is shown. A field that is simply not shown is null and is not a reason to be unsure.

The user's products:
${JSON.stringify(products)}
${
  hints
    ? `
A first reading of these files, with the problems the checks found (fix them; keep what is right):
${JSON.stringify(hints)}
`
    : ''
}`;
}

/** What the model sees of a product to match against. */
export interface ProductLine {
  id: string;
  name: string;
  kind: string;
  setCode: string | null;
  cardNumber: string | null;
  rarity: string | null;
  platform: string | null;
}

export const productLine = (p: Product): ProductLine => ({
  id: p.id,
  name: p.name,
  kind: p.kind,
  setCode: p.setCode,
  cardNumber: p.cardNumber,
  rarity: p.rarity,
  platform: p.platform,
});

export const fileHash = (content: Buffer) =>
  createHash('sha256').update(content).digest('hex').slice(0, 32);

// ---------------------------------------------------------------------------------------------
// Checks the code computes (not the model's own confidence)

export type RowFlag =
  | 'unsure'
  | 'no_price'
  | 'no_date'
  | 'odd_quantity'
  | 'unknown_product'
  | 'weak_match'
  | 'maybe_registered'
  | 'price_far'
  /** Maybe the same purchase as a row of another file: the user merges them in review. */
  | 'maybe_same';

export interface CheckContext {
  products: Map<string, Product>;
  /** Order IDs of the user's lots: rows with one are already registered, nothing to check. */
  orderIds: Set<string>;
  /** Unit value of each product the user holds (latest snapshot), for "price far from value". */
  unitValue: Map<string, number>;
  /** Shops and sources the plug-ins describe (names, aliases, ID shapes). */
  registry?: SourceRegistry;
}

const fold = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, '');

export function checkRow(row: ExtractedRow, ctx: CheckContext): RowFlag[] {
  if (row.status !== 'purchased' || !row.collectible) return [];
  if (row.orderId && ctx.orderIds.has(row.orderId)) return [];
  const flags: RowFlag[] = [];
  if (row.unsure) flags.push('unsure');
  if (!row.price || row.price <= 0) flags.push('no_price');
  // Prices in another currency than the base are not compared with values.
  const base = baseCurrency(ctx.registry ?? EMPTY_REGISTRY);
  const inBase = !row.currency || row.currency === base;
  if (!row.date || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) flags.push('no_date');
  if (!Number.isInteger(row.quantity) || row.quantity < 1 || row.quantity > 20) {
    flags.push('odd_quantity');
  }
  const product = row.productId ? ctx.products.get(row.productId) : null;
  if (row.productId && !product) flags.push('unknown_product');
  if (!row.productId && !row.product?.name) flags.push('unknown_product');
  if (product) {
    // The title has to carry the product's name (or its card number).
    const coverage = Math.max(
      termCoverage([product.name], row.title),
      product.cardNumber ? termCoverage([product.cardNumber], row.title) : 0,
    );
    if (coverage < 0.5) flags.push('weak_match');
    const value = ctx.unitValue.get(product.id);
    const unit =
      inBase && row.price && row.quantity ? toMinor(row.price, base) / row.quantity : null;
    if (value && unit && (unit > value * 3 || unit < value / 3)) flags.push('price_far');
  }
  if (!product && row.product?.name) {
    // A new product named like one the user has: the match may have been missed.
    const name = fold(row.product.name);
    const near = [...ctx.products.values()].some(
      (p) => p.kind === row.product!.kind && (fold(p.name) === name || fold(p.name).includes(name)),
    );
    if (near) flags.push('maybe_registered');
  }
  return flags;
}

export async function checkContext(db: Db, userId: string): Promise<CheckContext> {
  const owned = await holdingsWithProducts(db, userId);
  const products = new Map(owned.map(({ product }) => [product.id, product]));
  const orderIds = new Set(
    owned.map(({ holding }) => holding.orderId).filter((id): id is string => !!id),
  );
  const unitValue = new Map<string, number>();
  // The latest day of the user's lots' value history (one packed row per lot).
  const rows = await db
    .select({ holdingId: schema.holdingValues.holdingId, days: schema.holdingValues.days })
    .from(schema.holdingValues)
    .where(eq(schema.holdingValues.userId, userId));
  const latest = rows
    .flatMap((r) => Object.keys(r.days))
    .sort()
    .at(-1);
  if (latest) {
    const byHolding = new Map(owned.map((o) => [o.holding.id, o]));
    for (const r of rows) {
      const o = byHolding.get(r.holdingId);
      const value = r.days[latest]?.[0];
      if (o && value && o.holding.quantity) {
        unitValue.set(o.product.id, Math.round(value / o.holding.quantity));
      }
    }
  }
  return { products, orderIds, unitValue, registry: await loadSourceRegistry(db) };
}

// ---------------------------------------------------------------------------------------------
// Rows -> the import plan

/** The shop a row names: a described shop's key (its aliases), else the name normalized. */
export function shopKey(shop: string, registry: SourceRegistry = EMPTY_REGISTRY): string {
  const s = shop.normalize('NFKC').toLowerCase().trim();
  return shopOf(registry, s) ?? (s.replace(/\s+/g, '_') || 'other');
}

/** The rows that become purchases, each with the key the plan knows it by. */
export interface ImportRow {
  row: ExtractedRow;
  flags: RowFlag[];
  receipt: PurchaseReceipt;
  /** Read again by Sonnet (and why). */
  reviewedBy: string | null;
}

export function toReceipts(
  rows: { row: ExtractedRow; flags: RowFlag[]; reviewedBy: string | null }[],
  fallbackDate: (file: string) => string,
  /** The currency of a shop's prices (its source description, else the base). */
  currencyOf: (shop: string) => string = () => 'JPY',
): ImportRow[] {
  // Several items of one order share its ID: each gets its own key ("<order>#2").
  const perOrder = new Map<string, number>();
  for (const { row } of rows) {
    if (row.orderId) perOrder.set(row.orderId, (perOrder.get(row.orderId) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  return rows.map(({ row, flags, reviewedBy }) => {
    let orderId = row.orderId?.trim() || null;
    if (orderId && (perOrder.get(orderId) ?? 0) > 1) {
      const n = (seen.get(orderId) ?? 0) + 1;
      seen.set(orderId, n);
      orderId = `${orderId}#${n}`;
    }
    const date = row.date && /^\d{4}-\d{2}-\d{2}$/.test(row.date) ? row.date : null;
    const key =
      orderId ??
      `~${createHash('sha256')
        .update([row.file, row.title, row.price, row.date].join('|'))
        .digest('hex')
        .slice(0, 16)}`;
    const receipt: PurchaseReceipt = {
      orderId: key,
      noOrderId: !orderId,
      // Noon in the app's time zone: a date alone, never shifted to the day before.
      orderedAt: date ? toLocalIso(localTime(date, '12:00:00.000')) : fallbackDate(row.file),
      title: row.title,
      quantity: row.quantity >= 1 && row.quantity <= 100 ? row.quantity : 1,
      total: toMinor(row.price ?? 0, row.currency || currencyOf(row.shop)),
      currency: row.currency || currencyOf(row.shop),
      listing: null,
      dateApprox: row.dateApprox || !date,
    };
    return { row, flags, receipt, reviewedBy };
  });
}

function gradeOf(text: string | null): { grader: Grader; grade: string } | null {
  const m = text?.normalize('NFKC').match(/\b([A-Za-z]{3})\s*(10|9\.5|9|8\.5|8|7|6|5|4|3|2|1)\b/);
  const grader = m?.[1]?.toUpperCase() as Grader | undefined;
  return grader && (GRADERS as readonly string[]).includes(grader)
    ? { grader, grade: m![2]! }
    : null;
}

/** A purchase importer for one shop, built from the rows Claude read. */
export function aiImporter(
  shop: string,
  rows: ImportRow[],
  products: Map<string, Product>,
  registry: SourceRegistry = EMPTY_REGISTRY,
): PurchaseImporter {
  const byKey = new Map(rows.map((r) => [r.receipt.orderId, r.row]));
  const regionsOf = (category: string) =>
    categoriesOf(registry).find((c) => c.key === category)?.regions ?? [];
  return {
    source: shop,
    label: sourceName(registry, shop),
    productFor: (receipt) => {
      const row = byKey.get(receipt.orderId);
      if (!row) return null;
      const existing = row.productId ? products.get(row.productId) : null;
      // An existing product: its own identity, which the plan finds again.
      if (existing) {
        return {
          category: existing.category,
          kind: existing.kind,
          name: existing.name,
          setCode: existing.setCode,
          cardNumber: existing.cardNumber,
        } as ProductInput;
      }
      const p = row.product;
      if (!p?.name) return null;
      return {
        category: p.category,
        kind: p.kind,
        name: p.name.trim(),
        franchise: p.franchise,
        setName: p.setName,
        setCode: p.setCode,
        cardNumber: p.cardNumber,
        rarity: p.rarity,
        platform: p.platform,
        // A region of its category, else the category's first (the admin orders the list).
        region: regionsOf(p.category).includes(p.region ?? '')
          ? (p.region as Region)
          : (regionsOf(p.category)[0] ?? null),
      };
    },
    holdingFor: (receipt) => {
      const row = byKey.get(receipt.orderId);
      const graded = gradeOf(row?.gradedAs ?? null);
      if (graded) return { grading: 'graded', ...graded };
      if (row?.sealedState) {
        return {
          packagingState: row.sealedState === 'shrink' ? 'sealed_shrink' : 'sealed_no_shrink',
        };
      }
      return {};
    },
  };
}

/** Review reasons the app explains, from the flags left after Sonnet. */
export function reviewReasons(flags: RowFlag[]): string[] {
  const reasons = new Set<string>();
  for (const f of flags) {
    if (f === 'price_far') reasons.add('price_far');
    else if (f === 'maybe_same') reasons.add('maybe_same');
    else if (f === 'weak_match' || f === 'maybe_registered') reasons.add('check_product');
    else if (f === 'no_date')
      continue; // date_approx says it
    else reasons.add('ai_unsure');
  }
  return [...reasons];
}

export type AskClaude = <T>(options: {
  model: ModelAlias;
  system: string;
  prompt: string;
  schema: object;
  readDir?: string;
  /** The files of `readDir` the question is about (attached when the model cannot open them). */
  files?: string[];
}) => Promise<ClaudeResult<T>>;

export interface ReadCache {
  version: 1;
  /** The model's answers on look-alike rows of different batches ("same purchase?"). */
  pairs?: Record<string, { same: boolean; confidence: number }>;
  files: Record<
    string,
    {
      name: string;
      model: ModelAlias;
      rows: ExtractedRow[];
      /** Why Sonnet read it. */
      why?: string;
      /** Drawn for the random check already (once per file, not on every run). */
      drawn?: boolean;
    }
  >;
}

export interface ReadResult {
  rows: { row: ExtractedRow; flags: RowFlag[]; reviewedBy: string | null }[];
  files: number;
  /** Files Sonnet read again, with why. */
  reviewed: { file: string; why: string }[];
  /** Purchases shown in several files, joined (their files). */
  merged: string[][];
  calls: { model: string; costUsd: number; tokens: number }[];
  costUsd: number;
}

/**
 * Reads the files (Haiku), checks every row, and has Sonnet read again the files with flagged
 * rows plus a random sample of the others. Results are cached per file content in the folder
 * (\`.tora-import.json\`), so running again only reads new files.
 */
/** The files a row came from ("a.png + b.png" when one purchase was shown on several pages). */
export const filesOf = (row: ExtractedRow) => row.file.split(' + ').map((f) => f.trim());

const titleCore = (t: string) =>
  t
    .normalize('NFKC')
    .toLowerCase()
    .replace(/(\.{3}|…)\s*$/, '')
    .replace(/\s+/g, '');
const sameDay = (a: string | null, b: string | null) => !a || !b || a === b;

/** Nothing in two rows says they are different purchases. */
function compatible(a: ExtractedRow, b: ExtractedRow, registry: SourceRegistry): boolean {
  if (shopKey(a.shop, registry) !== shopKey(b.shop, registry)) return false;
  if (a.price && b.price && a.price !== b.price) return false;
  if (a.orderId && b.orderId && a.orderId !== b.orderId) return false;
  // A guessed date says nothing against another page's date.
  return a.dateApprox || b.dateApprox || sameDay(a.date, b.date);
}

/** Sure enough of the model's "same purchase" to join the rows without asking. */
export const SAME_SURE = 0.8;

/**
 * One purchase shown in several files (a listing page with the full title, a transaction page
 * with the date and ID): rows the model tagged as one purchase, sure enough and with nothing
 * disagreeing, are joined. Rows that may be one purchase but are not joined (the model unsure,
 * something disagreeing, or a look-alike the code finds: same shop and price, one title the other
 * cut short) stay apart as `pairs`, for the user to merge in review.
 */
export function mergeRows(
  rows: ExtractedRow[],
  /** The model's answer on a look-alike pair it was asked about separately. */
  judged: (a: ExtractedRow, b: ExtractedRow) => { same: boolean; confidence: number } | null = () =>
    null,
  registry: SourceRegistry = EMPTY_REGISTRY,
): {
  rows: ExtractedRow[];
  merged: string[][];
  pairs: [ExtractedRow, ExtractedRow][];
} {
  const join = (a: ExtractedRow, b: ExtractedRow): ExtractedRow => {
    // The fuller title knows the item (name, quantity, category); the other the order.
    const [full, other] = titleCore(a.title).length >= titleCore(b.title).length ? [a, b] : [b, a];
    // A date read from the order beats one guessed (e.g. from a listing's age).
    const real = (r: ExtractedRow) => !!r.date && !r.dateApprox;
    const dated = real(a) ? a : real(b) ? b : a.date ? a : b;
    return {
      ...full,
      file: [...filesOf(a), ...filesOf(b)].join(' + '),
      orderId: a.orderId ?? b.orderId,
      url: full.url ?? other.url,
      price: full.price ?? other.price,
      date: dated.date,
      dateApprox: dated.date ? dated.dateApprox : full.dateApprox,
      status: a.status === 'cancelled' || b.status === 'cancelled' ? 'cancelled' : full.status,
      unsure: [full.unsure, other.unsure].filter(Boolean).join('; ') || null,
    };
  };
  const out: ExtractedRow[] = [];
  const merged: string[][] = [];
  const pairs: [ExtractedRow, ExtractedRow][] = [];
  const distinctFiles = (a: ExtractedRow, b: ExtractedRow) =>
    !filesOf(a).some((f) => filesOf(b).includes(f));
  for (const row of rows) {
    const tagged =
      row.samePurchase &&
      out.find((o) => o.samePurchase === row.samePurchase && distinctFiles(o, row));
    if (tagged) {
      const sure = Math.min(tagged.sameConfidence ?? 0, row.sameConfidence ?? 0) >= SAME_SURE;
      if (sure && compatible(tagged, row, registry)) {
        const joined = join(tagged, row);
        out[out.indexOf(tagged)] = joined;
        for (const p of pairs) for (let k = 0; k < 2; k++) if (p[k] === tagged) p[k] = joined;
        merged.push(filesOf(joined));
      } else {
        pairs.push([tagged, row]);
        out.push(row);
      }
      continue;
    }
    // Look-alikes the model did not tag (e.g. read in different batches).
    const alike = out.find((o) => {
      if (!distinctFiles(o, row) || !o.price || o.price !== row.price) return false;
      if (o.status === 'not_purchase' || row.status === 'not_purchase') return false;
      const [a, b] = [titleCore(o.title), titleCore(row.title)].sort((x, y) => x.length - y.length);
      return a!.length >= 6 && b!.startsWith(a!) && compatible(o, row, registry);
    });
    const verdict = alike ? judged(alike, row) : null;
    if (alike && verdict?.same && verdict.confidence >= SAME_SURE) {
      const joined = join(alike, row);
      out[out.indexOf(alike)] = joined;
      for (const p of pairs) for (let k = 0; k < 2; k++) if (p[k] === alike) p[k] = joined;
      merged.push(filesOf(joined));
      continue;
    }
    // Judged different purchases: nothing to offer.
    if (alike && !(verdict && !verdict.same && verdict.confidence >= SAME_SURE)) {
      pairs.push([alike, row]);
    }
    out.push(row);
  }
  return { rows: out, merged, pairs };
}

export async function readPurchases(
  ctx: CheckContext,
  dir: string,
  files: { name: string; hash: string }[],
  ask: AskClaude,
  options: {
    sample?: number;
    log?: (m: string) => void;
    loadCache?: () => Promise<ReadCache | null>;
    saveCache?: (cache: ReadCache) => Promise<void>;
    random?: () => number;
  } = {},
): Promise<ReadResult> {
  const log = options.log ?? (() => {});
  const random = options.random ?? Math.random;
  const cache: ReadCache = (await options.loadCache?.()) ?? { version: 1, files: {} };
  // Rows read before prices kept their currency (S16) named the price `priceJpy`.
  for (const f of Object.values(cache.files)) {
    for (const r of f.rows as (ExtractedRow & { priceJpy?: number | null })[]) {
      if (r.price === undefined && r.priceJpy !== undefined) r.price = r.priceJpy;
    }
  }
  const result: ReadResult = {
    rows: [],
    files: files.length,
    reviewed: [],
    merged: [],
    calls: [],
    costUsd: 0,
  };
  const products = [...ctx.products.values()].map(productLine);
  const call = async (
    model: ModelAlias,
    batch: string[],
    hints?: Parameters<typeof extractPrompt>[2],
  ) => {
    const r = await ask<{ rows: ExtractedRow[] }>({
      model,
      system: EXTRACT_SYSTEM,
      prompt: extractPrompt(batch, products, hints, ctx.registry),
      schema: rowsSchema(ctx.registry),
      readDir: dir,
      files: batch,
    });
    result.calls.push({ model: r.modelName, costUsd: r.costUsd, tokens: r.tokens });
    // Same-purchase tags mean something within one answer only.
    const tag = `${Date.now().toString(36)}${result.calls.length}:`;
    for (const row of r.output.rows)
      if (row.samePurchase) row.samePurchase = tag + row.samePurchase;
    result.costUsd += r.costUsd;
    // Rows go to the file they name, a purchase seen in several files to the first of them (a
    // lone file takes them all). Their \`file\` keeps every name, for the files read together.
    const out = new Map<string, ExtractedRow[]>(batch.map((f) => [f, []]));
    for (const row of r.output.rows) {
      const named = filesOf(row)
        .map((n) => batch.find((f) => f === n || f.endsWith(n)))
        .filter((f): f is string => !!f);
      const file = batch.length === 1 ? batch[0]! : named[0];
      if (file) {
        out
          .get(file)!
          .push({ ...row, file: (named.length ? [...new Set(named)] : [file]).join(' + ') });
      }
    }
    return out;
  };
  const store = async (
    byFile: Map<string, ExtractedRow[]>,
    model: ModelAlias,
    why: { names: string[]; why: string }[] = [],
  ) => {
    for (const [name, rows] of byFile) {
      const hash = files.find((f) => f.name === name)!.hash;
      cache.files[hash] = { name, model, rows, why: why.find((w) => w.names.includes(name))?.why };
    }
    await options.saveCache?.(cache);
  };

  const unread = files.filter((f) => !cache.files[f.hash]);
  for (let i = 0; i < unread.length; i += BATCH) {
    const batch = unread.slice(i, i + BATCH).map((f) => f.name);
    log(`Haiku reading ${batch.length} file(s): ${batch.join(', ')}`);
    await store(await call('haiku', batch), 'haiku');
  }

  // Rows of all files, one purchase shown in several files joined, then checked.
  const assemble = () => {
    const all = files.flatMap((f) => cache.files[f.hash]!.rows);
    return mergeRows(all, undefined, ctx.registry);
  };
  const modelOf = (name: string) => cache.files[files.find((f) => f.name === name)!.hash]!.model;

  // Purchases with flagged rows (and a sample of the rest) are read again by Sonnet, all of
  // their files together. A missing date is not on the page: reading again cannot find one.
  const again: { names: string[]; why: string }[] = [];
  const queued = new Set<string>();
  for (const row of assemble().rows) {
    const names = filesOf(row).filter((n) => !queued.has(n) && modelOf(n) !== 'sonnet');
    if (names.length === 0) continue;
    const flags = checkRow(row, ctx).filter((f) => f !== 'no_date');
    // The random check is drawn once per file (a new draw on every run would add up).
    const entries = names.map((n) => cache.files[files.find((f) => f.name === n)!.hash]!);
    const draw =
      row.status === 'purchased' &&
      entries.some((e) => !e.drawn) &&
      random() < (options.sample ?? 0.1);
    for (const e of entries) e.drawn = true;
    const why = flags.length ? flags.join(', ') : draw ? 'random check' : null;
    if (!why) continue;
    // The whole file is read again: every purchase in it goes along.
    for (const n of names) queued.add(n);
    again.push({ names, why });
  }
  await options.saveCache?.(cache);
  for (let i = 0; i < again.length;) {
    const batch: typeof again = [];
    while (i < again.length && batch.flatMap((b) => b.names).length < 4) batch.push(again[i++]!);
    const names = batch.flatMap((b) => b.names);
    const hintRows = names.flatMap((n) => cache.files[files.find((f) => f.name === n)!.hash]!.rows);
    const flags = Object.fromEntries(
      hintRows.map((r, j) => [`${r.file} row ${j + 1}: ${r.title}`, checkRow(r, ctx)]),
    );
    log(
      `Sonnet reading again: ${batch.map((b) => `${b.names.join(' + ')} (${b.why})`).join(', ')}`,
    );
    await store(await call('sonnet', names, { rows: hintRows, flags }), 'sonnet', batch);
  }

  // Look-alikes the model never saw together (different batches): asked about as text only.
  const cache_pairs = (cache.pairs ??= {});
  const pairKey = (a: ExtractedRow, b: ExtractedRow) =>
    [a, b]
      .map((r) => `${r.file}|${r.title}|${r.price}`)
      .sort()
      .join(' || ');
  const open = assemble().pairs.filter(([a, b]) => !cache_pairs[pairKey(a, b)]);
  if (open.length) {
    log(`Haiku comparing ${open.length} look-alike pair(s) across files`);
    const view = (r: ExtractedRow) => ({
      file: r.file,
      title: r.title,
      price: r.price,
      quantity: r.quantity,
      date: r.dateApprox ? null : r.date,
      orderId: r.orderId,
    });
    const r = await ask<{ pairs: { pair: number; same: boolean; confidence: number }[] }>({
      model: 'haiku',
      system: EXTRACT_SYSTEM,
      prompt: `Each pair below is two rows read from different files of a collector's purchase history (e.g. a listing page with the full title, and a transaction or order page with the date, order ID and a cut-off title). For each pair: is it one and the same purchase? Answer same (true/false) and confidence (0 to 1). Titles cut short ("…", "...") count as matching when one starts like the other; a different order ID or order date means different purchases. A quantity may differ: an order page often shows 1 for a set the listing calls "2枚" or "N個セット".\n\n${JSON.stringify(open.map(([a, b], i) => ({ pair: i + 1, a: view(a), b: view(b) })))}`,
      schema: PAIRS_SCHEMA,
    });
    result.calls.push({ model: r.modelName, costUsd: r.costUsd, tokens: r.tokens });
    result.costUsd += r.costUsd;
    for (const answer of r.output.pairs) {
      const pair = open[answer.pair - 1];
      if (pair)
        cache_pairs[pairKey(...pair)] = { same: answer.same, confidence: answer.confidence };
    }
    await options.saveCache?.(cache);
  }
  const { rows, merged, pairs } = mergeRows(
    files.flatMap((f) => cache.files[f.hash]!.rows),
    (a, b) => cache_pairs[pairKey(a, b)] ?? null,
    ctx.registry,
  );
  result.merged = merged;
  for (const row of rows) {
    const flags = checkRow(row, ctx);
    if (pairs.some((pair) => pair.includes(row))) flags.push('maybe_same');
    const why = filesOf(row)
      .map((n) => cache.files[files.find((f) => f.name === n)!.hash]!.why)
      .find(Boolean);
    result.rows.push({ row, flags, reviewedBy: why ?? null });
  }
  result.reviewed = files
    .filter((f) => cache.files[f.hash]!.why)
    .map((f) => ({ file: f.name, why: cache.files[f.hash]!.why! }));
  return result;
}
