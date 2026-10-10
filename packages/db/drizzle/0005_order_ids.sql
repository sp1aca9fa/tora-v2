ALTER TABLE `holdings` ADD `order_source` text;--> statement-breakpoint
ALTER TABLE `holdings` ADD `order_id` text;--> statement-breakpoint
CREATE INDEX `holdings_order_idx` ON `holdings` (`user_id`,`order_source`,`order_id`);