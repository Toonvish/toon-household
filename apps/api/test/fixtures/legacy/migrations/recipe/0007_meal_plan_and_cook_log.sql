-- The meal planner (SPEC.md §4.1 / D7). `planned_on` is `text` holding YYYY-MM-DD and
-- NOT an integer unix-ms midnight: a plan entry is a calendar date, an instant is not,
-- and a date derived from an instant is a day out whenever the server's zone (UTC in
-- Docker) and the user's (Europe/Berlin) disagree — i.e. every night from 00:00 to
-- 02:00. See the `meal_plan_entries` comment in src/db/schema.ts.
--
-- The UNIQUE index is the idempotency story: planner writes are ONLINE-ONLY, so there
-- is no mutationId ledger, and a double-tapped POST must not create two entries.
--
-- No `note` column: A02 §2.1 sketched one, but no artboard draws it and no endpoint
-- reads it — see the table comment in src/db/schema.ts for why it is left out rather
-- than shipped unused.
--
-- No backfill: the table is new and starts empty.
CREATE TABLE `meal_plan_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`recipe_id` text NOT NULL,
	`planned_on` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`servings` real,
	`cooked_at` integer,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `meal_plan_entries_group_date_recipe_unique` ON `meal_plan_entries` (`group_id`,`planned_on`,`recipe_id`);--> statement-breakpoint
CREATE INDEX `meal_plan_entries_group_date_idx` ON `meal_plan_entries` (`group_id`,`planned_on`,`position`);--> statement-breakpoint
CREATE INDEX `meal_plan_entries_recipe_id_idx` ON `meal_plan_entries` (`recipe_id`);--> statement-breakpoint
-- Cook tracking (SPEC.md §4.2, D-per-spec: a log, not a column, because `cooked_by`
-- has to be carried). `group_id` is denormalised (derivable through `recipe_id`) so a
-- group cascade stays one sweep and "what did this group cook lately" is one index
-- range scan. `meal_plan_entry_id` is `ON DELETE set null`, not cascade: deleting a
-- plan entry must not delete the fact that the meal was cooked.
CREATE TABLE `recipe_cook_log` (
	`id` text PRIMARY KEY NOT NULL,
	`recipe_id` text NOT NULL,
	`group_id` text NOT NULL,
	`cooked_by` text NOT NULL,
	`cooked_at` integer NOT NULL,
	`meal_plan_entry_id` text,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cooked_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`meal_plan_entry_id`) REFERENCES `meal_plan_entries`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `recipe_cook_log_recipe_cooked_idx` ON `recipe_cook_log` (`recipe_id`,`cooked_at`);--> statement-breakpoint
CREATE INDEX `recipe_cook_log_group_cooked_idx` ON `recipe_cook_log` (`group_id`,`cooked_at`);--> statement-breakpoint
-- `recipes.last_cooked_at` is denormalised from `recipe_cook_log`, NULLABLE (never
-- `NOT NULL DEFAULT 0` — 0 is 1970 and would sort a never-cooked recipe as recently
-- cooked), and needs no backfill: the log is brand new, so NULL is correct for every
-- pre-existing recipe. See the column comment in src/db/schema.ts for why it is a
-- stored column rather than a correlated max()/grouped-max join.
ALTER TABLE `recipes` ADD `last_cooked_at` integer;--> statement-breakpoint
CREATE INDEX `recipes_group_last_cooked_idx` ON `recipes` (`group_id`,`last_cooked_at`,`created_at`);