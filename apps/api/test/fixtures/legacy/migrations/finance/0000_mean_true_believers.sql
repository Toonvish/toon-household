CREATE TABLE `accrual_runs` (
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
CREATE INDEX `accrual_runs_household_started_idx` ON `accrual_runs` (`household_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `categories` (
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
CREATE UNIQUE INDEX `categories_household_slug_uidx` ON `categories` (`household_id`,`slug`);--> statement-breakpoint
CREATE INDEX `categories_household_position_idx` ON `categories` (`household_id`,`position`);--> statement-breakpoint
CREATE TABLE `fixed_cost_items` (
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
	CONSTRAINT "fixed_cost_items_amount_positive" CHECK("fixed_cost_items"."amount_cents" > 0),
	CONSTRAINT "fixed_cost_items_from_format" CHECK("fixed_cost_items"."active_from" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "fixed_cost_items_to_format" CHECK("fixed_cost_items"."active_to" is null or "fixed_cost_items"."active_to" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "fixed_cost_items_range" CHECK("fixed_cost_items"."active_to" is null or "fixed_cost_items"."active_to" >= "fixed_cost_items"."active_from")
);
--> statement-breakpoint
CREATE INDEX `fixed_cost_items_household_active_idx` ON `fixed_cost_items` (`household_id`,`active_from`,`active_to`);--> statement-breakpoint
CREATE TABLE `fixed_cost_plans` (
	`household_id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`payer_id` text NOT NULL,
	`start_period` text NOT NULL,
	`last_booked_period` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`payer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "fixed_cost_plans_start_format" CHECK("fixed_cost_plans"."start_period" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "fixed_cost_plans_last_format" CHECK("fixed_cost_plans"."last_booked_period" is null or "fixed_cost_plans"."last_booked_period" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]')
);
--> statement-breakpoint
CREATE TABLE `household_members` (
	`household_id` text NOT NULL,
	`user_id` text NOT NULL,
	`member_slot` integer NOT NULL,
	`display_name` text NOT NULL,
	`joined_at` integer NOT NULL,
	PRIMARY KEY(`household_id`, `user_id`),
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "household_members_slot_range" CHECK("household_members"."member_slot" in (1, 2))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `household_members_slot_uidx` ON `household_members` (`household_id`,`member_slot`);--> statement-breakpoint
CREATE INDEX `household_members_user_idx` ON `household_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `households` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`default_locale` text DEFAULT 'de' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `incomes` (
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
	CONSTRAINT "incomes_amount_positive" CHECK("incomes"."amount_cents" > 0),
	CONSTRAINT "incomes_from_format" CHECK("incomes"."valid_from" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "incomes_to_format" CHECK("incomes"."valid_to" is null or "incomes"."valid_to" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "incomes_range" CHECK("incomes"."valid_to" is null or "incomes"."valid_to" >= "incomes"."valid_from")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `incomes_person_from_uidx` ON `incomes` (`household_id`,`person_id`,`valid_from`);--> statement-breakpoint
CREATE INDEX `incomes_household_person_idx` ON `incomes` (`household_id`,`person_id`,`valid_from`,`valid_to`);--> statement-breakpoint
CREATE TABLE `invites` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`token` text NOT NULL,
	`email` text,
	`invited_by` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`accepted_at` integer,
	`accepted_by` text,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invited_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`accepted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invites_token_uidx` ON `invites` (`token`);--> statement-breakpoint
CREATE INDEX `invites_household_status_idx` ON `invites` (`household_id`,`status`);--> statement-breakpoint
CREATE TABLE `mutation_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`transaction_id` text,
	`applied_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `mutation_claims_applied_at_idx` ON `mutation_claims` (`applied_at`);--> statement-breakpoint
CREATE TABLE `password_reset_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `password_reset_tokens_hash_uidx` ON `password_reset_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `password_reset_tokens_user_idx` ON `password_reset_tokens` (`user_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_id_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expires_at_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`usage_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_household_name_key_uidx` ON `tags` (`household_id`,`name_key`);--> statement-breakpoint
CREATE INDEX `tags_household_usage_idx` ON `tags` (`household_id`,`usage_count`);--> statement-breakpoint
CREATE TABLE `transaction_tags` (
	`transaction_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`transaction_id`, `tag_id`),
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `transaction_tags_tag_idx` ON `transaction_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `transactions` (
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
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "transactions_amount_not_zero" CHECK("transactions"."amount_cents" <> 0),
	CONSTRAINT "transactions_plan_period_format" CHECK("transactions"."plan_period" is null or "transactions"."plan_period" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_household_external_key_uidx` ON `transactions` (`household_id`,`external_key`);--> statement-breakpoint
CREATE INDEX `transactions_household_booked_idx` ON `transactions` (`household_id`,`booked_at`,`import_seq`);--> statement-breakpoint
CREATE INDEX `transactions_household_category_idx` ON `transactions` (`household_id`,`category_id`);--> statement-breakpoint
CREATE INDEX `transactions_household_plan_idx` ON `transactions` (`household_id`,`origin`,`plan_period`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`email_normalized` text NOT NULL,
	`name` text NOT NULL,
	`password_hash` text NOT NULL,
	`locale` text DEFAULT 'de' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_normalized_uidx` ON `users` (`email_normalized`);