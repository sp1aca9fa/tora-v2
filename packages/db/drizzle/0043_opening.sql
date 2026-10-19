CREATE TABLE `opening_cards` (
	`id` text PRIMARY KEY NOT NULL,
	`set_id` text NOT NULL,
	`source` text NOT NULL,
	`external_id` text NOT NULL,
	`name` text NOT NULL,
	`number` text,
	`rarity` text NOT NULL,
	`currency` text NOT NULL,
	`ask` integer,
	`sold` integer,
	`sales` integer,
	`url` text,
	`read_at` text NOT NULL,
	FOREIGN KEY (`set_id`) REFERENCES `tcg_sets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `opening_cards_uq` ON `opening_cards` (`set_id`,`source`,`external_id`);--> statement-breakpoint
CREATE INDEX `opening_cards_set_idx` ON `opening_cards` (`set_id`,`rarity`);--> statement-breakpoint
CREATE TABLE `opening_sets` (
	`set_id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`packs_per_box` integer NOT NULL,
	`tiers` text NOT NULL,
	`source` text,
	`updated_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`set_id`) REFERENCES `tcg_sets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
