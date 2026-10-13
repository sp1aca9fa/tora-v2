CREATE TABLE `import_uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`batch_id` text NOT NULL,
	`name` text NOT NULL,
	`size` integer NOT NULL,
	`data` text NOT NULL,
	`status` text DEFAULT 'waiting' NOT NULL,
	`message` text,
	`import_run_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `import_uploads_batch_idx` ON `import_uploads` (`batch_id`);--> statement-breakpoint
CREATE INDEX `import_uploads_user_idx` ON `import_uploads` (`user_id`,`status`);