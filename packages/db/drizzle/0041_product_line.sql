ALTER TABLE `products` ADD `line` text;--> statement-breakpoint
DELETE FROM `app_settings` WHERE `key` IN ('strategySamples', 'strategySamplesChecked');
