CREATE TABLE `db_usage` (
	`day` text NOT NULL,
	`origin` text NOT NULL,
	`rows_read` integer NOT NULL,
	`rows_written` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `db_usage_day_origin_uq` ON `db_usage` (`day`,`origin`);