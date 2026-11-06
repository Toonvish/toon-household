CREATE TABLE `calendar_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text,
	`notes` text,
	`location` text,
	`all_day` integer NOT NULL,
	`start_date` text NOT NULL,
	`start_time` text,
	`end_date` text NOT NULL,
	`end_time` text,
	`repeat_freq` text DEFAULT 'none' NOT NULL,
	`repeat_interval` integer DEFAULT 1 NOT NULL,
	`repeat_weekdays` text,
	`repeat_until` text,
	`resource_id` text,
	`assignee_mode` text DEFAULT 'none' NOT NULL,
	`category` text,
	`category_detail` text,
	`waste_import_id` text,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resource_id`) REFERENCES `calendar_resources`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`waste_import_id`) REFERENCES `calendar_waste_imports`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "calendar_entries_kind" CHECK("calendar_entries"."kind" in ('event', 'task', 'car')),
	CONSTRAINT "calendar_entries_repeat_freq" CHECK("calendar_entries"."repeat_freq" in ('none', 'daily', 'weekly', 'monthly', 'yearly')),
	CONSTRAINT "calendar_entries_repeat_interval" CHECK("calendar_entries"."repeat_interval" between 1 and 99),
	CONSTRAINT "calendar_entries_assignee_mode" CHECK("calendar_entries"."assignee_mode" in ('none', 'fixed', 'rotate')),
	CONSTRAINT "calendar_entries_category" CHECK("calendar_entries"."category" is null or "calendar_entries"."category" in ('waste_rest', 'waste_yellow', 'waste_bio', 'waste_paper', 'waste_tree')),
	CONSTRAINT "calendar_entries_category_detail" CHECK("calendar_entries"."category_detail" is null or "calendar_entries"."category_detail" in ('bio_cleaning')),
	CONSTRAINT "calendar_entries_title_or_category" CHECK("calendar_entries"."title" is not null or "calendar_entries"."category" is not null),
	CONSTRAINT "calendar_entries_start_date_format" CHECK("calendar_entries"."start_date" glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
	CONSTRAINT "calendar_entries_end_date_format" CHECK("calendar_entries"."end_date" glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
	CONSTRAINT "calendar_entries_date_order" CHECK("calendar_entries"."end_date" >= "calendar_entries"."start_date"),
	CONSTRAINT "calendar_entries_start_time_format" CHECK("calendar_entries"."start_time" is null or "calendar_entries"."start_time" glob '[0-2][0-9]:[0-5][0-9]'),
	CONSTRAINT "calendar_entries_end_time_format" CHECK("calendar_entries"."end_time" is null or "calendar_entries"."end_time" glob '[0-2][0-9]:[0-5][0-9]'),
	CONSTRAINT "calendar_entries_until_format" CHECK("calendar_entries"."repeat_until" is null or "calendar_entries"."repeat_until" glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]')
);
--> statement-breakpoint
CREATE INDEX `calendar_entries_household_start_idx` ON `calendar_entries` (`household_id`,`start_date`);--> statement-breakpoint
CREATE INDEX `calendar_entries_household_freq_idx` ON `calendar_entries` (`household_id`,`repeat_freq`);--> statement-breakpoint
CREATE INDEX `calendar_entries_resource_idx` ON `calendar_entries` (`resource_id`);--> statement-breakpoint
CREATE INDEX `calendar_entries_waste_import_idx` ON `calendar_entries` (`waste_import_id`);--> statement-breakpoint
CREATE TABLE `calendar_entry_members` (
	`entry_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`entry_id`, `user_id`, `role`),
	FOREIGN KEY (`entry_id`) REFERENCES `calendar_entries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "calendar_entry_members_role" CHECK("calendar_entry_members"."role" in ('attendee', 'assignee'))
);
--> statement-breakpoint
CREATE INDEX `calendar_entry_members_user_idx` ON `calendar_entry_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `calendar_occurrence_states` (
	`entry_id` text NOT NULL,
	`occurrence_date` text NOT NULL,
	`status` text NOT NULL,
	`done_by` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`entry_id`, `occurrence_date`),
	FOREIGN KEY (`entry_id`) REFERENCES `calendar_entries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`done_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "calendar_occurrence_states_status" CHECK("calendar_occurrence_states"."status" in ('done', 'skipped')),
	CONSTRAINT "calendar_occurrence_states_date_format" CHECK("calendar_occurrence_states"."occurrence_date" glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]')
);
--> statement-breakpoint
CREATE TABLE `calendar_resources` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`kind` text DEFAULT 'car' NOT NULL,
	`name` text NOT NULL,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "calendar_resources_kind" CHECK("calendar_resources"."kind" = 'car')
);
--> statement-breakpoint
CREATE INDEX `calendar_resources_household_idx` ON `calendar_resources` (`household_id`);--> statement-breakpoint
CREATE TABLE `calendar_waste_assignees` (
	`household_id` text NOT NULL,
	`user_id` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`household_id`, `user_id`),
	FOREIGN KEY (`household_id`) REFERENCES `calendar_waste_settings`(`household_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `calendar_waste_assignees_user_idx` ON `calendar_waste_assignees` (`user_id`);--> statement-breakpoint
CREATE TABLE `calendar_waste_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`provider` text NOT NULL,
	`year` integer NOT NULL,
	`tour` integer NOT NULL,
	`source` text NOT NULL,
	`source_name` text NOT NULL,
	`entry_count` integer NOT NULL,
	`imported_at` integer NOT NULL,
	`imported_by` text,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`imported_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "calendar_waste_imports_provider" CHECK("calendar_waste_imports"."provider" in ('hattingen')),
	CONSTRAINT "calendar_waste_imports_tour" CHECK("calendar_waste_imports"."tour" between 1 and 9),
	CONSTRAINT "calendar_waste_imports_source" CHECK("calendar_waste_imports"."source" in ('url', 'upload'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_waste_imports_household_year_uidx` ON `calendar_waste_imports` (`household_id`,`provider`,`year`);--> statement-breakpoint
CREATE TABLE `calendar_waste_settings` (
	`household_id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`tour` integer NOT NULL,
	`source_url` text,
	`assignee_mode` text DEFAULT 'none' NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "calendar_waste_settings_provider" CHECK("calendar_waste_settings"."provider" in ('hattingen')),
	CONSTRAINT "calendar_waste_settings_tour" CHECK("calendar_waste_settings"."tour" between 1 and 9),
	CONSTRAINT "calendar_waste_settings_assignee_mode" CHECK("calendar_waste_settings"."assignee_mode" in ('none', 'fixed', 'rotate'))
);
