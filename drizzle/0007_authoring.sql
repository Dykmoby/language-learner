ALTER TABLE `lesson_drafts` ADD `origin` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `lessons` ADD `published_at` integer;--> statement-breakpoint
-- Every Lesson that already existed is one a Student can already read, so it is
-- published as of this migration. Leaving them null would hide the whole
-- catalogue behind a column that was added to describe Lessons authored after it.
UPDATE `lessons` SET `published_at` = (CAST(strftime('%s','now') AS INTEGER) * 1000) WHERE `published_at` IS NULL;
