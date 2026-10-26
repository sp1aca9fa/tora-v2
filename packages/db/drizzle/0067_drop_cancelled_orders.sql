-- The old `cancelled_orders` table, copied to `canceled_orders` by 0064 (US spelling), dropped. A
-- database still behind runs 0064 first, so no row is lost.
DROP INDEX IF EXISTS `cancelled_orders_uq`;--> statement-breakpoint
DROP TABLE IF EXISTS `cancelled_orders`;
