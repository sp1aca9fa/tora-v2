CREATE TABLE `cancelled_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`order_source` text NOT NULL,
	`order_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cancelled_orders_uq` ON `cancelled_orders` (`user_id`,`order_source`,`order_id`);--> statement-breakpoint
ALTER TABLE `holdings` ADD `review_reason` text;