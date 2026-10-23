ALTER TABLE `stores` ADD `language` text;--> statement-breakpoint
ALTER TABLE `stores` ADD `labels` text;--> statement-breakpoint
UPDATE `stores` SET `labels` = json_object('en', `label_en`), `language` = 'ja' WHERE `label_en` IS NOT NULL;
