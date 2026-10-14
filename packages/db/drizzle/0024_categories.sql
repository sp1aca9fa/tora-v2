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
	CONSTRAINT "products_region_check" CHECK("__new_products"."region" IN ('jp', 'en', 'na', 'eu', 'asia', 'kr', 'zh_cn', 'zh_tw', 'th', 'id', 'other')),
	CONSTRAINT "products_name_check" CHECK(length(trim("__new_products"."name")) > 0)
);
--> statement-breakpoint
INSERT INTO `__new_products`("id", "category", "kind", "item_type", "name", "name_alias", "franchise", "region", "platform", "set_id", "set_name", "set_code", "variant", "card_number", "rarity", "release_date", "retail_price_base", "image_url", "notes", "fields", "created_by", "created_at", "updated_at") SELECT "id", "category", "kind", CASE WHEN "category" = 'game' THEN 'game' WHEN "kind" = 'single' THEN 'card' WHEN "kind" IN ('booster_box', 'booster_pack', 'deck', 'special_set') THEN 'sealed' ELSE 'item' END, "name", "name_alias", "franchise", "region", "platform", "set_id", "set_name", "set_code", "variant", "card_number", "rarity", "release_date", "retail_price_base", "image_url", "notes", NULL, "created_by", "created_at", "updated_at" FROM `products`;--> statement-breakpoint
DROP TABLE `products`;--> statement-breakpoint
ALTER TABLE `__new_products` RENAME TO `products`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `products_kind_idx` ON `products` (`category`,`kind`);--> statement-breakpoint
CREATE INDEX `products_set_idx` ON `products` (`set_id`,`kind`);--> statement-breakpoint
ALTER TABLE `holdings` ADD `condition_value` text;;--> statement-breakpoint
-- Games get their own item type (S16): today's "item" roles, order, quality and identity choices are copied to "game".
UPDATE `sources` SET `roles` = json_set(`roles`, '$.game', json_extract(`roles`, '$.item')) WHERE json_type(`roles`, '$.item') IS NOT NULL AND json_type(`roles`, '$.game') IS NULL;--> statement-breakpoint
UPDATE `sources` SET `quality` = json_set(`quality`, '$.game', json(json_extract(`quality`, '$.item'))) WHERE json_type(`quality`, '$.item') = 'object' AND json_type(`quality`, '$.game') IS NULL;--> statement-breakpoint
UPDATE `sources` SET `info` = json_set(`info`, '$.roles.game', json_extract(`info`, '$.roles.item')) WHERE json_type(`info`, '$.roles.item') IS NOT NULL AND json_type(`info`, '$.roles.game') IS NULL;--> statement-breakpoint
UPDATE `sources` SET `info` = json_insert(`info`, '$.identity[#]', 'game') WHERE EXISTS (SELECT 1 FROM json_each(`info`, '$.identity') WHERE value = 'item') AND NOT EXISTS (SELECT 1 FROM json_each(`info`, '$.identity') WHERE value = 'game');--> statement-breakpoint
UPDATE `app_settings` SET `value` = json_set(`value`, '$.game', json(json_extract(`value`, '$.item'))) WHERE `key` = 'sourceOrder' AND json_type(`value`, '$.item') = 'array' AND json_type(`value`, '$.game') IS NULL;--> statement-breakpoint
UPDATE `app_settings` SET `value` = json_set(`value`, '$.identity', (SELECT json_group_object(m.key, CASE WHEN json_type(m.value, '$.item') IS NOT NULL AND json_type(m.value, '$.game') IS NULL THEN json_set(m.value, '$.game', json_extract(m.value, '$.item')) ELSE json(m.value) END) FROM json_each(`app_settings`.`value`, '$.identity') m)) WHERE `key` = 'markets' AND json_type(`value`, '$.identity') = 'object';
