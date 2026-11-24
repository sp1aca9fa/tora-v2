CREATE TABLE `item_facts` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`day` text NOT NULL,
	`kind` text NOT NULL,
	`text` text,
	`source_url` text,
	`withdraws_id` text,
	`recorded_by` text,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recorded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "item_facts_kind_check" CHECK("item_facts"."kind" IN ('rerelease', 'port', 'price_cut', 'not_sold_new', 'digital_sale', 'other'))
);
--> statement-breakpoint
CREATE INDEX `item_facts_product_idx` ON `item_facts` (`product_id`,`day`);--> statement-breakpoint
CREATE TABLE `wish_estimates` (
	`id` text PRIMARY KEY NOT NULL,
	`watch_id` text NOT NULL,
	`user_id` text NOT NULL,
	`low` integer NOT NULL,
	`high` integer NOT NULL,
	`currency` text NOT NULL,
	`settle_by` text,
	`risks` text NOT NULL,
	`basis` text,
	`sources` text NOT NULL,
	`entered_at` text NOT NULL,
	FOREIGN KEY (`watch_id`) REFERENCES `watches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "wish_estimates_range_check" CHECK("wish_estimates"."low" > 0 AND "wish_estimates"."high" >= "wish_estimates"."low"),
	CONSTRAINT "wish_estimates_basis_check" CHECK("wish_estimates"."basis" IN ('own_history', 'kind', 'outside', 'research'))
);
--> statement-breakpoint
CREATE INDEX `wish_estimates_watch_idx` ON `wish_estimates` (`watch_id`,`entered_at`);--> statement-breakpoint
CREATE INDEX `wish_estimates_user_idx` ON `wish_estimates` (`user_id`);--> statement-breakpoint
CREATE TABLE `wish_levels` (
	`product_id` text NOT NULL,
	`bucket` text NOT NULL,
	`series` text NOT NULL,
	`record` text,
	`born_on` text,
	`inputs_hash` text NOT NULL,
	`computed_at` text NOT NULL,
	PRIMARY KEY(`product_id`, `bucket`),
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
