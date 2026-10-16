CREATE TABLE `supply` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`source` text NOT NULL,
	`bucket` text NOT NULL,
	`day` text NOT NULL,
	`lowest_ask_base` integer,
	`lowest_ask_original` integer,
	`currency` text,
	`fx_rate` real,
	`listings` integer,
	`url` text,
	`raw` text,
	`fetched_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `supply_product_source_bucket_day_uq` ON `supply` (`product_id`,`source`,`bucket`,`day`);--> statement-breakpoint
CREATE INDEX `supply_product_day_idx` ON `supply` (`product_id`,`day`);