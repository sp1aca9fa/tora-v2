CREATE TABLE `import_rows` (
	`id` text PRIMARY KEY NOT NULL,
	`import_run_id` text NOT NULL,
	`position` integer NOT NULL,
	`title` text NOT NULL,
	`detail` text,
	`outcome` text NOT NULL,
	`reason` text,
	`holding_id` text,
	`quantity` integer,
	`cost_base` integer,
	`day` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`import_run_id`) REFERENCES `import_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`holding_id`) REFERENCES `holdings`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "import_rows_outcome_check" CHECK("import_rows"."outcome" IN ('imported', 'existing', 'matched', 'updated', 'skipped', 'problem'))
);
--> statement-breakpoint
CREATE INDEX `import_rows_run_idx` ON `import_rows` (`import_run_id`,`position`);