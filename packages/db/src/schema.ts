// Drizzle schema (requirements section 5). Kept portable to Postgres: ISO text timestamps,
// integer money, JSON stored as text, CHECK constraints instead of SQLite-specific types.
import {
  ACQUISITION_TYPES,
  COLLECTOR_RUN_STATUSES,
  CONDITIONS,
  EXCLUDED_REASONS,
  GRADERS,
  GRADINGS,
  HOLDING_EVENT_TYPES,
  HOLDING_STATUSES,
  OBSERVATION_TYPES,
  PACKAGING_STATES,
  RAW_GRADES,
  REGIONS,
  SET_TYPES,
  USER_ROLES,
  newId,
  toLocalIso,
  type AlertState,
  type NoticeLevels,
  type ProductClass,
  type PullTier,
  type SignalStats,
  type SourceInfo,
  type SourceRole,
  type UserPreferences,
} from '@tora/core';
import { type SQL, sql } from 'drizzle-orm';
import {
  type AnySQLiteColumn,
  blob,
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

const id = () => text('id').primaryKey().$defaultFn(newId);

const timestamps = {
  createdAt: text('created_at')
    .notNull()
    .$defaultFn(() => toLocalIso()),
  updatedAt: text('updated_at')
    .notNull()
    .$defaultFn(() => toLocalIso())
    .$onUpdateFn(() => toLocalIso()),
};

/** `column IN ('a', 'b', ...)`; values are compile-time constants, so inlining is safe. */
function oneOf(column: AnySQLiteColumn, values: readonly string[]): SQL {
  const list = values.map((v) => `'${v.replaceAll("'", "''")}'`).join(', ');
  return sql`${column} IN (${sql.raw(list)})`;
}

export interface RecentSale {
  bucket: string | null;
  priceBase: number;
  observedAt: string;
  /** True when the site only gave a relative time ("5時間前"). */
  approximate?: boolean;
}

export interface SourceQuery {
  keywords?: string[];
  excludeKeywords?: string[];
  categoryId?: string;
  priceMin?: number;
  priceMax?: number;
  extra?: Record<string, unknown>;
}

export const users = sqliteTable(
  'users',
  {
    id: id(),
    username: text('username').notNull(),
    /** Null for the placeholder account created by the multi-user migration (cannot log in). */
    passwordHash: text('password_hash'),
    /** AES-GCM encrypted TOTP secret (see apps/web/src/lib/auth/crypto.ts). */
    totpSecretEnc: text('totp_secret_enc'),
    /** Last accepted TOTP time step; codes at or before it are rejected (replay protection). */
    totpLastStep: integer('totp_last_step'),
    backupCodeHashes: text('backup_code_hashes', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .default([]),
    role: text('role', { enum: USER_ROLES }).notNull().default('member'),
    disabledAt: text('disabled_at'),
    /** Notice levels the user chose per notice type (S8); types not listed use the defaults. */
    noticeLevels: text('notice_levels', { mode: 'json' }).$type<NoticeLevels>(),
    /** Display choices (S8), e.g. the Portfolio Summary's rotating card. */
    preferences: text('preferences', { mode: 'json' }).$type<UserPreferences>(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('users_username_uq').on(t.username),
    check('users_role_check', oneOf(t.role, USER_ROLES)),
  ],
);

/** Login slots: each successful login registers one; at most 2 active per user. */
export const userDevices = sqliteTable(
  'user_devices',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    label: text('label'),
    lastSeenAt: text('last_seen_at').notNull(),
    revokedAt: text('revoked_at'),
    ...timestamps,
  },
  (t) => [index('user_devices_user_idx').on(t.userId, t.revokedAt)],
);

export const ACCOUNT_SETUP_KINDS = ['both', 'password', '2fa'] as const;
export type AccountSetupKind = (typeof ACCOUNT_SETUP_KINDS)[number];

/**
 * One-time setup links an admin makes (S21): the person sets their own password and/or
 * authenticator. Only the token's hash is kept; a new link for a person replaces the old one.
 */
export const accountSetups = sqliteTable(
  'account_setups',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    /** both: a new account or a full reset; password: keeps the authenticator; 2fa: keeps the password. */
    kind: text('kind', { enum: ACCOUNT_SETUP_KINDS }).notNull(),
    tokenHash: text('token_hash').notNull(),
    /** The authenticator secret offered on the page (encrypted), kept so a reload shows the same QR. */
    totpSecretEnc: text('totp_secret_enc'),
    createdBy: text('created_by').references(() => users.id),
    expiresAt: text('expires_at').notNull(),
    usedAt: text('used_at'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('account_setups_token_uq').on(t.tokenHash),
    index('account_setups_user_idx').on(t.userId),
    check('account_setups_kind_check', oneOf(t.kind, ACCOUNT_SETUP_KINDS)),
  ],
);

/** Pre-registered TCG sets (shared catalog). */
export const tcgSets = sqliteTable(
  'tcg_sets',
  {
    id: id(),
    franchise: text('franchise').notNull(),
    /** Null when the set is the same in every region (e.g. Magic). */
    region: text('region', { enum: REGIONS }),
    code: text('code'),
    name: text('name').notNull(),
    nameAlias: text('name_alias'),
    setType: text('set_type', { enum: SET_TYPES }).notNull(),
    releaseDate: text('release_date'),
    source: text('source').notNull(),
    sourceKey: text('source_key').notNull(),
    ...timestamps,
  },
  (t) => [
    check('tcg_sets_region_check', oneOf(t.region, REGIONS)),
    check('tcg_sets_type_check', oneOf(t.setType, SET_TYPES)),
    uniqueIndex('tcg_sets_source_uq').on(t.source, t.sourceKey),
    index('tcg_sets_franchise_idx').on(t.franchise, t.releaseDate),
  ],
);

export const products = sqliteTable(
  'products',
  {
    id: id(),
    /** The admin's categories and kinds (S16; built-in: `tcg`, `game` and their kinds). */
    category: text('category').notNull(),
    kind: text('kind').notNull(),
    /** Its item type (S16, see `itemTypeOf`): roles, source order and condition fields. */
    itemType: text('item_type'),
    name: text('name').notNull(),
    nameAlias: text('name_alias'),
    franchise: text('franchise'),
    region: text('region', { enum: REGIONS }),
    platform: text('platform'),
    setId: text('set_id').references(() => tcgSets.id),
    setName: text('set_name'),
    setCode: text('set_code'),
    /**
     * Its set line set by hand (main expansion, high class pack, ...: the admin's list, S9); null
     * takes the line its catalog set's title or its own name says (Pokemon), else none.
     */
    line: text('line'),
    variant: text('variant'),
    cardNumber: text('card_number'),
    rarity: text('rarity'),
    releaseDate: text('release_date'),
    retailPriceBase: integer('retail_price_base'),
    imageUrl: text('image_url'),
    notes: text('notes'),
    /** Values of the category's custom fields (S16), by field key. */
    fields: text('fields', { mode: 'json' }).$type<Record<string, string | number | boolean>>(),
    /** Null for products generated from the catalog. */
    createdBy: text('created_by').references(() => users.id),
    ...timestamps,
  },
  (t) => [
    check('products_region_check', oneOf(t.region, REGIONS)),
    check('products_name_check', sql`length(trim(${t.name})) > 0`),
    index('products_kind_idx').on(t.category, t.kind),
    index('products_set_idx').on(t.setId, t.kind),
  ],
);

/**
 * A product's picture, stored as a small WebP thumbnail (downloaded once by the home PC from the
 * linked listing), so the app never loads images from other sites.
 */
export const productImages = sqliteTable('product_images', {
  productId: text('product_id')
    .primaryKey()
    .references(() => products.id, { onDelete: 'cascade' }),
  bytes: blob('bytes', { mode: 'buffer' }).notNull(),
  contentType: text('content_type').notNull(),
  width: integer('width'),
  height: integer('height'),
  /** Where it was downloaded from (a changed product image URL triggers a new download). */
  sourceUrl: text('source_url'),
  ...timestamps,
});

export const productSources = sqliteTable(
  'product_sources',
  {
    id: id(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    source: text('source').notNull(),
    externalId: text('external_id'),
    query: text('query', { mode: 'json' }).$type<SourceQuery>(),
    title: text('title'),
    url: text('url'),
    /** The listing's picture; the product's stored thumbnail comes from its first active listing. */
    imageUrl: text('image_url'),
    /** Collector progress (e.g. history backfill cursor). Opaque to everything but the collector. */
    state: text('state', { mode: 'json' }).$type<unknown>(),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    lastSuccessAt: text('last_success_at'),
    /** When the product's details were rewritten from this listing (once per link). */
    detailsSyncedAt: text('details_synced_at'),
    /**
     * Newest trades as last seen on the site, refreshed every run (may carry approximate
     * times). Shown as "last sale"; history and medians use price_observations only.
     */
    recentSales: text('recent_sales', { mode: 'json' }).$type<RecentSale[]>(),
    ...timestamps,
  },
  (t) => [
    index('product_sources_product_idx').on(t.productId, t.source, t.active),
    index('product_sources_source_idx').on(t.source, t.active),
    uniqueIndex('product_sources_external_uq').on(t.productId, t.source, t.externalId),
  ],
);

export const CANDIDATE_STATUSES = ['pending', 'rejected'] as const;

/** Possible matches found by a collector for a product, waiting for the user to confirm. */
export const sourceCandidates = sqliteTable(
  'source_candidates',
  {
    id: id(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    source: text('source').notNull(),
    externalId: text('external_id').notNull(),
    title: text('title').notNull(),
    url: text('url'),
    imageUrl: text('image_url'),
    priceBase: integer('price_base'),
    score: real('score').notNull().default(0),
    status: text('status', { enum: CANDIDATE_STATUSES }).notNull().default('pending'),
    ...timestamps,
  },
  (t) => [
    check('source_candidates_status_check', oneOf(t.status, CANDIDATE_STATUSES)),
    uniqueIndex('source_candidates_uq').on(t.productId, t.source, t.externalId),
    index('source_candidates_pending_idx').on(t.source, t.status),
  ],
);

export const holdings = sqliteTable(
  'holdings',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    quantity: integer('quantity').notNull().default(1),
    costTotalBase: integer('cost_total_base').notNull().default(0),
    acquiredAt: text('acquired_at').notNull(),
    acquiredFrom: text('acquired_from'),
    acquisitionType: text('acquisition_type', { enum: ACQUISITION_TYPES })
      .notNull()
      .default('purchase'),
    parentHoldingId: text('parent_holding_id').references((): AnySQLiteColumn => holdings.id),
    condition: text('condition', { enum: CONDITIONS }),
    packagingState: text('packaging_state', { enum: PACKAGING_STATES }),
    grading: text('grading', { enum: GRADINGS }),
    rawGrade: text('raw_grade', { enum: RAW_GRADES }),
    grader: text('grader', { enum: GRADERS }),
    grade: text('grade'),
    /** A value of the admin's condition list for the item's kind (S16). */
    conditionValue: text('condition_value'),
    certNumber: text('cert_number'),
    status: text('status', { enum: HOLDING_STATUSES }).notNull().default('owned'),
    notes: text('notes'),
    /** Where the order was placed (normalized, e.g. `snkrdunk`) and its transaction / order ID. */
    orderSource: text('order_source'),
    orderId: text('order_id'),
    /**
     * Portfolio tracking (S8): what the lot cost counts in the spent total, and its market value
     * in the value total; P/L covers lots counted in both. Off for things bought to use (a console,
     * a game to play): "value only" still shows what it is worth.
     */
    countInCost: integer('count_in_cost', { mode: 'boolean' }).notNull().default(true),
    countInValue: integer('count_in_value', { mode: 'boolean' }).notNull().default(true),
    /** Imported and not yet checked in the app's import review (grade, cert, packaging). */
    reviewPending: integer('review_pending', { mode: 'boolean' }).notNull().default(false),
    /**
     * Why it was flagged for review (`deadline_missed`, `no_delivery`, ...). Kept after the user
     * confirms, so the same reason does not flag it again.
     */
    reviewReason: text('review_reason'),
    /** The import that created this lot (null for lots added by hand). */
    importRunId: text('import_run_id').references(() => importRuns.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    check('holdings_quantity_check', sql`${t.quantity} >= 1`),
    check('holdings_cost_check', sql`${t.costTotalBase} >= 0`),
    check('holdings_acquisition_type_check', oneOf(t.acquisitionType, ACQUISITION_TYPES)),
    check('holdings_condition_check', oneOf(t.condition, CONDITIONS)),
    check('holdings_packaging_state_check', oneOf(t.packagingState, PACKAGING_STATES)),
    check('holdings_grading_check', oneOf(t.grading, GRADINGS)),
    check('holdings_raw_grade_check', oneOf(t.rawGrade, RAW_GRADES)),
    check('holdings_grader_check', oneOf(t.grader, GRADERS)),
    check('holdings_status_check', oneOf(t.status, HOLDING_STATUSES)),
    index('holdings_user_idx').on(t.userId, t.status),
    index('holdings_product_idx').on(t.productId, t.status),
    index('holdings_parent_idx').on(t.parentHoldingId),
    index('holdings_status_idx').on(t.status),
    index('holdings_order_idx').on(t.userId, t.orderSource, t.orderId),
  ],
);

/**
 * Orders the user marked as cancelled (their lots were removed): imports skip these IDs. Needed
 * because a buyer's own cancellation sends no email.
 */
export const cancelledOrders = sqliteTable(
  'cancelled_orders',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    orderSource: text('order_source').notNull(),
    orderId: text('order_id').notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex('cancelled_orders_uq').on(t.userId, t.orderSource, t.orderId)],
);

/**
 * One import of purchases (requirements S5d): an email export, a batch of pasted links, later a
 * file or an import through Claude. Shown in the Imports history with what it did.
 */
export const importRuns = sqliteTable('import_runs', {
  id: id(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  /** email | links | file | claude */
  method: text('method').notNull(),
  /** Shop (order source), e.g. snkrdunk, mercari. */
  source: text('source'),
  startedAt: text('started_at').notNull(),
  finishedAt: text('finished_at'),
  /** What it did: created, matched, duplicate, skipped, failed, corrected, flagged, ... */
  counts: text('counts', { mode: 'json' }).$type<Record<string, number>>().notNull().default({}),
  note: text('note'),
  ...timestamps,
});

/** Import log outcomes (S6): what happened to each row of an import. */
export const IMPORT_ROW_OUTCOMES = [
  'imported',
  'existing',
  'matched',
  'updated',
  'skipped',
  'problem',
] as const;
export type ImportRowOutcome = (typeof IMPORT_ROW_OUTCOMES)[number];

/**
 * The import log (requirements S6): each row an import read (a spreadsheet row, a purchase read
 * by Claude, an order email) and what happened to it, so nothing left out is only a number.
 */
export const importRows = sqliteTable(
  'import_rows',
  {
    id: id(),
    importRunId: text('import_run_id')
      .notNull()
      .references(() => importRuns.id, { onDelete: 'cascade' }),
    /** Order in the import (a spreadsheet's line, a receipt's place). */
    position: integer('position').notNull(),
    /** What the row says it is (item title or name). */
    title: text('title').notNull(),
    /** Where it came from: an order ID, a file name, a spreadsheet line. */
    detail: text('detail'),
    /** imported | existing (already in Tora) | matched (to an entry added by hand) | updated | skipped | problem */
    outcome: text('outcome', { enum: IMPORT_ROW_OUTCOMES }).notNull(),
    /** Why (a code the app names, e.g. `same_order`, `not_owned`, `bad_date`), or an error. */
    reason: text('reason'),
    /** The lot it created or matched. */
    holdingId: text('holding_id').references(() => holdings.id, { onDelete: 'set null' }),
    quantity: integer('quantity'),
    costBase: integer('cost_base'),
    /** The purchase day, as the row gives it. */
    day: text('day'),
    ...timestamps,
  },
  (t) => [
    check('import_rows_outcome_check', oneOf(t.outcome, IMPORT_ROW_OUTCOMES)),
    index('import_rows_run_idx').on(t.importRunId, t.position),
  ],
);

/**
 * Links to purchases the user pasted in the app (shops that send no receipt email, e.g.
 * Mercari). The home PC reads each on the next collect and imports it into the review queue.
 */
export const purchaseLinks = sqliteTable(
  'purchase_links',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    url: text('url').notNull(),
    /** pending | imported | matched | duplicate | skipped | failed */
    status: text('status').notNull().default('pending'),
    /** What happened, in plain words (e.g. why it was skipped). */
    message: text('message'),
    holdingId: text('holding_id').references(() => holdings.id, { onDelete: 'set null' }),
    /** The import run that read this link. */
    importRunId: text('import_run_id').references(() => importRuns.id, { onDelete: 'set null' }),
    processedAt: text('processed_at'),
    ...timestamps,
  },
  (t) => [uniqueIndex('purchase_links_uq').on(t.userId, t.url)],
);

/**
 * Fixes proposed by the automated data review (requirements S4d): a model looks at what the
 * checks flagged and files a suggestion; nothing changes until the user accepts it.
 */
export const suggestions = sqliteTable(
  'suggestions',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    /**
     * exclude_sale | exclude_word | fix_product | link_set | set_line, or sale_ok / search_ok
     * (judged fine, kept as memory)
     */
    kind: text('kind').notNull(),
    /** What it is about, unique per kind: an observation ID, "<source ID>|<word>", a product ID. */
    targetKey: text('target_key').notNull(),
    productId: text('product_id').references(() => products.id, { onDelete: 'cascade' }),
    /** What accepting does: { observationId } | { sourceId, word } | { changes } | { setId } */
    payload: text('payload', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    reason: text('reason').notNull(),
    /** What the model saw: titles, prices, the value. */
    evidence: text('evidence', { mode: 'json' }).$type<Record<string, unknown>>(),
    model: text('model'),
    confidence: real('confidence'),
    /** open | accepted | dismissed | closed (not shown: a verdict kept so it is not judged again) */
    status: text('status').notNull().default('open'),
    decidedAt: text('decided_at'),
    /** The user's comment when deciding: given to the model in later reviews. */
    userNote: text('user_note'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('suggestions_uq').on(t.userId, t.kind, t.targetKey),
    index('suggestions_status_idx').on(t.userId, t.status),
  ],
);

/**
 * Items the user does not expect a stable price source for (e.g. a limited watch no shop lists):
 * no "not linked" warning for them (requirements S7).
 */
export const sourceWarningDismissals = sqliteTable(
  'source_warning_dismissals',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    productId: text('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    ...timestamps,
  },
  (t) => [uniqueIndex('source_warning_dismissals_uq').on(t.userId, t.productId)],
);

export const holdingEvents = sqliteTable(
  'holding_events',
  {
    id: id(),
    holdingId: text('holding_id')
      .notNull()
      .references(() => holdings.id),
    type: text('type', { enum: HOLDING_EVENT_TYPES }).notNull(),
    occurredAt: text('occurred_at').notNull(),
    amountBase: integer('amount_base'),
    feesBase: integer('fees_base'),
    payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (t) => [
    check('holding_events_type_check', oneOf(t.type, HOLDING_EVENT_TYPES)),
    index('holding_events_holding_idx').on(t.holdingId, t.occurredAt),
  ],
);

export const priceObservations = sqliteTable(
  'price_observations',
  {
    id: id(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    source: text('source').notNull(),
    observationType: text('observation_type', { enum: OBSERVATION_TYPES }).notNull(),
    bucket: text('bucket'),
    priceBase: integer('price_base').notNull(),
    /** Price as the source showed it, in the currency's smallest unit (yen; cents for dollars). */
    priceOriginal: integer('price_original'),
    currency: text('currency'),
    fxRate: real('fx_rate'),
    observedAt: text('observed_at').notNull(),
    fetchedAt: text('fetched_at').notNull(),
    externalRef: text('external_ref').notNull(),
    title: text('title'),
    url: text('url'),
    raw: text('raw', { mode: 'json' }).$type<unknown>(),
    excluded: integer('excluded', { mode: 'boolean' }).notNull().default(false),
    excludedReason: text('excluded_reason', { enum: EXCLUDED_REASONS }),
    /**
     * The source did not report how many units the trade covered: `price_base` is
     * `price_original` divided by an estimated lot size (see `inferLotSizes`).
     */
    quantityInferred: integer('quantity_inferred', { mode: 'boolean' }).notNull().default(false),
    ...timestamps,
  },
  (t) => [
    check('price_observations_type_check', oneOf(t.observationType, OBSERVATION_TYPES)),
    check('price_observations_excluded_reason_check', oneOf(t.excludedReason, EXCLUDED_REASONS)),
    uniqueIndex('price_observations_source_ref_uq').on(t.source, t.externalRef),
    index('price_observations_lookup_idx').on(t.productId, t.bucket, t.observedAt),
    index('price_observations_source_idx').on(t.productId, t.source, t.observedAt),
  ],
);

/**
 * One item's kept sales, shop asks and buy prices, packed (requirements S19 part 2): Turso bills
 * rows read, not bytes, so an item's whole history costs one row. Kept up to date from the days
 * `price_days_dirty` marks; see `item-sales.ts`.
 */
export const itemSales = sqliteTable('item_sales', {
  productId: text('product_id').primaryKey(),
  sales: text('sales', { mode: 'json' }).notNull().$type<PackedSales>(),
  /** When the nightly self-check last compared it with the raw sales. */
  checkedAt: text('checked_at'),
  updatedAt: text('updated_at')
    .notNull()
    .$defaultFn(() => toLocalIso())
    .$onUpdateFn(() => toLocalIso()),
});

/** Observations of one source, condition, currency and type, oldest first. */
export interface PackedGroup {
  s: string;
  b: string | null;
  c: string | null;
  t: (typeof OBSERVATION_TYPES)[number];
  /** Times (ms). */
  at: number[];
  /** Prices in the base currency. */
  p: number[];
  /** Positions of the trades whose lot size was estimated. */
  e: number[];
}

export interface PackedSales {
  /** The kept observations. */
  groups: PackedGroup[];
  /** Every observation (any type, kept or excluded) per source and day. */
  n: Record<string, Record<string, number>>;
}

/**
 * Item, source and day whose sales changed since `item_sales` was built (the name is from its
 * predecessor, `price_days`): written by triggers on
 * `price_observations` (migration 0031), so every change is caught, whatever made it.
 */
export const priceDaysDirty = sqliteTable(
  'price_days_dirty',
  {
    productId: text('product_id').notNull(),
    source: text('source').notNull(),
    day: text('day').notNull(),
  },
  (t) => [uniqueIndex('price_days_dirty_uq').on(t.productId, t.source, t.day)],
);

export const manualPrices = sqliteTable(
  'manual_prices',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    bucket: text('bucket').notNull(),
    priceBase: integer('price_base').notNull(),
    setAt: text('set_at').notNull(),
    note: text('note'),
    ...timestamps,
  },
  (t) => [index('manual_prices_lookup_idx').on(t.userId, t.productId, t.bucket, t.setAt)],
);

/** One day of a lot's value: value (null: none), method, source, samples, confidence, estimated. */
export type DayValue = [number | null, string, string | null, number, string | null, 0 | 1];

/**
 * A lot's value history, packed (requirements S19 part 2): every day it was held, in one row, so
 * the snapshot run and the Portfolio read one row per lot. Rebuilt from the sales by the snapshot
 * run; see `runSnapshots`.
 */
export const holdingValues = sqliteTable(
  'holding_values',
  {
    holdingId: text('holding_id').primaryKey(),
    userId: text('user_id').notNull(),
    days: text('days', { mode: 'json' }).notNull().$type<Record<string, DayValue>>(),
    updatedAt: text('updated_at')
      .notNull()
      .$defaultFn(() => toLocalIso())
      .$onUpdateFn(() => toLocalIso()),
  },
  (t) => [index('holding_values_user_idx').on(t.userId)],
);

/**
 * Market value of a product in one bucket ('' for none) as of `computedAt`, without the user's
 * manual prices: the valuation's result from all sales, saved at the end of each collect so pages
 * read one row instead of every sale (S8 speed). Rows are deleted when the product's sales or
 * details change; a missing or old row is valued live and saved again.
 */
export const bucketValues = sqliteTable(
  'bucket_values',
  {
    id: id(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    bucket: text('bucket').notNull(),
    computedAt: text('computed_at').notNull(),
    value: text('value', { mode: 'json' }).notNull().$type<unknown>(),
    ...timestamps,
  },
  (t) => [uniqueIndex('bucket_values_product_bucket_uq').on(t.productId, t.bucket)],
);

/**
 * Price sources and shops as their plug-ins describe them (requirements S8, sources with roles),
 * saved by the collectors on each run so the app can read them. `roles` is the admin's choice
 * per item class (null: the plug-in's suggestion); `quality` is the last quality check.
 */
export const sources = sqliteTable('sources', {
  key: text('key').primaryKey(),
  info: text('info', { mode: 'json' }).notNull().$type<SourceInfo>(),
  roles: text('roles', { mode: 'json' }).$type<Partial<Record<ProductClass, SourceRole>>>(),
  quality: text('quality', { mode: 'json' }).$type<unknown>(),
  ...timestamps,
});

/** Settings for the whole app, set by an admin (requirements S11): e.g. `markets`. */
export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).notNull().$type<unknown>(),
  ...timestamps,
});

/**
 * Purchase files uploaded in the app for the import through Claude (requirements S8 step 5):
 * screenshots, PDFs, text. Read right away by the app when it has a Claude API key, else by the
 * home PC on its next run; the file's data is dropped once read.
 */
export const importUploads = sqliteTable(
  'import_uploads',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    /** Files uploaded together are read together (one purchase may span several files). */
    batchId: text('batch_id').notNull(),
    name: text('name').notNull(),
    size: integer('size').notNull(),
    /** Base64; emptied once read. */
    data: text('data').notNull(),
    /** uploading | waiting | reading | done | failed */
    status: text('status').notNull().default('waiting'),
    message: text('message'),
    importRunId: text('import_run_id'),
    ...timestamps,
  },
  (t) => [
    index('import_uploads_batch_idx').on(t.batchId),
    index('import_uploads_user_idx').on(t.userId, t.status),
  ],
);

export const fxRates = sqliteTable(
  'fx_rates',
  {
    id: id(),
    date: text('date').notNull(),
    pair: text('pair').notNull(),
    rate: real('rate').notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex('fx_rates_date_pair_uq').on(t.date, t.pair)],
);

export const collectorRuns = sqliteTable(
  'collector_runs',
  {
    id: id(),
    source: text('source').notNull(),
    startedAt: text('started_at').notNull(),
    finishedAt: text('finished_at'),
    status: text('status', { enum: COLLECTOR_RUN_STATUSES }).notNull(),
    requests: integer('requests').notNull().default(0),
    observationsAdded: integer('observations_added').notNull().default(0),
    /** Working time in ms, without time the PC slept (S16); null for older runs. */
    activeMs: integer('active_ms'),
    error: text('error'),
    ...timestamps,
  },
  (t) => [
    check('collector_runs_status_check', oneOf(t.status, COLLECTOR_RUN_STATUSES)),
    index('collector_runs_source_idx').on(t.source, t.startedAt),
  ],
);

export const loginAttempts = sqliteTable(
  'login_attempts',
  {
    id: id(),
    ipHash: text('ip_hash').notNull(),
    usernameHash: text('username_hash'),
    attemptedAt: text('attempted_at').notNull(),
    success: integer('success', { mode: 'boolean' }).notNull(),
    ...timestamps,
  },
  (t) => [
    index('login_attempts_ip_idx').on(t.ipHash, t.attemptedAt),
    index('login_attempts_user_idx').on(t.usernameHash, t.attemptedAt),
    index('login_attempts_time_idx').on(t.attemptedAt),
  ],
);

/** Activity log kinds and levels (requirements S17). */
export const ACTIVITY_KINDS = ['collect', 'backup', 'import', 'admin', 'check'] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];
export const ACTIVITY_LEVELS = ['ok', 'problem', 'failed'] as const;
export type ActivityLevel = (typeof ACTIVITY_LEVELS)[number];

/**
 * The activity log (requirements S17): collects, backups, imports, admin changes and the app's
 * daily check, newest first on Settings > Activity. Also the admin audit log.
 */
export const activity = sqliteTable(
  'activity',
  {
    id: id(),
    /** Whose entry it is (an import's owner); null for the whole app (admins see it). */
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    /** Who did it; null for the home PC's runs and the terminal. */
    actorId: text('actor_id').references(() => users.id, { onDelete: 'set null' }),
    kind: text('kind', { enum: ACTIVITY_KINDS }).notNull(),
    /** What exactly, per kind: an import's method, an admin setting's key, a check's subject. */
    action: text('action'),
    level: text('level', { enum: ACTIVITY_LEVELS }).notNull(),
    /** What the app shows, per kind (counts, sources, from and to). */
    detail: text('detail', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
    /** The page it is about. */
    href: text('href'),
    occurredAt: text('occurred_at').notNull(),
    /** When an alert about it went out (at once, or in a daily summary). */
    alertedAt: text('alerted_at'),
    ...timestamps,
  },
  (t) => [
    check('activity_kind_check', oneOf(t.kind, ACTIVITY_KINDS)),
    check('activity_level_check', oneOf(t.level, ACTIVITY_LEVELS)),
    index('activity_time_idx').on(t.occurredAt),
    index('activity_user_idx').on(t.userId, t.occurredAt),
  ],
);

/**
 * Items a person watches to buy (requirements S9): one row per item and condition, with an
 * optional target price. Watched items are matched and collected like owned ones. The condition
 * is kept in a lot's fields (so forms and labels are shared) and as its valuation bucket.
 */
export const watches = sqliteTable(
  'watches',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    condition: text('condition', { enum: CONDITIONS }),
    packagingState: text('packaging_state', { enum: PACKAGING_STATES }),
    grading: text('grading', { enum: GRADINGS }),
    rawGrade: text('raw_grade', { enum: RAW_GRADES }),
    grader: text('grader', { enum: GRADERS }),
    grade: text('grade'),
    conditionValue: text('condition_value'),
    /** The valuation bucket of the condition above ('' when the item has no condition). */
    bucket: text('bucket').notNull(),
    /** Buy at or under this, per unit, in the base currency. */
    targetPriceBase: integer('target_price_base'),
    note: text('note'),
    /** Buy zone alerts even when the signal has little data (S9 part 5). */
    alertLimited: integer('alert_limited', { mode: 'boolean' }).notNull().default(true),
    /** What the alerts remember (S9 part 5): the buy zone's and the target's. */
    alertState: text('alert_state', { mode: 'json' }).$type<{
      zone?: AlertState;
      target?: AlertState;
    }>(),
    ...timestamps,
  },
  (t) => [
    check('watches_condition_check', oneOf(t.condition, CONDITIONS)),
    check('watches_packaging_state_check', oneOf(t.packagingState, PACKAGING_STATES)),
    check('watches_grading_check', oneOf(t.grading, GRADINGS)),
    check('watches_raw_grade_check', oneOf(t.rawGrade, RAW_GRADES)),
    check('watches_grader_check', oneOf(t.grader, GRADERS)),
    check('watches_target_check', sql`${t.targetPriceBase} IS NULL OR ${t.targetPriceBase} > 0`),
    uniqueIndex('watches_user_product_bucket_uq').on(t.userId, t.productId, t.bucket),
    index('watches_product_idx').on(t.productId),
  ],
);

/**
 * What is for sale now (S9 part 2): per item, source and condition, the lowest ask and how many
 * listings, once a day with the collect. A bucket with nothing for sale has no ask and 0 listings.
 */
export const supply = sqliteTable(
  'supply',
  {
    id: id(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    source: text('source').notNull(),
    /** Valuation bucket ('' when the source does not say the condition). */
    bucket: text('bucket').notNull(),
    /** The app's local date of the collect. */
    day: text('day').notNull(),
    /** Per unit, in the base currency. */
    lowestAskBase: integer('lowest_ask_base'),
    /** Per unit, in `currency` as the source shows it. */
    lowestAskOriginal: integer('lowest_ask_original'),
    currency: text('currency'),
    fxRate: real('fx_rate'),
    /** Null when the source does not say how many. */
    listings: integer('listings'),
    /** The cheapest listing, or the page listing them. */
    url: text('url'),
    raw: text('raw', { mode: 'json' }).$type<unknown>(),
    fetchedAt: text('fetched_at').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('supply_product_source_bucket_day_uq').on(t.productId, t.source, t.bucket, t.day),
    index('supply_product_day_idx').on(t.productId, t.day),
  ],
);

/**
 * Buy timing numbers (requirements S9 part 4), saved daily per item and condition held or
 * watched, after the collect: fair value, ranges, trends, the lowest ask, the new-set pattern.
 * Each person's strategy turns them into a zone and a verdict when a page opens.
 */
export const signals = sqliteTable(
  'signals',
  {
    id: id(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    /** Valuation bucket ('' none). */
    bucket: text('bucket').notNull(),
    /** The app's local date. */
    day: text('day').notNull(),
    /** The source the daily prices came from (the valuation's). */
    source: text('source'),
    stats: text('stats', { mode: 'json' }).notNull().$type<SignalStats>(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('signals_product_bucket_day_uq').on(t.productId, t.bucket, t.day),
    index('signals_day_idx').on(t.day),
  ],
);

/**
 * Rows the hosted database (Turso) read and wrote, as its replies report them (requirements S19):
 * per day (UTC, like Turso's months) and origin (pages, collect, backup, mcp, ...).
 */
export const dbUsage = sqliteTable(
  'db_usage',
  {
    day: text('day').notNull(),
    origin: text('origin').notNull(),
    rowsRead: integer('rows_read').notNull(),
    rowsWritten: integer('rows_written').notNull(),
  },
  (t) => [uniqueIndex('db_usage_day_origin_uq').on(t.day, t.origin)],
);

/** A day of a person's value-over-time chart. */
export interface PortfolioPoint {
  date: string;
  valueBase: number;
  costBase: number;
  atCostBase: number;
  estimatedBase: number;
}

/**
 * Each person's value-over-time chart (requirements S19): saved by the snapshot run, and by the
 * page when the person's lots changed since (`fingerprint`), so a view does not sum every snapshot.
 */
export const portfolioCharts = sqliteTable('portfolio_charts', {
  userId: text('user_id').primaryKey(),
  /** The lots the series was summed over (ids, costs, tracking switches). */
  fingerprint: text('fingerprint').notNull(),
  series: text('series', { mode: 'json' }).notNull().$type<PortfolioPoint[]>(),
  ...timestamps,
});

export const ALERT_CHANNEL_KINDS = ['telegram', 'discord'] as const;
export type AlertChannelKind = (typeof ALERT_CHANNEL_KINDS)[number];

/**
 * Where a person's alerts go (requirements S17): a Telegram chat with the app's bot, or a Discord
 * webhook. The target (chat ID or webhook link) is encrypted with `AUTH_SECRET`.
 */
export const alertChannels = sqliteTable(
  'alert_channels',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ALERT_CHANNEL_KINDS }).notNull(),
    targetEnc: text('target_enc').notNull(),
    /** What the person sees (a Telegram name, or the webhook's channel). */
    label: text('label'),
    lastSentAt: text('last_sent_at'),
    lastError: text('last_error'),
    ...timestamps,
  },
  (t) => [
    check('alert_channels_kind_check', oneOf(t.kind, ALERT_CHANNEL_KINDS)),
    index('alert_channels_user_idx').on(t.userId),
  ],
);

/**
 * A set's pull rates for the box opening value (S20), entered by the admin (shared). A set
 * without a row uses the suggested rates shipped with Tora, if any.
 */
export const openingSets = sqliteTable('opening_sets', {
  setId: text('set_id')
    .primaryKey()
    .references(() => tcgSets.id, { onDelete: 'cascade' }),
  /** The set code the shops use in card titles ("SV2a"). */
  code: text('code').notNull(),
  packsPerBox: integer('packs_per_box').notNull(),
  tiers: text('tiers', { mode: 'json' }).notNull().$type<PullTier[]>(),
  source: text('source'),
  updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
  ...timestamps,
});

/** A set's hit cards and their prices, read once a week by the home PC (S20). */
export const openingCards = sqliteTable(
  'opening_cards',
  {
    id: id(),
    setId: text('set_id')
      .notNull()
      .references(() => tcgSets.id, { onDelete: 'cascade' }),
    source: text('source').notNull(),
    externalId: text('external_id').notNull(),
    name: text('name').notNull(),
    number: text('number'),
    rarity: text('rarity').notNull(),
    currency: text('currency').notNull(),
    /** Lowest ask, in the currency's smallest unit. */
    ask: integer('ask'),
    /** Median of the recent single raw sales (read for the cards carrying most of the value). */
    sold: integer('sold'),
    sales: integer('sales'),
    url: text('url'),
    /** When the cards were read (local time). */
    readAt: text('read_at').notNull(),
  },
  (t) => [
    uniqueIndex('opening_cards_uq').on(t.setId, t.source, t.externalId),
    index('opening_cards_set_idx').on(t.setId, t.rarity),
  ],
);

/**
 * A site's ranking (S13), one row per day and ranked item: its rank, its page, the price and the
 * activity numbers the site shows, and the item it is (a candidate made for it when nobody tracked
 * it).
 */
export const rankings = sqliteTable(
  'rankings',
  {
    id: id(),
    /** The ranking plug-in's key, and the collector source whose ids its items carry. */
    ranking: text('ranking').notNull(),
    source: text('source').notNull(),
    day: text('day').notNull(),
    rank: integer('rank').notNull(),
    externalId: text('external_id').notNull(),
    productId: text('product_id').references(() => products.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    url: text('url'),
    /** In the source's currency, as shown. */
    price: integer('price'),
    numbers: text('numbers', { mode: 'json' }).$type<Record<string, number>>(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('rankings_uq').on(t.ranking, t.day, t.externalId),
    index('rankings_product_idx').on(t.productId, t.day),
    index('rankings_day_idx').on(t.day),
  ],
);

/** Physical stores for store notices (S25), shared: filled by store directory plug-ins. */
export const stores = sqliteTable(
  'stores',
  {
    id: id(),
    /** The plug-in that lists it ('admin' for one added by hand) and its key there. */
    source: text('source').notNull(),
    sourceKey: text('source_key').notNull(),
    chain: text('chain').notNull(),
    /** The chain as people read it ("ヨドバシカメラ"). */
    chainLabel: text('chain_label'),
    name: text('name').notNull(),
    /** A short label in English for notices ("Yodobashi Ikebukuro"; a place: "Ikebukuro"). */
    labelEn: text('label_en'),
    /** What posters write for it, from the plug-in. */
    codes: text('codes', { mode: 'json' }).notNull().$type<string[]>(),
    /** Codes the admin added. */
    extraCodes: text('extra_codes', { mode: 'json' }).$type<string[]>(),
    region: text('region'),
    lat: real('lat'),
    lon: real('lon'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('stores_source_uq').on(t.source, t.sourceKey),
    index('stores_chain_idx').on(t.chain),
  ],
);

/** Posts about stores pushed by a feed (S25): shared, one per post of a source. */
export const storePosts = sqliteTable(
  'store_posts',
  {
    id: id(),
    source: text('source').notNull(),
    externalId: text('external_id').notNull(),
    /** The board's chain, when it has one. */
    chain: text('chain'),
    text: text('text').notNull(),
    /** The poster's name (some name their store in it). */
    author: text('author'),
    url: text('url'),
    /** When it was posted (local time), else when it was received. */
    postedAt: text('posted_at').notNull(),
    receivedAt: text('received_at').notNull(),
    /** The stores it is about (ids); a reply naming none takes its thread's. */
    storeIds: text('store_ids', { mode: 'json' }).notNull().$type<string[]>(),
    /** A reply: the post it answers, and its thread's first post (external ids). */
    replyTo: text('reply_to'),
    thread: text('thread'),
    fedBy: text('fed_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    uniqueIndex('store_posts_uq').on(t.source, t.externalId),
    index('store_posts_posted_idx').on(t.postedAt),
  ],
);

/** A board's state in a feed (S25). */
export interface BoardState {
  at: string;
  posts: number;
  readAt: string | null;
  alertedAt?: string | null;
}

/** A person's feed token (S25): the hash only; when and what it last sent. */
export const feedTokens = sqliteTable(
  'feed_tokens',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    lastSeenAt: text('last_seen_at'),
    lastSource: text('last_source'),
    /** When the person was told the feed went silent (cleared when it speaks again). */
    silenceAlertedAt: text('silence_alerted_at'),
    /**
     * Each board the feed reads (key: the board, else its chain, else the feed): its last visit, how
     * many posts it read then, the last visit that read any, and when its person was told it read
     * none for too long.
     */
    boards: text('boards', { mode: 'json' }).$type<Record<string, BoardState>>(),
    /** The boards the feed says it watches (told when it connects or the list changes). */
    watching: text('watching', { mode: 'json' }).$type<string[]>(),
    /** The boards the feed can read (to choose from in the app). */
    offered: text('offered', { mode: 'json' }).$type<string[]>(),
    ...timestamps,
  },
  (t) => [index('feed_tokens_hash_idx').on(t.tokenHash)],
);

/** The last store notice a person was sent per store: posts close together make one notice. */
export const storeNotices = sqliteTable(
  'store_notices',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    sentAt: text('sent_at').notNull(),
  },
  (t) => [uniqueIndex('store_notices_uq').on(t.userId, t.storeId)],
);

export type User = typeof users.$inferSelect;
export type PurchaseLink = typeof purchaseLinks.$inferSelect;
export type ImportRun = typeof importRuns.$inferSelect;
export type ImportRow = typeof importRows.$inferSelect;
export type NewImportRow = typeof importRows.$inferInsert;
export type Suggestion = typeof suggestions.$inferSelect;
export type UserDevice = typeof userDevices.$inferSelect;
export type AccountSetup = typeof accountSetups.$inferSelect;
export type TcgSet = typeof tcgSets.$inferSelect;
export type NewTcgSet = typeof tcgSets.$inferInsert;
export type Product = typeof products.$inferSelect;
export type Ranking = typeof rankings.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type ProductSource = typeof productSources.$inferSelect;
export type SourceCandidate = typeof sourceCandidates.$inferSelect;
export type NewPriceObservation = typeof priceObservations.$inferInsert;
export type Holding = typeof holdings.$inferSelect;
export type NewHolding = typeof holdings.$inferInsert;
export type HoldingEvent = typeof holdingEvents.$inferSelect;
export type NewHoldingEvent = typeof holdingEvents.$inferInsert;
export type PriceObservation = typeof priceObservations.$inferSelect;
export type CollectorRun = typeof collectorRuns.$inferSelect;
export type Activity = typeof activity.$inferSelect;
export type AlertChannel = typeof alertChannels.$inferSelect;
export type Watch = typeof watches.$inferSelect;
export type Signal = typeof signals.$inferSelect;
export type Supply = typeof supply.$inferSelect;
export type OpeningSet = typeof openingSets.$inferSelect;
export type Store = typeof stores.$inferSelect;
export type StorePost = typeof storePosts.$inferSelect;
export type OpeningCardRow = typeof openingCards.$inferSelect;
