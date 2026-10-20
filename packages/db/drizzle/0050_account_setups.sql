CREATE TABLE `account_setups` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`token_hash` text NOT NULL,
	`totp_secret_enc` text,
	`created_by` text,
	`expires_at` text NOT NULL,
	`used_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "account_setups_kind_check" CHECK("account_setups"."kind" IN ('both', 'password', '2fa'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_setups_token_uq` ON `account_setups` (`token_hash`);--> statement-breakpoint
CREATE INDEX `account_setups_user_idx` ON `account_setups` (`user_id`);