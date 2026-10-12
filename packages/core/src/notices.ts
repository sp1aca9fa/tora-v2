// Notice types and levels (requirements S8): every action the app asks of the user has a type,
// and each type a level that sets its colour and order. Defaults follow what moves value: gaps
// that make TCG values wrong or missing are red, game and secondary gaps blue. Users will be able
// to assign levels per type in Settings.

/** Levels, most urgent first. */
export const NOTICE_LEVELS = ['red', 'orange', 'yellow', 'blue', 'grey'] as const;
export type NoticeLevel = (typeof NOTICE_LEVELS)[number];

export const NOTICE_TYPES = [
  /** A card or sealed TCG item without its main price source (SNKRDUNK). */
  'tcg_main_source',
  /** A game or other item without its main price source (駿河屋). */
  'game_main_source',
  /** Suggested listings of another source (e.g. TCGplayer for a card linked to SNKRDUNK). */
  'second_source',
  /** A card lot without a grade: not valued. */
  'card_grade',
  /** A game lot without a condition: not valued. */
  'game_condition',
  /** Imported lots waiting for the import review. */
  'import_review',
  /** Purchase links that could not be imported. */
  'failed_link',
  /** Data review suggestions waiting for a decision. */
  'data_review',
] as const;
export type NoticeType = (typeof NOTICE_TYPES)[number];

export const DEFAULT_NOTICE_LEVELS: Record<NoticeType, NoticeLevel> = {
  tcg_main_source: 'red',
  card_grade: 'red',
  import_review: 'orange',
  failed_link: 'yellow',
  data_review: 'yellow',
  game_main_source: 'blue',
  game_condition: 'blue',
  second_source: 'blue',
};

export const noticeRank = (level: NoticeLevel) => NOTICE_LEVELS.indexOf(level);
