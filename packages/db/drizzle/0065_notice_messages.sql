CREATE TABLE `notice_messages` (
	`channel_id` text NOT NULL,
	`post_key` text NOT NULL,
	`message_id` text NOT NULL,
	`sent_at` text NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `alert_channels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notice_messages_uq` ON `notice_messages` (`channel_id`,`post_key`);