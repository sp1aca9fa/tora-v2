CREATE TABLE `import_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`method` text NOT NULL,
	`source` text,
	`started_at` text NOT NULL,
	`finished_at` text,
	`counts` text DEFAULT '{}' NOT NULL,
	`note` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `holdings` ADD `import_run_id` text REFERENCES import_runs(id);--> statement-breakpoint
ALTER TABLE `purchase_links` ADD `import_run_id` text REFERENCES import_runs(id);