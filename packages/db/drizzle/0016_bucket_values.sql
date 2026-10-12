CREATE TABLE `bucket_values` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`bucket` text NOT NULL,
	`computed_at` text NOT NULL,
	`value` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bucket_values_product_bucket_uq` ON `bucket_values` (`product_id`,`bucket`);