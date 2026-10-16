CREATE TABLE `watches` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`product_id` text NOT NULL,
	`condition` text,
	`packaging_state` text,
	`grading` text,
	`raw_grade` text,
	`grader` text,
	`grade` text,
	`condition_value` text,
	`bucket` text NOT NULL,
	`target_price_base` integer,
	`note` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "watches_condition_check" CHECK("watches"."condition" IN ('new_unused', 'like_new', 'no_noticeable_damage', 'minor_damage', 'damaged', 'poor')),
	CONSTRAINT "watches_packaging_state_check" CHECK("watches"."packaging_state" IN ('sealed_shrink', 'sealed_no_shrink', 'box_opened_contents_sealed', 'opened', 'empty', 'n/a')),
	CONSTRAINT "watches_grading_check" CHECK("watches"."grading" IN ('raw', 'graded')),
	CONSTRAINT "watches_raw_grade_check" CHECK("watches"."raw_grade" IN ('S', 'A', 'B', 'C', 'D')),
	CONSTRAINT "watches_grader_check" CHECK("watches"."grader" IN ('PSA', 'BGS', 'CGC', 'ARS', 'other')),
	CONSTRAINT "watches_target_check" CHECK("watches"."target_price_base" IS NULL OR "watches"."target_price_base" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `watches_user_product_bucket_uq` ON `watches` (`user_id`,`product_id`,`bucket`);--> statement-breakpoint
CREATE INDEX `watches_product_idx` ON `watches` (`product_id`);