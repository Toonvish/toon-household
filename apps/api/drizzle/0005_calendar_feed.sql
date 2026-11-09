CREATE TABLE `calendar_feed_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`scope` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "calendar_feed_tokens_scope" CHECK("calendar_feed_tokens"."scope" in ('all', 'mine')),
	CONSTRAINT "calendar_feed_tokens_token_hash_format" CHECK(length("calendar_feed_tokens"."token_hash") = 64)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_feed_tokens_token_hash_uidx` ON `calendar_feed_tokens` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_feed_tokens_household_user_uidx` ON `calendar_feed_tokens` (`household_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `calendar_feed_tokens_user_idx` ON `calendar_feed_tokens` (`user_id`);