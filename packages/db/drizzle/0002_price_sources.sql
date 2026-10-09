CREATE TABLE `source_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`source` text NOT NULL,
	`external_id` text NOT NULL,
	`title` text NOT NULL,
	`url` text,
	`image_url` text,
	`price_jpy` integer,
	`score` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "source_candidates_status_check" CHECK("source_candidates"."status" IN ('pending', 'rejected'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_candidates_uq` ON `source_candidates` (`product_id`,`source`,`external_id`);--> statement-breakpoint
CREATE INDEX `source_candidates_pending_idx` ON `source_candidates` (`source`,`status`);--> statement-breakpoint
ALTER TABLE `product_sources` ADD `title` text;--> statement-breakpoint
ALTER TABLE `product_sources` ADD `url` text;--> statement-breakpoint
ALTER TABLE `product_sources` ADD `state` text;--> statement-breakpoint
CREATE UNIQUE INDEX `product_sources_external_uq` ON `product_sources` (`product_id`,`source`,`external_id`);