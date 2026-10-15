-- Pre-folded search columns. See the `recipes` table comment in src/db/schema.ts for
-- WHY the fold is stored (a per-row 23x replace() under a count(*) that cannot stop
-- early: 32 ms per search at 2000 recipes, 91 ms for a term matching nothing) and why
-- a GENERATED column is not an option (libSQL ships SQLite 3.45, which refuses to ADD
-- a STORED one).
--
-- DEFAULT '' is required here and ONLY here: SQLite cannot add a NOT NULL column to a
-- populated table without one. The drizzle schema deliberately declares these columns
-- notNull() WITHOUT a default, so `tsc` rejects any insert that forgets them.
-- `db:generate` will offer to reconcile that divergence — decline.
--
-- THERE IS NO BACKFILL HERE ON PURPOSE. Existing rows are filled in by
-- `backfillFoldedColumns()` (src/db/migrate.ts) using the very same `foldText()` that
-- every write uses. Folding in SQL instead would need the uppercase twin of every
-- accent — SQLite's lower() is ASCII-only — and that is 40 nested replace() calls,
-- past the parser's limit of 31. One definition of the fold, in one language.
ALTER TABLE `recipes` ADD `title_fold` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `recipes` ADD `description_fold` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `recipe_ingredients` ADD `name_fold` text DEFAULT '' NOT NULL;--> statement-breakpoint

-- `?sort=title` orders by the folded column now, which an index CAN serve; ordering by
-- the equivalent expression forced USE TEMP B-TREE over the whole group.
DROP INDEX `recipes_group_title_idx`;--> statement-breakpoint
CREATE INDEX `recipes_group_title_fold_idx` ON `recipes` (`group_id`,`title_fold`);
