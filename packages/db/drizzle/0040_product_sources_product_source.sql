DROP INDEX `product_sources_product_idx`;--> statement-breakpoint
CREATE INDEX `product_sources_product_idx` ON `product_sources` (`product_id`,`source`,`active`);