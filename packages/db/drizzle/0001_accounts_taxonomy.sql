CREATE TABLE `tcg_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`franchise` text NOT NULL,
	`region` text,
	`code` text,
	`name` text NOT NULL,
	`name_alias` text,
	`set_type` text NOT NULL,
	`release_date` text,
	`source` text NOT NULL,
	`source_key` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "tcg_sets_region_check" CHECK("tcg_sets"."region" IN ('jp', 'en', 'na', 'eu', 'asia', 'kr', 'zh_cn', 'zh_tw', 'th', 'id', 'other')),
	CONSTRAINT "tcg_sets_type_check" CHECK("tcg_sets"."set_type" IN ('expansion', 'deck', 'special'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tcg_sets_source_uq` ON `tcg_sets` (`source`,`source_key`);--> statement-breakpoint
CREATE INDEX `tcg_sets_franchise_idx` ON `tcg_sets` (`franchise`,`release_date`);--> statement-breakpoint
CREATE TABLE `user_devices` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`label` text,
	`last_seen_at` text NOT NULL,
	`revoked_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `user_devices_user_idx` ON `user_devices` (`user_id`,`revoked_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text,
	`totp_secret_enc` text,
	`totp_last_step` integer,
	`backup_code_hashes` text DEFAULT '[]' NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`disabled_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "users_role_check" CHECK("users"."role" IN ('admin', 'member'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_uq` ON `users` (`username`);--> statement-breakpoint
-- Existing data (single-user era) is assigned to a placeholder account; the first account
-- created with `pnpm user create` claims it.
INSERT INTO `users` (`id`, `username`, `role`, `backup_code_hashes`, `created_at`, `updated_at`)
SELECT '00000000000000000000000000', 'owner', 'admin', '[]', strftime('%Y-%m-%dT%H:%M:%S.000+09:00', 'now', '+9 hours'), strftime('%Y-%m-%dT%H:%M:%S.000+09:00', 'now', '+9 hours')
WHERE EXISTS (SELECT 1 FROM `holdings`) OR EXISTS (SELECT 1 FROM `manual_prices`) OR EXISTS (SELECT 1 FROM `products`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_products` (
	`id` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`name_alias` text,
	`franchise` text,
	`region` text,
	`platform` text,
	`set_id` text,
	`set_name` text,
	`set_code` text,
	`variant` text,
	`card_number` text,
	`rarity` text,
	`release_date` text,
	`retail_price_jpy` integer,
	`image_url` text,
	`notes` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`set_id`) REFERENCES `tcg_sets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "products_category_check" CHECK("__new_products"."category" IN ('tcg', 'game')),
	CONSTRAINT "products_kind_check" CHECK("__new_products"."kind" IN ('single', 'booster_box', 'booster_pack', 'deck', 'special_set', 'supply', 'software', 'collectors_edition', 'amiibo', 'controller', 'figure', 'console', 'other')),
	CONSTRAINT "products_region_check" CHECK("__new_products"."region" IN ('jp', 'en', 'na', 'eu', 'asia', 'kr', 'zh_cn', 'zh_tw', 'th', 'id', 'other')),
	CONSTRAINT "products_name_check" CHECK(length(trim("__new_products"."name")) > 0)
);
--> statement-breakpoint
INSERT INTO `__new_products`("id", "category", "kind", "name", "name_alias", "franchise", "region", "set_name", "set_code", "card_number", "rarity", "release_date", "retail_price_jpy", "image_url", "notes", "created_by", "created_at", "updated_at")
SELECT "id",
  CASE WHEN "type" IN ('card_single', 'sealed_tcg') THEN 'tcg' ELSE 'game' END,
  CASE "type" WHEN 'card_single' THEN 'single' WHEN 'sealed_tcg' THEN 'booster_box' WHEN 'game_ce' THEN 'collectors_edition' WHEN 'game' THEN 'software' ELSE "type" END,
  COALESCE(NULLIF(trim("name_ja"), ''), "name_en"),
  CASE WHEN NULLIF(trim("name_ja"), '') IS NOT NULL AND NULLIF(trim("name_en"), '') IS NOT NULL THEN "name_en" END,
  CASE WHEN "type" IN ('card_single', 'sealed_tcg') THEN
    CASE lower(trim("franchise"))
      WHEN 'pokemon' THEN 'pokemon' WHEN 'pokémon' THEN 'pokemon' WHEN 'one piece' THEN 'one_piece'
      WHEN 'yu-gi-oh!' THEN 'yugioh' WHEN 'yu-gi-oh' THEN 'yugioh' WHEN 'yugioh' THEN 'yugioh'
      WHEN 'magic' THEN 'mtg' WHEN 'magic: the gathering' THEN 'mtg' WHEN 'mtg' THEN 'mtg'
      ELSE "franchise" END
  ELSE "franchise" END,
  CASE "language" WHEN 'JP' THEN 'jp' WHEN 'EN' THEN 'en' WHEN 'other' THEN 'other' END,
  "set_name", "set_code", "card_number", "rarity", "release_date", "retail_price_jpy", "image_url", "notes",
  (SELECT "id" FROM `users` WHERE "id" = '00000000000000000000000000'),
  "created_at", "updated_at"
FROM `products`;--> statement-breakpoint
DROP TABLE `products`;--> statement-breakpoint
ALTER TABLE `__new_products` RENAME TO `products`;--> statement-breakpoint
CREATE INDEX `products_kind_idx` ON `products` (`category`,`kind`);--> statement-breakpoint
CREATE INDEX `products_set_idx` ON `products` (`set_id`,`kind`);--> statement-breakpoint
CREATE TABLE `__new_holdings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`product_id` text NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`cost_total_jpy` integer DEFAULT 0 NOT NULL,
	`acquired_at` text NOT NULL,
	`acquired_from` text,
	`acquisition_type` text DEFAULT 'purchase' NOT NULL,
	`parent_holding_id` text,
	`condition` text,
	`packaging_state` text,
	`grading` text,
	`raw_grade` text,
	`grader` text,
	`grade` text,
	`cert_number` text,
	`status` text DEFAULT 'owned' NOT NULL,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_holding_id`) REFERENCES `holdings`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "holdings_quantity_check" CHECK("__new_holdings"."quantity" >= 1),
	CONSTRAINT "holdings_cost_check" CHECK("__new_holdings"."cost_total_jpy" >= 0),
	CONSTRAINT "holdings_acquisition_type_check" CHECK("__new_holdings"."acquisition_type" IN ('purchase', 'pull', 'gift', 'trade')),
	CONSTRAINT "holdings_condition_check" CHECK("__new_holdings"."condition" IN ('new_unused', 'like_new', 'no_noticeable_damage', 'minor_damage', 'damaged', 'poor')),
	CONSTRAINT "holdings_packaging_state_check" CHECK("__new_holdings"."packaging_state" IN ('sealed_shrink', 'sealed_no_shrink', 'box_opened_contents_sealed', 'opened', 'empty', 'n/a')),
	CONSTRAINT "holdings_grading_check" CHECK("__new_holdings"."grading" IN ('raw', 'graded')),
	CONSTRAINT "holdings_raw_grade_check" CHECK("__new_holdings"."raw_grade" IN ('S', 'A', 'B', 'C', 'D')),
	CONSTRAINT "holdings_grader_check" CHECK("__new_holdings"."grader" IN ('PSA', 'BGS', 'CGC', 'ARS', 'other')),
	CONSTRAINT "holdings_status_check" CHECK("__new_holdings"."status" IN ('owned', 'sold', 'consumed', 'lost'))
);--> statement-breakpoint
INSERT INTO `__new_holdings`("id", "user_id", "product_id", "quantity", "cost_total_jpy", "acquired_at", "acquired_from", "acquisition_type", "parent_holding_id", "condition", "packaging_state", "grading", "raw_grade", "grader", "grade", "cert_number", "status", "notes", "created_at", "updated_at")
SELECT "id", '00000000000000000000000000', "product_id", "quantity", "cost_total_jpy", "acquired_at", "acquired_from", "acquisition_type", "parent_holding_id", "condition", "packaging_state", "grading", "raw_grade", "grader", "grade", "cert_number", "status", "notes", "created_at", "updated_at" FROM `holdings`;--> statement-breakpoint
DROP TABLE `holdings`;--> statement-breakpoint
ALTER TABLE `__new_holdings` RENAME TO `holdings`;--> statement-breakpoint
CREATE INDEX `holdings_user_idx` ON `holdings` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `holdings_product_idx` ON `holdings` (`product_id`);--> statement-breakpoint
CREATE INDEX `holdings_parent_idx` ON `holdings` (`parent_holding_id`);--> statement-breakpoint
CREATE INDEX `holdings_status_idx` ON `holdings` (`status`);--> statement-breakpoint
CREATE TABLE `__new_manual_prices` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`product_id` text NOT NULL,
	`bucket` text NOT NULL,
	`price_jpy` integer NOT NULL,
	`set_at` text NOT NULL,
	`note` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
INSERT INTO `__new_manual_prices`("id", "user_id", "product_id", "bucket", "price_jpy", "set_at", "note", "created_at", "updated_at")
SELECT "id", '00000000000000000000000000', "product_id", "bucket", "price_jpy", "set_at", "note", "created_at", "updated_at" FROM `manual_prices`;--> statement-breakpoint
DROP TABLE `manual_prices`;--> statement-breakpoint
ALTER TABLE `__new_manual_prices` RENAME TO `manual_prices`;--> statement-breakpoint
CREATE INDEX `manual_prices_lookup_idx` ON `manual_prices` (`user_id`,`product_id`,`bucket`,`set_at`);--> statement-breakpoint
ALTER TABLE `login_attempts` ADD `username_hash` text;--> statement-breakpoint
CREATE INDEX `login_attempts_user_idx` ON `login_attempts` (`username_hash`,`attempted_at`);--> statement-breakpoint
PRAGMA foreign_keys=ON;