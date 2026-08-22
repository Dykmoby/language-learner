CREATE TABLE `disputes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`submission_id` integer NOT NULL,
	`student_id` integer NOT NULL,
	`comment` text NOT NULL,
	`ruling` text,
	`resolved_by` integer,
	`resolved_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resolved_by`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `disputes_submission_id_unique` ON `disputes` (`submission_id`);--> statement-breakpoint
CREATE INDEX `disputes_ruling_idx` ON `disputes` (`ruling`,`created_at`);--> statement-breakpoint
CREATE INDEX `disputes_student_idx` ON `disputes` (`student_id`);