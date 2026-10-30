CREATE TABLE `lottery_marks` (
	`user_id` text NOT NULL,
	`post_id` text NOT NULL,
	`mark` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`post_id`) REFERENCES `store_posts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lottery_marks_uq` ON `lottery_marks` (`user_id`,`post_id`);