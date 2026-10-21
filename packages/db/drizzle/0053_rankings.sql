CREATE TABLE `rankings` (
	`id` text PRIMARY KEY NOT NULL,
	`ranking` text NOT NULL,
	`source` text NOT NULL,
	`day` text NOT NULL,
	`rank` integer NOT NULL,
	`external_id` text NOT NULL,
	`product_id` text,
	`title` text NOT NULL,
	`url` text,
	`price` integer,
	`numbers` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rankings_uq` ON `rankings` (`ranking`,`day`,`external_id`);--> statement-breakpoint
CREATE INDEX `rankings_product_idx` ON `rankings` (`product_id`,`day`);--> statement-breakpoint
CREATE INDEX `rankings_day_idx` ON `rankings` (`day`);