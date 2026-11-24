CREATE TABLE `tracked_games` (
	`product_id` text PRIMARY KEY NOT NULL,
	`tier` text DEFAULT 'chosen' NOT NULL,
	`on_pc` integer DEFAULT false NOT NULL,
	`on_pc_at` text,
	`added_by` text,
	`added_at` text NOT NULL,
	`shop_slot` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`added_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "tracked_games_tier_check" CHECK("tracked_games"."tier" IN ('chosen', 'rest', 'removed')),
	CONSTRAINT "tracked_games_slot_check" CHECK("tracked_games"."shop_slot" BETWEEN 0 AND 6)
);
--> statement-breakpoint
CREATE INDEX `tracked_games_slot_idx` ON `tracked_games` (`tier`,`shop_slot`);