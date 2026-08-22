CREATE TABLE `test_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`test_id` integer NOT NULL,
	`student_id` integer NOT NULL,
	`attempt` integer NOT NULL,
	`pass_threshold` integer NOT NULL,
	`submitted_at` integer NOT NULL,
	FOREIGN KEY (`test_id`) REFERENCES `tests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `test_attempts_student_test_idx` ON `test_attempts` (`student_id`,`test_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `test_attempts_student_test_attempt_unq` ON `test_attempts` (`student_id`,`test_id`,`attempt`);--> statement-breakpoint
-- Hand-completed: drizzle-kit drops the ON DELETE clause when it emits an ADD
-- COLUMN, and a reference with no cascade would refuse to delete an attempt whose
-- answers are still there. SQLite allows the clause on ADD COLUMN as long as the
-- column defaults to NULL, which this one does.
ALTER TABLE `submissions` ADD `test_attempt_id` integer REFERENCES test_attempts(id) ON DELETE cascade;--> statement-breakpoint
CREATE INDEX `submissions_test_attempt_idx` ON `submissions` (`test_attempt_id`);--> statement-breakpoint
ALTER TABLE `tests` ADD `published_at` integer;