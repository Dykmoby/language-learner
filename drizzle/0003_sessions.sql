CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_student_idx` ON `sessions` (`student_id`);