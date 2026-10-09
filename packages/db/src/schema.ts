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
  LANGUAGES,
  OBSERVATION_TYPES,
  PACKAGING_STATES,
  PRODUCT_TYPES,
  RAW_GRADES,
  VALUATION_CONFIDENCES,
  newId,
  toTokyoIso,
} from '@tora/core';
import { type SQL, sql } from 'drizzle-orm';
import {
  type AnySQLiteColumn,
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
    .$defaultFn(() => toTokyoIso()),
  updatedAt: text('updated_at')
    .notNull()
    .$defaultFn(() => toTokyoIso())
    .$onUpdateFn(() => toTokyoIso()),
};

/** `column IN ('a', 'b', ...)`; values are compile-time constants, so inlining is safe. */
function oneOf(column: AnySQLiteColumn, values: readonly string[]): SQL {
  const list = values.map((v) => `'${v.replaceAll("'", "''")}'`).join(', ');
  return sql`${column} IN (${sql.raw(list)})`;
}

export interface SourceQuery {
  keywords?: string[];
  excludeKeywords?: string[];
  categoryId?: string;
  priceMin?: number;
  priceMax?: number;
  extra?: Record<string, unknown>;
}

export const products = sqliteTable(
  'products',
  {
    id: id(),
    type: text('type', { enum: PRODUCT_TYPES }).notNull(),
    nameJa: text('name_ja'),
    nameEn: text('name_en'),
    franchise: text('franchise'),
    setName: text('set_name'),
    setCode: text('set_code'),
    cardNumber: text('card_number'),
    rarity: text('rarity'),
    language: text('language', { enum: LANGUAGES }),
    releaseDate: text('release_date'),
    retailPriceJpy: integer('retail_price_jpy'),
    imageUrl: text('image_url'),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => [
    check('products_type_check', oneOf(t.type, PRODUCT_TYPES)),
    check('products_language_check', oneOf(t.language, LANGUAGES)),
    check('products_name_check', sql`${t.nameJa} IS NOT NULL OR ${t.nameEn} IS NOT NULL`),
    index('products_type_idx').on(t.type),
  ],
);

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
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    lastSuccessAt: text('last_success_at'),
    ...timestamps,
  },
  (t) => [
    index('product_sources_product_idx').on(t.productId),
    index('product_sources_source_idx').on(t.source, t.active),
  ],
);

export const holdings = sqliteTable(
  'holdings',
  {
    id: id(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    quantity: integer('quantity').notNull().default(1),
    costTotalJpy: integer('cost_total_jpy').notNull().default(0),
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
    certNumber: text('cert_number'),
    status: text('status', { enum: HOLDING_STATUSES }).notNull().default('owned'),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => [
    check('holdings_quantity_check', sql`${t.quantity} >= 1`),
    check('holdings_cost_check', sql`${t.costTotalJpy} >= 0`),
    check('holdings_acquisition_type_check', oneOf(t.acquisitionType, ACQUISITION_TYPES)),
    check('holdings_condition_check', oneOf(t.condition, CONDITIONS)),
    check('holdings_packaging_state_check', oneOf(t.packagingState, PACKAGING_STATES)),
    check('holdings_grading_check', oneOf(t.grading, GRADINGS)),
    check('holdings_raw_grade_check', oneOf(t.rawGrade, RAW_GRADES)),
    check('holdings_grader_check', oneOf(t.grader, GRADERS)),
    check('holdings_status_check', oneOf(t.status, HOLDING_STATUSES)),
    index('holdings_product_idx').on(t.productId),
    index('holdings_parent_idx').on(t.parentHoldingId),
    index('holdings_status_idx').on(t.status),
  ],
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
    amountJpy: integer('amount_jpy'),
    feesJpy: integer('fees_jpy'),
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
    priceJpy: integer('price_jpy').notNull(),
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
    ...timestamps,
  },
  (t) => [
    check('price_observations_type_check', oneOf(t.observationType, OBSERVATION_TYPES)),
    check('price_observations_excluded_reason_check', oneOf(t.excludedReason, EXCLUDED_REASONS)),
    uniqueIndex('price_observations_source_ref_uq').on(t.source, t.externalRef),
    index('price_observations_lookup_idx').on(t.productId, t.bucket, t.observedAt),
  ],
);

export const manualPrices = sqliteTable(
  'manual_prices',
  {
    id: id(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    bucket: text('bucket').notNull(),
    priceJpy: integer('price_jpy').notNull(),
    setAt: text('set_at').notNull(),
    note: text('note'),
    ...timestamps,
  },
  (t) => [index('manual_prices_lookup_idx').on(t.productId, t.bucket, t.setAt)],
);

export const valuationSnapshots = sqliteTable(
  'valuation_snapshots',
  {
    id: id(),
    date: text('date').notNull(),
    holdingId: text('holding_id')
      .notNull()
      .references(() => holdings.id),
    valueJpy: integer('value_jpy'),
    method: text('method').notNull(),
    source: text('source'),
    sampleSize: integer('sample_size').notNull().default(0),
    confidence: text('confidence', { enum: VALUATION_CONFIDENCES }),
    ...timestamps,
  },
  (t) => [
    check('valuation_snapshots_confidence_check', oneOf(t.confidence, VALUATION_CONFIDENCES)),
    uniqueIndex('valuation_snapshots_date_holding_uq').on(t.date, t.holdingId),
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
    attemptedAt: text('attempted_at').notNull(),
    success: integer('success', { mode: 'boolean' }).notNull(),
    ...timestamps,
  },
  (t) => [
    index('login_attempts_ip_idx').on(t.ipHash, t.attemptedAt),
    index('login_attempts_time_idx').on(t.attemptedAt),
  ],
);

export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type ProductSource = typeof productSources.$inferSelect;
export type Holding = typeof holdings.$inferSelect;
export type NewHolding = typeof holdings.$inferInsert;
export type HoldingEvent = typeof holdingEvents.$inferSelect;
export type NewHoldingEvent = typeof holdingEvents.$inferInsert;
export type PriceObservation = typeof priceObservations.$inferSelect;
export type CollectorRun = typeof collectorRuns.$inferSelect;
