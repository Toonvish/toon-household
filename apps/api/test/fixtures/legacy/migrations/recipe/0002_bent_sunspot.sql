CREATE TABLE `shopping_list_catalog` (
	`id` text PRIMARY KEY NOT NULL,
	`list_id` text NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`unit` text,
	`use_count` integer DEFAULT 0 NOT NULL,
	`last_used_at` integer NOT NULL,
	FOREIGN KEY (`list_id`) REFERENCES `shopping_lists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shopping_list_catalog_list_name_unique` ON `shopping_list_catalog` (`list_id`,`name_key`);--> statement-breakpoint
CREATE INDEX `shopping_list_catalog_list_rank_idx` ON `shopping_list_catalog` (`list_id`,`use_count`,`last_used_at`);--> statement-breakpoint
CREATE TABLE `shopping_list_items` (
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
	FOREIGN KEY (`list_id`) REFERENCES `shopping_lists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shopping_list_items_list_merge_key_unique` ON `shopping_list_items` (`list_id`,`merge_key`);--> statement-breakpoint
CREATE INDEX `shopping_list_items_list_id_idx` ON `shopping_list_items` (`list_id`);--> statement-breakpoint
CREATE INDEX `shopping_list_items_list_position_idx` ON `shopping_list_items` (`list_id`,`position`);--> statement-breakpoint
CREATE TABLE `shopping_lists` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`name` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shopping_lists_group_name_unique` ON `shopping_lists` (`group_id`,`name`);--> statement-breakpoint
CREATE INDEX `shopping_lists_group_id_idx` ON `shopping_lists` (`group_id`);--> statement-breakpoint
CREATE INDEX `shopping_lists_created_by_idx` ON `shopping_lists` (`created_by`);--> statement-breakpoint
CREATE TABLE `shopping_mutations` (
	`id` text PRIMARY KEY NOT NULL,
	`list_id` text NOT NULL,
	`applied_at` integer NOT NULL,
	FOREIGN KEY (`list_id`) REFERENCES `shopping_lists`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `shopping_mutations_list_id_idx` ON `shopping_mutations` (`list_id`);--> statement-breakpoint
CREATE INDEX `shopping_mutations_applied_at_idx` ON `shopping_mutations` (`applied_at`);