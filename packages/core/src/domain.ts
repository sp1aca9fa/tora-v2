// Enumerations shared by the schema, domain logic and UI (requirements section 5).

export const PRODUCT_TYPES = [
  'card_single',
  'sealed_tcg',
  'game_ce',
  'game',
  'amiibo',
  'controller',
  'figure',
  'other',
] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

export const LANGUAGES = ['JP', 'EN', 'other'] as const;
export type Language = (typeof LANGUAGES)[number];

export const SOURCES = ['snkrdunk', 'mercari', 'surugaya', 'tcgcsv', 'ebay', 'manual'] as const;
export type Source = (typeof SOURCES)[number];

export const ACQUISITION_TYPES = ['purchase', 'pull', 'gift', 'trade'] as const;
export type AcquisitionType = (typeof ACQUISITION_TYPES)[number];

/** Mercari condition scale. */
export const CONDITIONS = [
  'new_unused',
  'like_new',
  'no_noticeable_damage',
  'minor_damage',
  'damaged',
  'poor',
] as const;
export type Condition = (typeof CONDITIONS)[number];

export const PACKAGING_STATES = [
  'sealed_shrink',
  'sealed_no_shrink',
  'box_opened_contents_sealed',
  'opened',
  'empty',
  'n/a',
] as const;
export type PackagingState = (typeof PACKAGING_STATES)[number];

export const GRADINGS = ['raw', 'graded'] as const;
export type Grading = (typeof GRADINGS)[number];

/** SNKRDUNK-style raw card grades. */
export const RAW_GRADES = ['S', 'A', 'B', 'C', 'D'] as const;
export type RawGrade = (typeof RAW_GRADES)[number];

export const GRADERS = ['PSA', 'BGS', 'CGC', 'ARS', 'other'] as const;
export type Grader = (typeof GRADERS)[number];

export const HOLDING_STATUSES = ['owned', 'sold', 'consumed', 'lost'] as const;
export type HoldingStatus = (typeof HOLDING_STATUSES)[number];

export const HOLDING_EVENT_TYPES = [
  'acquired',
  'split',
  'opened',
  'grading_submitted',
  'grading_returned',
  'condition_changed',
  'sold',
  'note',
] as const;
export type HoldingEventType = (typeof HOLDING_EVENT_TYPES)[number];

export const OBSERVATION_TYPES = ['sold', 'listing', 'buylist', 'retail'] as const;
export type ObservationType = (typeof OBSERVATION_TYPES)[number];

export const EXCLUDED_REASONS = ['outlier', 'manual', 'mismatch'] as const;
export type ExcludedReason = (typeof EXCLUDED_REASONS)[number];

export const VALUATION_CONFIDENCES = ['high', 'medium', 'low'] as const;
export type ValuationConfidence = (typeof VALUATION_CONFIDENCES)[number];

export const COLLECTOR_RUN_STATUSES = ['running', 'ok', 'partial', 'failed', 'blocked'] as const;
export type CollectorRunStatus = (typeof COLLECTOR_RUN_STATUSES)[number];

/** Product types that come in a box / packaging, so packaging_state applies. */
export const PACKAGED_TYPES: readonly ProductType[] = [
  'sealed_tcg',
  'game_ce',
  'game',
  'amiibo',
  'controller',
  'figure',
];
