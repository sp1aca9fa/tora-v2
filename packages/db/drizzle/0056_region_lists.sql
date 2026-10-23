PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_products` (
	`id` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`kind` text NOT NULL,
	`item_type` text,
	`name` text NOT NULL,
	`name_alias` text,
	`franchise` text,
	`region` text,
	`platform` text,
	`set_id` text,
	`set_name` text,
	`set_code` text,
	`line` text,
	`variant` text,
	`card_number` text,
	`rarity` text,
	`release_date` text,
	`retail_price_base` integer,
	`image_url` text,
	`notes` text,
	`fields` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`set_id`) REFERENCES `tcg_sets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "products_name_check" CHECK(length(trim("__new_products"."name")) > 0)
);
--> statement-breakpoint
INSERT INTO `__new_products`("id", "category", "kind", "item_type", "name", "name_alias", "franchise", "region", "platform", "set_id", "set_name", "set_code", "line", "variant", "card_number", "rarity", "release_date", "retail_price_base", "image_url", "notes", "fields", "created_by", "created_at", "updated_at") SELECT "id", "category", "kind", "item_type", "name", "name_alias", "franchise", "region", "platform", "set_id", "set_name", "set_code", "line", "variant", "card_number", "rarity", "release_date", "retail_price_base", "image_url", "notes", "fields", "created_by", "created_at", "updated_at" FROM `products`;--> statement-breakpoint
DROP TABLE `products`;--> statement-breakpoint
ALTER TABLE `__new_products` RENAME TO `products`;--> statement-breakpoint
CREATE INDEX `products_kind_idx` ON `products` (`category`,`kind`);--> statement-breakpoint
CREATE INDEX `products_set_idx` ON `products` (`set_id`,`kind`);--> statement-breakpoint
CREATE TABLE `__new_tcg_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`franchise` text NOT NULL,
	`region` text,
	`code` text,
	`name` text NOT NULL,
	`name_alias` text,
	`set_type` text NOT NULL,
	`release_date` text,
	`source` text NOT NULL,
	`source_key` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "tcg_sets_type_check" CHECK("__new_tcg_sets"."set_type" IN ('expansion', 'deck', 'special'))
);
--> statement-breakpoint
INSERT INTO `__new_tcg_sets`("id", "franchise", "region", "code", "name", "name_alias", "set_type", "release_date", "source", "source_key", "created_at", "updated_at") SELECT "id", "franchise", "region", "code", "name", "name_alias", "set_type", "release_date", "source", "source_key", "created_at", "updated_at" FROM `tcg_sets`;--> statement-breakpoint
DROP TABLE `tcg_sets`;--> statement-breakpoint
ALTER TABLE `__new_tcg_sets` RENAME TO `tcg_sets`;--> statement-breakpoint
CREATE UNIQUE INDEX `tcg_sets_source_uq` ON `tcg_sets` (`source`,`source_key`);--> statement-breakpoint
CREATE INDEX `tcg_sets_franchise_idx` ON `tcg_sets` (`franchise`,`release_date`);--> statement-breakpoint
PRAGMA foreign_keys=ON;
