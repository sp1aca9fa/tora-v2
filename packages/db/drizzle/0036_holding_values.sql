CREATE TABLE `holding_values` (
	`holding_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`days` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `holding_values_user_idx` ON `holding_values` (`user_id`);