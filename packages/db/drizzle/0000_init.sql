CREATE TABLE `collector_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`status` text NOT NULL,
	`requests` integer DEFAULT 0 NOT NULL,
	`observations_added` integer DEFAULT 0 NOT NULL,
	`error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "collector_runs_status_check" CHECK("collector_runs"."status" IN ('running', 'ok', 'partial', 'failed', 'blocked'))
);
--> statement-breakpoint
CREATE INDEX `collector_runs_source_idx` ON `collector_runs` (`source`,`started_at`);--> statement-breakpoint
CREATE TABLE `fx_rates` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`pair` text NOT NULL,
	`rate` real NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fx_rates_date_pair_uq` ON `fx_rates` (`date`,`pair`);--> statement-breakpoint
CREATE TABLE `holding_events` (
	`id` text PRIMARY KEY NOT NULL,
	`holding_id` text NOT NULL,
	`type` text NOT NULL,
	`occurred_at` text NOT NULL,
	`amount_jpy` integer,
	`fees_jpy` integer,
	`payload` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`holding_id`) REFERENCES `holdings`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "holding_events_type_check" CHECK("holding_events"."type" IN ('acquired', 'split', 'opened', 'grading_submitted', 'grading_returned', 'condition_changed', 'sold', 'note'))
);
--> statement-breakpoint
CREATE INDEX `holding_events_holding_idx` ON `holding_events` (`holding_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `holdings` (
	`id` text PRIMARY KEY NOT NULL,
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
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_holding_id`) REFERENCES `holdings`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "holdings_quantity_check" CHECK("holdings"."quantity" >= 1),
	CONSTRAINT "holdings_cost_check" CHECK("holdings"."cost_total_jpy" >= 0),
	CONSTRAINT "holdings_acquisition_type_check" CHECK("holdings"."acquisition_type" IN ('purchase', 'pull', 'gift', 'trade')),
	CONSTRAINT "holdings_condition_check" CHECK("holdings"."condition" IN ('new_unused', 'like_new', 'no_noticeable_damage', 'minor_damage', 'damaged', 'poor')),
	CONSTRAINT "holdings_packaging_state_check" CHECK("holdings"."packaging_state" IN ('sealed_shrink', 'sealed_no_shrink', 'box_opened_contents_sealed', 'opened', 'empty', 'n/a')),
	CONSTRAINT "holdings_grading_check" CHECK("holdings"."grading" IN ('raw', 'graded')),
	CONSTRAINT "holdings_raw_grade_check" CHECK("holdings"."raw_grade" IN ('S', 'A', 'B', 'C', 'D')),
	CONSTRAINT "holdings_grader_check" CHECK("holdings"."grader" IN ('PSA', 'BGS', 'CGC', 'ARS', 'other')),
	CONSTRAINT "holdings_status_check" CHECK("holdings"."status" IN ('owned', 'sold', 'consumed', 'lost'))
);
--> statement-breakpoint
CREATE INDEX `holdings_product_idx` ON `holdings` (`product_id`);--> statement-breakpoint
CREATE INDEX `holdings_parent_idx` ON `holdings` (`parent_holding_id`);--> statement-breakpoint
CREATE INDEX `holdings_status_idx` ON `holdings` (`status`);--> statement-breakpoint
CREATE TABLE `login_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`ip_hash` text NOT NULL,
	`attempted_at` text NOT NULL,
	`success` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `login_attempts_ip_idx` ON `login_attempts` (`ip_hash`,`attempted_at`);--> statement-breakpoint
CREATE INDEX `login_attempts_time_idx` ON `login_attempts` (`attempted_at`);--> statement-breakpoint
CREATE TABLE `manual_prices` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`bucket` text NOT NULL,
	`price_jpy` integer NOT NULL,
	`set_at` text NOT NULL,
	`note` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `manual_prices_lookup_idx` ON `manual_prices` (`product_id`,`bucket`,`set_at`);--> statement-breakpoint
CREATE TABLE `price_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`source` text NOT NULL,
	`observation_type` text NOT NULL,
	`bucket` text,
	`price_jpy` integer NOT NULL,
	`price_original` integer,
	`currency` text,
	`fx_rate` real,
	`observed_at` text NOT NULL,
	`fetched_at` text NOT NULL,
	`external_ref` text NOT NULL,
	`title` text,
	`url` text,
	`raw` text,
	`excluded` integer DEFAULT false NOT NULL,
	`excluded_reason` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "price_observations_type_check" CHECK("price_observations"."observation_type" IN ('sold', 'listing', 'buylist', 'retail')),
	CONSTRAINT "price_observations_excluded_reason_check" CHECK("price_observations"."excluded_reason" IN ('outlier', 'manual', 'mismatch'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `price_observations_source_ref_uq` ON `price_observations` (`source`,`external_ref`);--> statement-breakpoint
CREATE INDEX `price_observations_lookup_idx` ON `price_observations` (`product_id`,`bucket`,`observed_at`);--> statement-breakpoint
CREATE TABLE `product_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`source` text NOT NULL,
	`external_id` text,
	`query` text,
	`active` integer DEFAULT true NOT NULL,
	`last_success_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `product_sources_product_idx` ON `product_sources` (`product_id`);--> statement-breakpoint
CREATE INDEX `product_sources_source_idx` ON `product_sources` (`source`,`active`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`name_ja` text,
	`name_en` text,
	`franchise` text,
	`set_name` text,
	`set_code` text,
	`card_number` text,
	`rarity` text,
	`language` text,
	`release_date` text,
	`retail_price_jpy` integer,
	`image_url` text,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "products_type_check" CHECK("products"."type" IN ('card_single', 'sealed_tcg', 'game_ce', 'game', 'amiibo', 'controller', 'figure', 'other')),
	CONSTRAINT "products_language_check" CHECK("products"."language" IN ('JP', 'EN', 'other')),
	CONSTRAINT "products_name_check" CHECK("products"."name_ja" IS NOT NULL OR "products"."name_en" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX `products_type_idx` ON `products` (`type`);--> statement-breakpoint
CREATE TABLE `valuation_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`holding_id` text NOT NULL,
	`value_jpy` integer,
	`method` text NOT NULL,
	`source` text,
	`sample_size` integer DEFAULT 0 NOT NULL,
	`confidence` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`holding_id`) REFERENCES `holdings`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "valuation_snapshots_confidence_check" CHECK("valuation_snapshots"."confidence" IN ('high', 'medium', 'low'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `valuation_snapshots_date_holding_uq` ON `valuation_snapshots` (`date`,`holding_id`);