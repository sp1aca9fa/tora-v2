-- US spelling (user, 2026-10-26): `cancelled_orders` becomes `canceled_orders`, its rows copied;
-- the old table stays until a later migration drops it (rollbacks assume add-only). Import logs
-- written before name the reason and the count `cancelled`: renamed too.
CREATE TABLE `canceled_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`order_source` text NOT NULL,
	`order_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `canceled_orders_uq` ON `canceled_orders` (`user_id`,`order_source`,`order_id`);--> statement-breakpoint
INSERT INTO `canceled_orders` (`id`, `user_id`, `order_source`, `order_id`, `created_at`, `updated_at`)
	SELECT `id`, `user_id`, `order_source`, `order_id`, `created_at`, `updated_at` FROM `cancelled_orders`;--> statement-breakpoint
UPDATE `import_rows` SET `reason` = 'canceled' || substr(`reason`, 10) WHERE `reason` LIKE 'cancelled%';--> statement-breakpoint
UPDATE `import_runs` SET `counts` = json_set(json_remove(`counts`, '$.cancelled'), '$.canceled', json_extract(`counts`, '$.cancelled'))
	WHERE json_extract(`counts`, '$.cancelled') IS NOT NULL;
