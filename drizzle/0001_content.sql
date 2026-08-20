CREATE TABLE `accepted_variants` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`exercise_id` integer NOT NULL,
	`value` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `courses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`language` text NOT NULL,
	`level` text NOT NULL,
	`grader_model` text NOT NULL,
	`title` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `exercise_sets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lesson_id` integer,
	`test_id` integer,
	FOREIGN KEY (`lesson_id`) REFERENCES `lessons`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`test_id`) REFERENCES `tests`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "exercise_sets_exactly_one_owner" CHECK((("exercise_sets"."lesson_id" is not null) + ("exercise_sets"."test_id" is not null)) = 1)
);
--> statement-breakpoint
CREATE TABLE `exercises` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`exercise_set_id` integer NOT NULL,
	`position` integer NOT NULL,
	`kind` text NOT NULL,
	`prompt` text NOT NULL,
	`reference_answer` text NOT NULL,
	`accepted_answers` text DEFAULT '[]' NOT NULL,
	`case_sensitive` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`exercise_set_id`) REFERENCES `exercise_sets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exercises_set_position_unq` ON `exercises` (`exercise_set_id`,`position`);--> statement-breakpoint
CREATE TABLE `lessons` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`course_id` integer NOT NULL,
	`position` integer NOT NULL,
	`title` text NOT NULL,
	`theory_markdown` text NOT NULL,
	`grammar_focus` text NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lessons_course_position_unq` ON `lessons` (`course_id`,`position`);--> statement-breakpoint
CREATE TABLE `tests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`course_id` integer NOT NULL,
	`title` text NOT NULL,
	`pass_threshold` integer DEFAULT 80 NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade
);
