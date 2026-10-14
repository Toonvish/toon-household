CREATE TABLE `finance_accrual_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`trigger` text NOT NULL,
	`from_period` text,
	`to_period` text,
	`periods_booked` integer NOT NULL,
	`periods_skipped` integer NOT NULL,
	`booked_cents` integer NOT NULL,
	`error` text,
	`started_at` integer NOT NULL,
	`finished_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `finance_accrual_runs_household_started_idx` ON `finance_accrual_runs` (`household_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `finance_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`slug` text NOT NULL,
	`custom_label` text,
	`is_system` integer DEFAULT false NOT NULL,
	`is_hidden` integer DEFAULT false NOT NULL,
	`position` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_categories_household_slug_uidx` ON `finance_categories` (`household_id`,`slug`);--> statement-breakpoint
CREATE INDEX `finance_categories_household_position_idx` ON `finance_categories` (`household_id`,`position`);--> statement-breakpoint
CREATE TABLE `finance_fixed_cost_items` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`label` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`active_from` text NOT NULL,
	`active_to` text,
	`position` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "finance_fixed_cost_items_amount_positive" CHECK("finance_fixed_cost_items"."amount_cents" > 0),
	CONSTRAINT "finance_fixed_cost_items_from_format" CHECK("finance_fixed_cost_items"."active_from" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "finance_fixed_cost_items_to_format" CHECK("finance_fixed_cost_items"."active_to" is null or "finance_fixed_cost_items"."active_to" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "finance_fixed_cost_items_range" CHECK("finance_fixed_cost_items"."active_to" is null or "finance_fixed_cost_items"."active_to" >= "finance_fixed_cost_items"."active_from")
);
--> statement-breakpoint
CREATE INDEX `finance_fixed_cost_items_household_active_idx` ON `finance_fixed_cost_items` (`household_id`,`active_from`,`active_to`);--> statement-breakpoint
CREATE TABLE `finance_fixed_cost_plans` (
	`household_id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`payer_id` text NOT NULL,
	`start_period` text NOT NULL,
	`last_booked_period` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`payer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "finance_fixed_cost_plans_start_format" CHECK("finance_fixed_cost_plans"."start_period" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "finance_fixed_cost_plans_last_format" CHECK("finance_fixed_cost_plans"."last_booked_period" is null or "finance_fixed_cost_plans"."last_booked_period" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]')
);
--> statement-breakpoint
CREATE TABLE `finance_incomes` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`person_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`valid_from` text NOT NULL,
	`valid_to` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "finance_incomes_amount_positive" CHECK("finance_incomes"."amount_cents" > 0),
	CONSTRAINT "finance_incomes_from_format" CHECK("finance_incomes"."valid_from" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "finance_incomes_to_format" CHECK("finance_incomes"."valid_to" is null or "finance_incomes"."valid_to" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "finance_incomes_range" CHECK("finance_incomes"."valid_to" is null or "finance_incomes"."valid_to" >= "finance_incomes"."valid_from")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_incomes_person_from_uidx` ON `finance_incomes` (`household_id`,`person_id`,`valid_from`);--> statement-breakpoint
CREATE INDEX `finance_incomes_household_person_idx` ON `finance_incomes` (`household_id`,`person_id`,`valid_from`,`valid_to`);--> statement-breakpoint
CREATE TABLE `finance_mutation_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`transaction_id` text,
	`applied_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`transaction_id`) REFERENCES `finance_transactions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `finance_mutation_claims_applied_at_idx` ON `finance_mutation_claims` (`applied_at`);--> statement-breakpoint
CREATE TABLE `finance_participants` (
	`household_id` text NOT NULL,
	`user_id` text NOT NULL,
	`member_slot` integer NOT NULL,
	`display_name` text NOT NULL,
	`joined_at` integer NOT NULL,
	PRIMARY KEY(`household_id`, `user_id`),
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "finance_participants_slot_range" CHECK("finance_participants"."member_slot" in (1, 2))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_participants_slot_uidx` ON `finance_participants` (`household_id`,`member_slot`);--> statement-breakpoint
CREATE INDEX `finance_participants_user_idx` ON `finance_participants` (`user_id`);--> statement-breakpoint
CREATE TABLE `finance_settings` (
	`household_id` text PRIMARY KEY NOT NULL,
	`default_locale` text DEFAULT 'de' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `finance_tags` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`usage_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_tags_household_name_key_uidx` ON `finance_tags` (`household_id`,`name_key`);--> statement-breakpoint
CREATE INDEX `finance_tags_household_usage_idx` ON `finance_tags` (`household_id`,`usage_count`);--> statement-breakpoint
CREATE TABLE `finance_transaction_tags` (
	`transaction_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`transaction_id`, `tag_id`),
	FOREIGN KEY (`transaction_id`) REFERENCES `finance_transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `finance_tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `finance_transaction_tags_tag_idx` ON `finance_transaction_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `finance_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`payer_id` text NOT NULL,
	`split_mode` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`description` text NOT NULL,
	`category_id` text,
	`booked_at` integer NOT NULL,
	`date_source` text NOT NULL,
	`origin` text NOT NULL,
	`plan_period` text,
	`category_source` text NOT NULL,
	`import_seq` integer,
	`external_key` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`payer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`category_id`) REFERENCES `finance_categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "finance_transactions_amount_not_zero" CHECK("finance_transactions"."amount_cents" <> 0),
	CONSTRAINT "finance_transactions_plan_period_format" CHECK("finance_transactions"."plan_period" is null or "finance_transactions"."plan_period" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_transactions_household_external_key_uidx` ON `finance_transactions` (`household_id`,`external_key`);--> statement-breakpoint
CREATE INDEX `finance_transactions_household_booked_idx` ON `finance_transactions` (`household_id`,`booked_at`,`import_seq`);--> statement-breakpoint
CREATE INDEX `finance_transactions_household_category_idx` ON `finance_transactions` (`household_id`,`category_id`);--> statement-breakpoint
CREATE INDEX `finance_transactions_household_plan_idx` ON `finance_transactions` (`household_id`,`origin`,`plan_period`);