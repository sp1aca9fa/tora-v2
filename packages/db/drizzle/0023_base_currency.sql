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
--> statement-breakpoint
UPDATE `product_sources` SET `recent_sales` = replace(`recent_sales`, 'Jpy":', 'Base":') WHERE instr(`recent_sales`, 'Jpy":') > 0;
--> statement-breakpoint
UPDATE `holding_events` SET `payload` = replace(`payload`, 'Jpy":', 'Base":') WHERE instr(`payload`, 'Jpy":') > 0;
--> statement-breakpoint
UPDATE `bucket_values` SET `value` = replace(`value`, 'Jpy":', 'Base":') WHERE instr(`value`, 'Jpy":') > 0;
--> statement-breakpoint
UPDATE `suggestions` SET `payload` = replace(`payload`, 'Jpy":', 'Base":'), `evidence` = replace(`evidence`, 'Jpy":', 'Base":') WHERE instr(`payload`, 'Jpy":') > 0 OR instr(`evidence`, 'Jpy":') > 0;
