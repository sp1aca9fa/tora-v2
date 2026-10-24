CREATE TABLE `alert_log` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`channel_id` text,
	`channel_kind` text NOT NULL,
	`channel_label` text,
	`kind` text,
	`text` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`sent_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`channel_id`) REFERENCES `alert_channels`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "alert_log_channel_kind_check" CHECK("alert_log"."channel_kind" IN ('telegram', 'discord')),
	CONSTRAINT "alert_log_status_check" CHECK("alert_log"."status" IN ('sent', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `alert_log_user_idx` ON `alert_log` (`user_id`,`sent_at`);--> statement-breakpoint
CREATE INDEX `alert_log_time_idx` ON `alert_log` (`sent_at`);