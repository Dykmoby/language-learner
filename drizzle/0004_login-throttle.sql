CREATE TABLE `login_throttle` (
	`username` text PRIMARY KEY NOT NULL,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`last_failure_at` integer NOT NULL,
	`locked_until` integer
);
