CREATE TABLE `cards` (
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
CREATE UNIQUE INDEX `cards_user_format_value_unique` ON `cards` (`user_id`,`format`,`value`);--> statement-breakpoint
CREATE INDEX `cards_user_id_idx` ON `cards` (`user_id`);--> statement-breakpoint
CREATE INDEX `cards_user_last_used_idx` ON `cards` (`user_id`,`last_used_at`);