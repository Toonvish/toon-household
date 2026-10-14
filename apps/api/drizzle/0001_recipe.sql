CREATE TABLE `recipe_cards` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`label` text NOT NULL,
	`format` text NOT NULL,
	`value` text NOT NULL,
	`note` text,
	`last_used_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recipe_cards_user_format_value_unique` ON `recipe_cards` (`user_id`,`format`,`value`);--> statement-breakpoint
CREATE INDEX `recipe_cards_user_id_idx` ON `recipe_cards` (`user_id`);--> statement-breakpoint
CREATE INDEX `recipe_cards_user_last_used_idx` ON `recipe_cards` (`user_id`,`last_used_at`);--> statement-breakpoint
CREATE TABLE `recipe_collection_recipes` (
	`collection_id` text NOT NULL,
	`recipe_id` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`added_at` integer NOT NULL,
	PRIMARY KEY(`collection_id`, `recipe_id`),
	FOREIGN KEY (`collection_id`) REFERENCES `recipe_collections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe_recipes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recipe_collection_recipes_recipe_id_idx` ON `recipe_collection_recipes` (`recipe_id`);--> statement-breakpoint
CREATE INDEX `recipe_collection_recipes_collection_id_idx` ON `recipe_collection_recipes` (`collection_id`);--> statement-breakpoint
CREATE TABLE `recipe_collections` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`cover_image_url` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recipe_collections_household_id_idx` ON `recipe_collections` (`household_id`);--> statement-breakpoint
CREATE INDEX `recipe_collections_created_by_idx` ON `recipe_collections` (`created_by`);--> statement-breakpoint
CREATE TABLE `recipe_import_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`created_by` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`source_type` text NOT NULL,
	`source_url` text,
	`raw_text` text,
	`parsed` text NOT NULL,
	`confidence` real,
	`source_meta` text,
	`recipe_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe_recipes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `recipe_import_drafts_household_id_idx` ON `recipe_import_drafts` (`household_id`);--> statement-breakpoint
CREATE INDEX `recipe_import_drafts_created_by_idx` ON `recipe_import_drafts` (`created_by`);--> statement-breakpoint
CREATE INDEX `recipe_import_drafts_household_status_idx` ON `recipe_import_drafts` (`household_id`,`status`);--> statement-breakpoint
CREATE INDEX `recipe_import_drafts_recipe_id_idx` ON `recipe_import_drafts` (`recipe_id`);--> statement-breakpoint
CREATE TABLE `recipe_meal_plan_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`recipe_id` text NOT NULL,
	`planned_on` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`servings` real,
	`cooked_at` integer,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe_recipes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recipe_meal_plan_entries_household_date_recipe_unique` ON `recipe_meal_plan_entries` (`household_id`,`planned_on`,`recipe_id`);--> statement-breakpoint
CREATE INDEX `recipe_meal_plan_entries_household_date_idx` ON `recipe_meal_plan_entries` (`household_id`,`planned_on`,`position`);--> statement-breakpoint
CREATE INDEX `recipe_meal_plan_entries_recipe_id_idx` ON `recipe_meal_plan_entries` (`recipe_id`);--> statement-breakpoint
CREATE TABLE `recipe_recipe_cook_log` (
	`id` text PRIMARY KEY NOT NULL,
	`recipe_id` text NOT NULL,
	`household_id` text NOT NULL,
	`cooked_by` text NOT NULL,
	`cooked_at` integer NOT NULL,
	`meal_plan_entry_id` text,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe_recipes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cooked_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`meal_plan_entry_id`) REFERENCES `recipe_meal_plan_entries`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `recipe_recipe_cook_log_recipe_cooked_idx` ON `recipe_recipe_cook_log` (`recipe_id`,`cooked_at`);--> statement-breakpoint
CREATE INDEX `recipe_recipe_cook_log_household_cooked_idx` ON `recipe_recipe_cook_log` (`household_id`,`cooked_at`);--> statement-breakpoint
CREATE TABLE `recipe_recipe_ingredients` (
	`id` text PRIMARY KEY NOT NULL,
	`recipe_id` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`section` text,
	`quantity` real,
	`quantity_max` real,
	`unit` text,
	`name` text NOT NULL,
	`name_fold` text NOT NULL,
	`note` text,
	`raw` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe_recipes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recipe_recipe_ingredients_recipe_id_idx` ON `recipe_recipe_ingredients` (`recipe_id`);--> statement-breakpoint
CREATE INDEX `recipe_recipe_ingredients_recipe_position_idx` ON `recipe_recipe_ingredients` (`recipe_id`,`position`);--> statement-breakpoint
CREATE INDEX `recipe_recipe_ingredients_name_idx` ON `recipe_recipe_ingredients` (`name`);--> statement-breakpoint
CREATE TABLE `recipe_recipe_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`recipe_id` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`section` text,
	`text` text NOT NULL,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe_recipes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recipe_recipe_steps_recipe_id_idx` ON `recipe_recipe_steps` (`recipe_id`);--> statement-breakpoint
CREATE INDEX `recipe_recipe_steps_recipe_position_idx` ON `recipe_recipe_steps` (`recipe_id`,`position`);--> statement-breakpoint
CREATE TABLE `recipe_recipe_tags` (
	`recipe_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`recipe_id`, `tag_id`),
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe_recipes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `recipe_tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recipe_recipe_tags_tag_id_idx` ON `recipe_recipe_tags` (`tag_id`);--> statement-breakpoint
CREATE INDEX `recipe_recipe_tags_recipe_id_idx` ON `recipe_recipe_tags` (`recipe_id`);--> statement-breakpoint
CREATE TABLE `recipe_recipes` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`title_fold` text NOT NULL,
	`description_fold` text NOT NULL,
	`image_url` text,
	`source_url` text,
	`source_name` text,
	`servings_amount` real,
	`servings_unit` text,
	`prep_minutes` integer,
	`cook_minutes` integer,
	`total_minutes` integer,
	`difficulty` text,
	`rating` integer,
	`notes` text,
	`language` text DEFAULT 'de' NOT NULL,
	`last_cooked_at` integer,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recipe_recipes_household_id_idx` ON `recipe_recipes` (`household_id`);--> statement-breakpoint
CREATE INDEX `recipe_recipes_household_created_at_idx` ON `recipe_recipes` (`household_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `recipe_recipes_household_title_fold_idx` ON `recipe_recipes` (`household_id`,`title_fold`);--> statement-breakpoint
CREATE INDEX `recipe_recipes_created_by_idx` ON `recipe_recipes` (`created_by`);--> statement-breakpoint
CREATE INDEX `recipe_recipes_household_last_cooked_idx` ON `recipe_recipes` (`household_id`,`last_cooked_at`,`created_at`);--> statement-breakpoint
CREATE TABLE `recipe_shopping_bought_items` (
	`id` text PRIMARY KEY NOT NULL,
	`list_id` text NOT NULL,
	`name` text NOT NULL,
	`quantity` real,
	`unit` text,
	`note` text,
	`bought_by` text,
	`bought_at` integer NOT NULL,
	`source_recipe_ids` text,
	FOREIGN KEY (`list_id`) REFERENCES `recipe_shopping_lists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bought_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `recipe_shopping_bought_items_list_bought_at_idx` ON `recipe_shopping_bought_items` (`list_id`,`bought_at`);--> statement-breakpoint
CREATE INDEX `recipe_shopping_bought_items_bought_at_idx` ON `recipe_shopping_bought_items` (`bought_at`);--> statement-breakpoint
CREATE TABLE `recipe_shopping_list_catalog` (
	`id` text PRIMARY KEY NOT NULL,
	`list_id` text NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`unit` text,
	`use_count` integer DEFAULT 0 NOT NULL,
	`last_used_at` integer NOT NULL,
	`hidden_at` integer,
	FOREIGN KEY (`list_id`) REFERENCES `recipe_shopping_lists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recipe_shopping_list_catalog_list_name_unique` ON `recipe_shopping_list_catalog` (`list_id`,`name_key`);--> statement-breakpoint
CREATE INDEX `recipe_shopping_list_catalog_list_rank_idx` ON `recipe_shopping_list_catalog` (`list_id`,`use_count`,`last_used_at`);--> statement-breakpoint
CREATE TABLE `recipe_shopping_list_items` (
	`id` text PRIMARY KEY NOT NULL,
	`list_id` text NOT NULL,
	`name` text NOT NULL,
	`merge_key` text NOT NULL,
	`quantity` real,
	`unit` text,
	`note` text,
	`position` integer DEFAULT 0 NOT NULL,
	`source_recipe_ids` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`list_id`) REFERENCES `recipe_shopping_lists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recipe_shopping_list_items_list_merge_key_unique` ON `recipe_shopping_list_items` (`list_id`,`merge_key`);--> statement-breakpoint
CREATE INDEX `recipe_shopping_list_items_list_id_idx` ON `recipe_shopping_list_items` (`list_id`);--> statement-breakpoint
CREATE INDEX `recipe_shopping_list_items_list_position_idx` ON `recipe_shopping_list_items` (`list_id`,`position`);--> statement-breakpoint
CREATE TABLE `recipe_shopping_list_recipes` (
	`id` text PRIMARY KEY NOT NULL,
	`list_id` text NOT NULL,
	`recipe_id` text NOT NULL,
	`servings` real,
	`added_by` text,
	`added_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`list_id`) REFERENCES `recipe_shopping_lists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe_recipes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`added_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recipe_shopping_list_recipes_list_recipe_unique` ON `recipe_shopping_list_recipes` (`list_id`,`recipe_id`);--> statement-breakpoint
CREATE INDEX `recipe_shopping_list_recipes_list_id_idx` ON `recipe_shopping_list_recipes` (`list_id`);--> statement-breakpoint
CREATE TABLE `recipe_shopping_lists` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`created_by` text NOT NULL,
	`bought_cleared_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recipe_shopping_lists_household_name_unique` ON `recipe_shopping_lists` (`household_id`,`name`);--> statement-breakpoint
CREATE INDEX `recipe_shopping_lists_household_id_idx` ON `recipe_shopping_lists` (`household_id`);--> statement-breakpoint
CREATE INDEX `recipe_shopping_lists_created_by_idx` ON `recipe_shopping_lists` (`created_by`);--> statement-breakpoint
CREATE TABLE `recipe_shopping_mutations` (
	`id` text PRIMARY KEY NOT NULL,
	`list_id` text NOT NULL,
	`applied_at` integer NOT NULL,
	FOREIGN KEY (`list_id`) REFERENCES `recipe_shopping_lists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recipe_shopping_mutations_list_id_idx` ON `recipe_shopping_mutations` (`list_id`);--> statement-breakpoint
CREATE INDEX `recipe_shopping_mutations_applied_at_idx` ON `recipe_shopping_mutations` (`applied_at`);--> statement-breakpoint
CREATE TABLE `recipe_tags` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`kind` text DEFAULT 'free' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recipe_tags_household_name_unique` ON `recipe_tags` (`household_id`,`name`);--> statement-breakpoint
CREATE INDEX `recipe_tags_household_id_idx` ON `recipe_tags` (`household_id`);