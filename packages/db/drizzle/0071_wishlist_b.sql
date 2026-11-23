CREATE TABLE `market_days` (
	`source` text NOT NULL,
	`day` text NOT NULL,
	`used` integer DEFAULT 0 NOT NULL,
	`limit_that_day` integer NOT NULL,
	PRIMARY KEY(`source`, `day`)
);
--> statement-breakpoint
CREATE TABLE `market_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`product_id` text,
	`kind` text NOT NULL,
	`status` text DEFAULT 'waiting' NOT NULL,
	`wanted_from` text,
	`cursor` text,
	`oldest_reached` text,
	`requests` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`started_at` text,
	`finished_at` text,
	`error` text,
	`failures` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `market_jobs_queue_idx` ON `market_jobs` (`source`,`status`,`kind`,`created_at`);--> statement-breakpoint
CREATE INDEX `market_jobs_product_idx` ON `market_jobs` (`product_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `market_jobs_active_uq` ON `market_jobs` (`source`,ifnull(`product_id`, ''),`kind`) WHERE status IN ('waiting', 'running');--> statement-breakpoint
CREATE TABLE `market_state` (
	`source` text PRIMARY KEY NOT NULL,
	`per_day` integer NOT NULL,
	`wait_until` text,
	`stopped` integer DEFAULT false NOT NULL,
	`last_refusal_at` text,
	`refusals` integer DEFAULT 0 NOT NULL,
	`restarted_by` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`restarted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
