CREATE TABLE `activity` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`actor_id` text,
	`kind` text NOT NULL,
	`action` text,
	`level` text NOT NULL,
	`detail` text DEFAULT '{}' NOT NULL,
	`href` text,
	`occurred_at` text NOT NULL,
	`alerted_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "activity_kind_check" CHECK("activity"."kind" IN ('collect', 'backup', 'import', 'admin', 'check')),
	CONSTRAINT "activity_level_check" CHECK("activity"."level" IN ('ok', 'problem', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `activity_time_idx` ON `activity` (`occurred_at`);--> statement-breakpoint
CREATE INDEX `activity_user_idx` ON `activity` (`user_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `alert_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`target_enc` text NOT NULL,
	`label` text,
	`last_sent_at` text,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "alert_channels_kind_check" CHECK("alert_channels"."kind" IN ('telegram', 'discord'))
);
--> statement-breakpoint
CREATE INDEX `alert_channels_user_idx` ON `alert_channels` (`user_id`);