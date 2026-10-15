-- The bought log (D4, SPEC.md §4.3) and "Recipes on this list" (SPEC.md §4.5,
-- artboard 1d), plus the two watermark columns they need. Additive only — no NOT NULL
-- column is added to a populated table, so the "SQL-level DEFAULT + JS backfill" dance
-- from 0003 is not needed and `backfillFoldedColumns()` is untouched.
--
-- `bought_by` is nullable with ON DELETE set null (a deliberate deviation from
-- SPEC.md §4.3's `not null` sketch): this is a group's shopping HISTORY, and a
-- cascade from `users` would erase a departed member's purchases from everyone
-- else's history the day an account-deletion endpoint exists. The DTO falls back to
-- `shopping.bought.unknownBuyer` for a NULL buyer.
--
-- `shopping_list_recipes` does NOT replace `shopping_list_items.source_recipe_ids` —
-- that column is per-ITEM provenance rewritten by every merge; this table is per-LIST
-- membership plus the `servings` the group chose when adding the recipe, which no
-- existing column can carry. See the table comment in src/db/schema.ts.
CREATE TABLE `shopping_bought_items` (
	`id` text PRIMARY KEY NOT NULL,
	`list_id` text NOT NULL,
	`name` text NOT NULL,
	`quantity` real,
	`unit` text,
	`note` text,
	`bought_by` text,
	`bought_at` integer NOT NULL,
	`source_recipe_ids` text,
	FOREIGN KEY (`list_id`) REFERENCES `shopping_lists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bought_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `shopping_bought_items_list_bought_at_idx` ON `shopping_bought_items` (`list_id`,`bought_at`);--> statement-breakpoint
CREATE INDEX `shopping_bought_items_bought_at_idx` ON `shopping_bought_items` (`bought_at`);--> statement-breakpoint
CREATE TABLE `shopping_list_recipes` (
	`id` text PRIMARY KEY NOT NULL,
	`list_id` text NOT NULL,
	`recipe_id` text NOT NULL,
	`servings` real,
	`added_by` text,
	`added_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`list_id`) REFERENCES `shopping_lists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`added_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shopping_list_recipes_list_recipe_unique` ON `shopping_list_recipes` (`list_id`,`recipe_id`);--> statement-breakpoint
CREATE INDEX `shopping_list_recipes_list_id_idx` ON `shopping_list_recipes` (`list_id`);--> statement-breakpoint
ALTER TABLE `shopping_list_catalog` ADD `hidden_at` integer;--> statement-breakpoint
ALTER TABLE `shopping_lists` ADD `bought_cleared_at` integer;