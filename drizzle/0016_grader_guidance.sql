-- The editable grading guidance — #79.
--
-- One row or none. No row means the guidance shipped in the code, so this table
-- starts empty and «Вернуть исходный текст» deletes rather than rewrites: the
-- default has exactly one home, and an Admin restoring it cannot get a stale
-- copy of one. An empty `guidance` is a real edit meaning "nothing beyond the
-- skeleton", which is why absent and empty are different states rather than the
-- same one.
--
-- The single-row shape is the primary key's job rather than a convention every
-- writer has to remember: every write is an upsert onto id 1.
--
-- Numbered 0016 with no 0015 here on purpose — #83 is in flight on its own
-- branch and holds that number. The migrator applies journal entries in order
-- and does not mind a gap.

CREATE TABLE `grader_guidance` (
	`id` integer PRIMARY KEY NOT NULL,
	`guidance` text NOT NULL,
	`updated_by` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
