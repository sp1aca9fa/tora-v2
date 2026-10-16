CREATE TABLE `signals` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`bucket` text NOT NULL,
	`day` text NOT NULL,
	`source` text,
	`stats` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `signals_product_bucket_day_uq` ON `signals` (`product_id`,`bucket`,`day`);--> statement-breakpoint
CREATE INDEX `signals_day_idx` ON `signals` (`day`);