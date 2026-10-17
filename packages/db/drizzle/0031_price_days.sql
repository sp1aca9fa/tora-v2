CREATE TABLE `price_days` (
	`product_id` text NOT NULL,
	`source` text NOT NULL,
	`bucket` text,
	`currency` text,
	`day` text NOT NULL,
	`prices` text NOT NULL,
	`estimated` integer NOT NULL,
	`observations` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `price_days_lookup_idx` ON `price_days` (`product_id`,`source`,`day`);--> statement-breakpoint
CREATE TABLE `price_days_dirty` (
	`product_id` text NOT NULL,
	`source` text NOT NULL,
	`day` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `price_days_dirty_uq` ON `price_days_dirty` (`product_id`,`source`,`day`);--> statement-breakpoint
CREATE INDEX `price_observations_source_idx` ON `price_observations` (`product_id`,`source`,`observed_at`);--> statement-breakpoint
CREATE TRIGGER `price_days_mark_insert` AFTER INSERT ON `price_observations` BEGIN
	DELETE FROM `price_days_dirty` WHERE `product_id` = NEW.`product_id` AND `source` = NEW.`source` AND `day` = substr(NEW.`observed_at`, 1, 10);
	INSERT INTO `price_days_dirty` (`product_id`, `source`, `day`) VALUES (NEW.`product_id`, NEW.`source`, substr(NEW.`observed_at`, 1, 10));
END;
--> statement-breakpoint
CREATE TRIGGER `price_days_mark_delete` AFTER DELETE ON `price_observations` BEGIN
	DELETE FROM `price_days_dirty` WHERE `product_id` = OLD.`product_id` AND `source` = OLD.`source` AND `day` = substr(OLD.`observed_at`, 1, 10);
	INSERT INTO `price_days_dirty` (`product_id`, `source`, `day`) VALUES (OLD.`product_id`, OLD.`source`, substr(OLD.`observed_at`, 1, 10));
END;
--> statement-breakpoint
CREATE TRIGGER `price_days_mark_update` AFTER UPDATE ON `price_observations`
WHEN OLD.`product_id` IS NOT NEW.`product_id` OR OLD.`source` IS NOT NEW.`source`
	OR OLD.`observation_type` IS NOT NEW.`observation_type` OR OLD.`bucket` IS NOT NEW.`bucket`
	OR OLD.`currency` IS NOT NEW.`currency` OR OLD.`price_base` IS NOT NEW.`price_base`
	OR OLD.`observed_at` IS NOT NEW.`observed_at` OR OLD.`excluded` IS NOT NEW.`excluded`
	OR OLD.`quantity_inferred` IS NOT NEW.`quantity_inferred`
BEGIN
	DELETE FROM `price_days_dirty` WHERE `product_id` = OLD.`product_id` AND `source` = OLD.`source` AND `day` = substr(OLD.`observed_at`, 1, 10);
	INSERT INTO `price_days_dirty` (`product_id`, `source`, `day`) VALUES (OLD.`product_id`, OLD.`source`, substr(OLD.`observed_at`, 1, 10));
	DELETE FROM `price_days_dirty` WHERE `product_id` = NEW.`product_id` AND `source` = NEW.`source` AND `day` = substr(NEW.`observed_at`, 1, 10);
	INSERT INTO `price_days_dirty` (`product_id`, `source`, `day`) VALUES (NEW.`product_id`, NEW.`source`, substr(NEW.`observed_at`, 1, 10));
END;
