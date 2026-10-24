CREATE TABLE `store_post_images` (
	`id` text PRIMARY KEY NOT NULL,
	`post_id` text NOT NULL,
	`position` integer NOT NULL,
	`bytes` blob NOT NULL,
	`content_type` text NOT NULL,
	`source_url` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `store_posts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `store_post_images_post_idx` ON `store_post_images` (`post_id`);--> statement-breakpoint
CREATE INDEX `store_post_images_created_idx` ON `store_post_images` (`created_at`);