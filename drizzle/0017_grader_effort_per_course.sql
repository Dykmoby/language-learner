-- The Grader's Effort, chosen per Course (#76, ADR 0007).
--
-- Nullable, and null is «По умолчанию»: the parameter is not sent to the model
-- at all. That is the absence of a choice rather than a sixth value of one,
-- which is why the column carries no DEFAULT — a default would make "nobody
-- chose" and "somebody chose the model's own default" the same stored state.
--
-- The UPDATE is the whole point of the second statement. Every Course that
-- existed before this column was graded at `low`, fixed in code, and adding a
-- column must not change how any of them grades. They migrate to `low` rather
-- than to null: a Course that quietly started reasoning for minutes because a
-- migration ran would present as the application hanging, and nothing on any
-- screen would say why.
--
-- ORDERING. This sits after #79's 0016. drizzle's SQLite migrator applies a
-- migration only when its journal `when` is greater than the newest `created_at`
-- already in `__drizzle_migrations` — it compares timestamps, not indices. A
-- migration landing in the folder with a `when` below one already applied is
-- skipped in silence. tests/migration-journal.test.ts asserts the journal stays
-- monotonic so the next branch to add one cannot get this wrong.

ALTER TABLE `courses` ADD `grader_effort` text;--> statement-breakpoint
UPDATE `courses` SET `grader_effort` = 'low';
