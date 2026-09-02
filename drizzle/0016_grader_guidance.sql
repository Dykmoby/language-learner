-- The editable grading guidance (#79), and the flag that keeps #78 out of a
-- metric it does not belong in.
--
-- `grader_guidance` holds one row or none. No row means the guidance shipped in
-- the code, so this table starts empty and «Вернуть исходный текст» deletes
-- rather than rewrites: the default has exactly one home, and an Admin restoring
-- it cannot get a stale copy of one. An empty `guidance` is a real edit meaning
-- "nothing beyond the skeleton", which is why absent and empty are different
-- states rather than the same one. The single-row shape is the primary key's job
-- rather than a convention every writer has to remember.
--
-- `updated_by` is nullable and `set null`, like every other authorship reference
-- in this schema: deleting an account must not fail because that person once
-- edited the guidance, and must not take the guidance with it either.
--
-- `submissions.typography_dropped` records that the server removed an Error the
-- Grader reported (#78). Without it the two stored Verdicts differ for a reason
-- that has nothing to do with the Grader, and the guard-firing tally reads that
-- difference as the Grader contradicting itself. Every row written before this
-- column had nothing dropped from it, which is what the default says.
--
-- ORDERING. This sits after #83's 0015, which is the order it has to be in:
-- drizzle's SQLite migrator applies a migration only when its journal `when` is
-- greater than the newest `created_at` already in `__drizzle_migrations` — it
-- compares timestamps, not indices, and keeps only the latest. A migration that
-- lands in the folder with a `when` below one already applied is skipped in
-- silence, with no error and no log line. tests/migration-journal.test.ts
-- asserts the journal stays monotonic so the next branch to add one cannot get
-- this wrong.

CREATE TABLE `grader_guidance` (
	`id` integer PRIMARY KEY NOT NULL,
	`guidance` text NOT NULL,
	`updated_by` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
ALTER TABLE `submissions` ADD `typography_dropped` integer DEFAULT false NOT NULL;