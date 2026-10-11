CREATE TABLE `suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`target_key` text NOT NULL,
	`product_id` text,
	`payload` text DEFAULT '{}' NOT NULL,
	`reason` text NOT NULL,
	`evidence` text,
	`model` text,
	`confidence` real,
	`status` text DEFAULT 'open' NOT NULL,
	`decided_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `suggestions_uq` ON `suggestions` (`user_id`,`kind`,`target_key`);--> statement-breakpoint
CREATE INDEX `suggestions_status_idx` ON `suggestions` (`user_id`,`status`);