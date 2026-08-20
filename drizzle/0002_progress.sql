CREATE TABLE `enrollments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`student_id` integer NOT NULL,
	`course_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `enrollments_student_course_unq` ON `enrollments` (`student_id`,`course_id`);--> statement-breakpoint
CREATE TABLE `submission_errors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`submission_id` integer NOT NULL,
	`position` integer NOT NULL,
	`type` text NOT NULL,
	`span` text NOT NULL,
	`explanation_ru` text NOT NULL,
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `submission_errors_type_idx` ON `submission_errors` (`type`);--> statement-breakpoint
CREATE TABLE `submissions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`student_id` integer NOT NULL,
	`exercise_id` integer NOT NULL,
	`attempt` integer NOT NULL,
	`answer` text NOT NULL,
	`status` text NOT NULL,
	`failure_reason` text,
	`proposed_verdict` text,
	`guarded_verdict` text,
	`feedback_ru` text,
	`corrected` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `submissions_student_exercise_idx` ON `submissions` (`student_id`,`exercise_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `submissions_student_exercise_attempt_unq` ON `submissions` (`student_id`,`exercise_id`,`attempt`);--> statement-breakpoint
ALTER TABLE `students` ADD `current_course_id` integer;