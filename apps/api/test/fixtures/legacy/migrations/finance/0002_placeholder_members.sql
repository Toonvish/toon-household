-- Placeholder members (docs/spec.md §2.1/§2.5): a user row without credentials
-- may now be seated in a household; a claim invite turns it into an account.
-- libSQL's ALTER COLUMN only drops the NOT NULL — the unique index on
-- email_normalized stays (SQLite treats NULLs as distinct there).
ALTER TABLE `users` ALTER COLUMN "email" TO "email" text;--> statement-breakpoint
ALTER TABLE `users` ALTER COLUMN "email_normalized" TO "email_normalized" text;--> statement-breakpoint
ALTER TABLE `users` ALTER COLUMN "password_hash" TO "password_hash" text;--> statement-breakpoint
ALTER TABLE `invites` ADD `claims_user_id` text REFERENCES users(id) ON DELETE cascade;
