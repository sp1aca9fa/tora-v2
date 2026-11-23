CREATE TABLE `consoles` (
	`key` text PRIMARY KEY NOT NULL,
	`names` text NOT NULL,
	`aliases` text NOT NULL,
	`categories` text NOT NULL,
	`boxed_allowed` integer DEFAULT false NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `item_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`kind` text NOT NULL,
	`source` text NOT NULL,
	`outcome` text NOT NULL,
	`by` text NOT NULL,
	`rules_hash` text NOT NULL,
	`counts` text,
	`user_id` text,
	`note` text,
	`at` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "item_checks_kind_check" CHECK("item_checks"."kind" IN ('sales', 'listings'))
);
--> statement-breakpoint
CREATE INDEX `item_checks_lookup_idx` ON `item_checks` (`product_id`,`kind`,`source`,`at`);--> statement-breakpoint
CREATE TABLE `item_rule_state` (
	`product_id` text PRIMARY KEY NOT NULL,
	`applied_hash` text,
	`applied_at` text,
	`held` text,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `item_rules` (
	`product_id` text PRIMARY KEY NOT NULL,
	`console` text,
	`edition` text,
	`required` text NOT NULL,
	`excluded` text NOT NULL,
	`boxed` integer DEFAULT false NOT NULL,
	`boxed_of` text,
	`game_rules` integer,
	`updated_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`boxed_of`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `not_item_marks` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`source` text NOT NULL,
	`external_ref` text NOT NULL,
	`user_id` text,
	`at` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `not_item_marks_uq` ON `not_item_marks` (`product_id`,`source`,`external_ref`);--> statement-breakpoint
CREATE TABLE `sale_coverage` (
	`product_id` text NOT NULL,
	`source` text NOT NULL,
	`nights` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`product_id`, `source`),
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sale_spans` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`source` text NOT NULL,
	`from_day` text NOT NULL,
	`to_day` text NOT NULL,
	`how` text NOT NULL,
	`job_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "sale_spans_days_check" CHECK("sale_spans"."from_day" <= "sale_spans"."to_day")
);
--> statement-breakpoint
CREATE INDEX `sale_spans_product_idx` ON `sale_spans` (`product_id`,`source`);--> statement-breakpoint
ALTER TABLE `price_observations` ADD `rule_mark` text;--> statement-breakpoint
ALTER TABLE `product_sources` ADD `facts` text;--> statement-breakpoint
ALTER TABLE `supply` ADD `offers` text;--> statement-breakpoint
ALTER TABLE `supply` ADD `listings_capped` integer;