CREATE TABLE `portfolio_charts` (
	`user_id` text PRIMARY KEY NOT NULL,
	`fingerprint` text NOT NULL,
	`series` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `price_days_source_day_idx` ON `price_days` (`source`,`day`);