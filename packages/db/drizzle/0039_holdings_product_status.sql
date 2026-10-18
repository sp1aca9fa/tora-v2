DROP INDEX `holdings_product_idx`;--> statement-breakpoint
CREATE INDEX `holdings_product_idx` ON `holdings` (`product_id`,`status`);