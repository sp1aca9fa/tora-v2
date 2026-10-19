CREATE TABLE `feed_tokens` (
	`user_id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`last_seen_at` text,
	`last_source` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `store_notices` (
	`user_id` text NOT NULL,
	`store_id` text NOT NULL,
	`sent_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `store_notices_uq` ON `store_notices` (`user_id`,`store_id`);--> statement-breakpoint
CREATE TABLE `store_posts` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`external_id` text NOT NULL,
	`chain` text,
	`text` text NOT NULL,
	`url` text,
	`posted_at` text NOT NULL,
	`received_at` text NOT NULL,
	`store_ids` text NOT NULL,
	`fed_by` text,
	FOREIGN KEY (`fed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `store_posts_uq` ON `store_posts` (`source`,`external_id`);--> statement-breakpoint
CREATE INDEX `store_posts_posted_idx` ON `store_posts` (`posted_at`);--> statement-breakpoint
CREATE TABLE `stores` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`source_key` text NOT NULL,
	`chain` text NOT NULL,
	`chain_label` text,
	`name` text NOT NULL,
	`codes` text NOT NULL,
	`extra_codes` text,
	`region` text,
	`lat` real,
	`lon` real,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stores_source_uq` ON `stores` (`source`,`source_key`);--> statement-breakpoint
CREATE INDEX `stores_chain_idx` ON `stores` (`chain`);