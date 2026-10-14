ALTER TABLE `holding_events` RENAME COLUMN `amount_jpy` TO `amount_base`;
--> statement-breakpoint
ALTER TABLE `holding_events` RENAME COLUMN `fees_jpy` TO `fees_base`;
--> statement-breakpoint
ALTER TABLE `holdings` RENAME COLUMN `cost_total_jpy` TO `cost_total_base`;
--> statement-breakpoint
ALTER TABLE `manual_prices` RENAME COLUMN `price_jpy` TO `price_base`;
--> statement-breakpoint
ALTER TABLE `price_observations` RENAME COLUMN `price_jpy` TO `price_base`;
--> statement-breakpoint
ALTER TABLE `products` RENAME COLUMN `retail_price_jpy` TO `retail_price_base`;
--> statement-breakpoint
ALTER TABLE `source_candidates` RENAME COLUMN `price_jpy` TO `price_base`;
--> statement-breakpoint
ALTER TABLE `valuation_snapshots` RENAME COLUMN `value_jpy` TO `value_base`;
