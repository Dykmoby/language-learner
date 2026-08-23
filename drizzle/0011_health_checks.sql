CREATE TABLE `health_checks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`healthy` integer NOT NULL,
	`wall_ms` integer NOT NULL,
	`reason` text,
	`likely_credentials` integer DEFAULT false NOT NULL,
	`likely_egress` integer DEFAULT false NOT NULL,
	`source` text NOT NULL,
	`ran_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `health_checks_ran_at_idx` ON `health_checks` (`ran_at`);