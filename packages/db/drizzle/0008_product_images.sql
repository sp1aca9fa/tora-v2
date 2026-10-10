CREATE TABLE `product_images` (
	`product_id` text PRIMARY KEY NOT NULL,
	`bytes` blob NOT NULL,
	`content_type` text NOT NULL,
	`width` integer,
	`height` integer,
	`source_url` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
